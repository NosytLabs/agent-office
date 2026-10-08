"""Compact, correction-aware accounting for observed runtime usage.

Canonical events have event="usage", platform, session_id and a stable source
usage_id. An ID identifies one request/message (or one explicitly cumulative
source unit); do not report both its step amounts and their message total.
Every report is a full replacement snapshot, not a delta or a partial patch.
Different snapshots replace that unit in consumption order. Without a source
revision, an old differing snapshot cannot be distinguished from a correction.

input_tokens and output_tokens are inclusive. cached_input_tokens and
cache_write_tokens are subsets of input; reasoning_output_tokens is a subset
of output. total_tokens is preserved when supplied, otherwise derived only
when both input and output are known. Missing/null fields remain unknown.
Tokens must be nonnegative safe integers; cost_usd must be finite and
nonnegative. Costs are observed runtime estimates, never inferred price rates
or invoice amounts. cost_source identifies the reporting runtime/source.

The caller owns the SQLite writer transaction (BEGIN IMMEDIATE) and must call
ensure_schema first.
These helpers never commit. History pruning must leave usage_units and
usage_totals intact; Reset progress must clear both in the same transaction.
The compact per-unit identity/counter ledger deliberately grows with observed
units: exact arbitrary replay detection and corrections need that baseline.
It contains no raw events, prompts, commands, or output previews. Snapshots
read materialized aggregates, never refold the per-unit ledger.
"""
from __future__ import annotations

from decimal import Decimal, localcontext
import hashlib
import json
import math


TOKEN_FIELDS = (
    "input_tokens", "output_tokens", "total_tokens", "cached_input_tokens",
    "cache_write_tokens", "reasoning_output_tokens",
)
METRICS = (*TOKEN_FIELDS, "cost_usd")
MAX_SAFE_TOKENS = (1 << 53) - 1


def ensure_schema(db):
    """Create accounting tables without committing an enclosing transaction."""
    # executescript implicitly commits; individual statements preserve the
    # event-store's atomic checkpoint/receipt/accounting transaction.
    db.execute("""CREATE TABLE IF NOT EXISTS usage_units (
        platform TEXT NOT NULL, session_id TEXT NOT NULL, usage_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL, data TEXT NOT NULL, updated_at REAL NOT NULL,
        PRIMARY KEY(platform, session_id, usage_id)
    ) WITHOUT ROWID""")
    db.execute("""CREATE TABLE IF NOT EXISTS usage_totals (
        dimension TEXT NOT NULL, bucket TEXT NOT NULL, data TEXT NOT NULL,
        PRIMARY KEY(dimension, bucket)
    ) WITHOUT ROWID""")


def _label(value, *, required=False, limit=256):
    if value is None and not required:
        return None
    if not isinstance(value, str):
        raise ValueError("invalid usage label")
    value = value.strip()
    if not value and not required:
        return None
    if not value or len(value) > limit or any(ord(char) < 32 for char in value):
        raise ValueError("invalid usage label")
    value.encode("utf-8")
    return value


def _token(value):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("invalid token count")
    if not 0 <= value <= MAX_SAFE_TOKENS or int(value) != value:
        raise ValueError("invalid token count")
    return int(value)


def _cost(value):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("invalid usage cost")
    value = float(value)
    if not math.isfinite(value) or value < 0:
        raise ValueError("invalid usage cost")
    return value or 0.0


def _normalize(event):
    if not isinstance(event, dict) or event.get("event") != "usage":
        return None
    try:
        identity = (
            _label(event.get("platform"), required=True, limit=64).lower(),
            _label(event.get("session_id"), required=True, limit=512),
            _label(event.get("usage_id"), required=True, limit=512),
        )
        values = {field: _token(event.get(field)) for field in TOKEN_FIELDS}
        values.update(
            model=_label(event.get("model")),
            provider=_label(event.get("provider")),
            cost_usd=_cost(event.get("cost_usd")),
        )
        for subset, inclusive in (
            ("cached_input_tokens", "input_tokens"),
            ("cache_write_tokens", "input_tokens"),
            ("reasoning_output_tokens", "output_tokens"),
        ):
            if (values[subset] is not None and values[inclusive] is not None
                    and values[subset] > values[inclusive]):
                return None
        if (values["total_tokens"] is None and values["input_tokens"] is not None
                and values["output_tokens"] is not None):
            values["total_tokens"] = values["input_tokens"] + values["output_tokens"]
        values["cost_source"] = (
            _label(event.get("cost_source")) or "runtime estimate"
            if values["cost_usd"] is not None else None
        )
        return identity, values
    except (ValueError, TypeError, OverflowError, UnicodeError):
        return None


def _encode(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _empty_totals():
    return {
        "reports": 0,
        "sums": {field: "0" if field == "cost_usd" else 0 for field in METRICS},
        "coverage": {field: 0 for field in METRICS},
        "sources": {},
    }


def _buckets(identity, values):
    platform, session_id, _ = identity
    return (
        ("total", "[]"),
        ("platform", _encode([platform])),
        ("session", _encode([platform, session_id])),
        ("model", _encode([platform, values["provider"], values["model"]])),
    )


def _cost_delta(total, value, direction):
    left, right = Decimal(total), Decimal(str(value))
    if direction < 0:
        right = right.copy_negate()
    # The default decimal precision can lose a small charge beside a large
    # one, then fail to recover it when the large charge is corrected away.
    with localcontext() as context:
        context.prec = max(
            28, max(left.adjusted(), right.adjusted())
            - min(left.as_tuple().exponent, right.as_tuple().exponent) + 2,
        )
        return str(left + right)


def _adjust(totals, values, direction):
    totals["reports"] += direction
    for field in METRICS:
        value = values[field]
        if value is None:
            continue
        totals["coverage"][field] += direction
        if field == "cost_usd":
            # Decimal strings preserve sub-cent estimates across replacement
            # subtraction without accumulating binary floating-point residue.
            totals["sums"][field] = _cost_delta(totals["sums"][field], value, direction)
        else:
            totals["sums"][field] += direction * value
    if values["cost_usd"] is not None:
        source = values["cost_source"]
        subtotal = totals["sources"].setdefault(source, {"reports": 0, "cost_usd": "0"})
        subtotal["reports"] += direction
        subtotal["cost_usd"] = _cost_delta(subtotal["cost_usd"], values["cost_usd"], direction)
        if not subtotal["reports"]:
            del totals["sources"][source]


def consume_usage(db, event, now):
    """Upsert a canonical full report; return whether accounting changed.

    Invalid events and exact semantic duplicates return False. Source times,
    receipt IDs, and unrelated payload fields do not participate in identity.
    Database failures propagate to the caller so its entire transaction can
    roll back instead of acknowledging partially accounted events.
    """
    normalized = _normalize(event)
    if normalized is None:
        return False
    identity, values = normalized
    encoded = _encode(values)
    fingerprint = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
    previous = db.execute(
        "SELECT fingerprint,data FROM usage_units WHERE platform=? AND session_id=? AND usage_id=?",
        identity,
    ).fetchone()
    if previous and previous[0] == fingerprint:
        return False
    changes = []
    if previous:
        changes.append((json.loads(previous[1]), -1))
    changes.append((values, 1))
    aggregates = {}
    for contribution, direction in changes:
        for key in _buckets(identity, contribution):
            if key not in aggregates:
                row = db.execute(
                    "SELECT data FROM usage_totals WHERE dimension=? AND bucket=?", key,
                ).fetchone()
                aggregates[key] = json.loads(row[0]) if row else _empty_totals()
            _adjust(aggregates[key], contribution, direction)
    db.execute(
        """INSERT INTO usage_units(platform,session_id,usage_id,fingerprint,data,updated_at)
        VALUES(?,?,?,?,?,?) ON CONFLICT(platform,session_id,usage_id) DO UPDATE SET
        fingerprint=excluded.fingerprint, data=excluded.data, updated_at=excluded.updated_at""",
        (*identity, fingerprint, encoded, now),
    )
    for key, totals in aggregates.items():
        if totals["reports"]:
            db.execute(
                """INSERT INTO usage_totals(dimension,bucket,data) VALUES(?,?,?)
                ON CONFLICT(dimension,bucket) DO UPDATE SET data=excluded.data""",
                (*key, _encode(totals)),
            )
        else:
            db.execute("DELETE FROM usage_totals WHERE dimension=? AND bucket=?", key)
    return True


def _public_cost(value):
    amount = float(value)
    return amount if math.isfinite(amount) else None


def _snapshot_totals(totals):
    result = {"reports": totals["reports"], "coverage": dict(totals["coverage"])}
    for field in METRICS:
        result[field] = (
            _public_cost(totals["sums"][field]) if field == "cost_usd" else totals["sums"][field]
        ) if totals["coverage"][field] else None
    if totals["coverage"]["cost_usd"] and result["cost_usd"] is None:
        # Every input may be finite while its combined sum exceeds JSON/JS
        # number range. Preserve exact accounting internally and keep the API
        # valid; the flag distinguishes an unrepresentable sum from no report.
        result["overflow"] = {"cost_usd": True}
    result["cost_sources"] = []
    for source, values in sorted(totals["sources"].items()):
        amount = _public_cost(values["cost_usd"])
        subtotal = {"source": source, "reports": values["reports"], "cost_usd": amount}
        if amount is None:
            subtotal["overflow"] = True
        result["cost_sources"].append(subtotal)
    return result


def snapshot_usage(db, session_keys=None):
    """Return known sums with per-field coverage; None never means zero.

    reports counts source usage units, not an inferred count of billable API
    calls. coverage[field] / reports describes how much of each sum is known.
    overflow.cost_usd marks a known sum outside the finite JSON number range;
    its public amount is None while the exact amount remains in the ledger.
    Session/model lists are aggregate buckets, not individual usage records.
    When session_keys is supplied, fetch only those exact (platform, session_id)
    pairs by primary key. An empty collection requests no session buckets;
    None preserves the complete snapshot used by exports and standalone callers.
    """
    result = {
        "currency": "USD", "cost_basis": "runtime_estimate",
        "totals": _snapshot_totals(_empty_totals()),
        "by_session": [], "by_model": [], "by_platform": [],
    }
    if session_keys is None:
        rows = db.execute("SELECT dimension,bucket,data FROM usage_totals ORDER BY dimension,bucket")
    else:
        result["session_scope"] = "visible_agents"
        # dimension is the leading primary-key column. This range lookup never
        # walks all historical session buckets to filter them in Python.
        rows = db.execute("""SELECT dimension,bucket,data FROM usage_totals
            WHERE dimension IN ('total','model','platform') ORDER BY dimension,bucket""")
    for dimension, bucket, data in rows:
        totals = _snapshot_totals(json.loads(data))
        values = json.loads(bucket)
        if dimension == "total":
            result["totals"] = totals
        elif dimension == "platform":
            result["by_platform"].append({"platform": values[0], **totals})
        elif dimension == "session":
            result["by_session"].append({"platform": values[0], "session_id": values[1], **totals})
        elif dimension == "model":
            result["by_model"].append({
                "platform": values[0], "provider": values[1], "model": values[2], **totals,
            })
    if session_keys is not None:
        for platform, session_id in sorted(set(session_keys)):
            row = db.execute("""SELECT data FROM usage_totals
                WHERE dimension='session' AND bucket=?""", (_encode([platform, session_id]),)).fetchone()
            if row:
                result["by_session"].append({"platform": platform, "session_id": session_id,
                                             **_snapshot_totals(json.loads(row[0]))})
    return result
