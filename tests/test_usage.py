"""Exact usage accounting under replay, correction, and partial reporting."""
import json
import sqlite3

import pytest

import usage



@pytest.fixture
def db():
    connection = sqlite3.connect(":memory:")
    yield connection
    connection.close()


def report(**changes):
    return {
        "event": "usage", "usage_id": "message-1", "platform": "opencode",
        "session_id": "session-1", "model": "model-a", "provider": "provider-a",
        "input_tokens": 100, "output_tokens": 40, "total_tokens": 140,
        "cached_input_tokens": 20, "cache_write_tokens": 10,
        "reasoning_output_tokens": 5, "cost_usd": 0.0123,
        "cost_source": "opencode runtime estimate", **changes,
    }


def test_empty_ledger_reports_unknown_amounts_instead_of_free_usage(db):
    usage.ensure_schema(db)
    snapshot = usage.snapshot_usage(db)
    assert snapshot["totals"]["reports"] == 0
    assert snapshot["totals"]["total_tokens"] is None
    assert snapshot["totals"]["cost_usd"] is None
    assert snapshot["totals"]["coverage"]["cost_usd"] == 0
    assert snapshot["by_session"] == []
    assert snapshot["by_model"] == []
    assert snapshot["by_platform"] == []


def test_visible_session_filter_keeps_lifetime_totals_and_exact_runtime_pairs(db):
    usage.ensure_schema(db)
    usage.consume_usage(db, report(), 100)
    usage.consume_usage(db, report(platform="hermes", session_id="session-1"), 101)
    usage.consume_usage(db, report(session_id="closed-session", model="other-model"), 102)
    complete = usage.snapshot_usage(db)
    visible = usage.snapshot_usage(db, session_keys=[("hermes", "session-1"), ("hermes", "session-1"), ("opencode", "missing")])
    assert visible["session_scope"] == "visible_agents"
    assert [(row["platform"], row["session_id"]) for row in visible["by_session"]] == [("hermes", "session-1")]
    for field in ("totals", "by_platform", "by_model"):
        assert visible[field] == complete[field]
    assert len(complete["by_session"]) == 3
    assert "session_scope" not in complete


def test_explicit_empty_session_filter_never_means_all_sessions(db):
    usage.ensure_schema(db)
    usage.consume_usage(db, report(), 100)
    visible = usage.snapshot_usage(db, session_keys=[])
    assert visible["session_scope"] == "visible_agents"
    assert visible["by_session"] == []
    assert visible["totals"]["reports"] == 1
    assert len(usage.snapshot_usage(db, session_keys=None)["by_session"]) == 1


def test_visible_snapshot_work_does_not_scan_closed_sessions_or_usage_units(db):
    usage.ensure_schema(db)
    usage.consume_usage(db, report(), 100)
    for number in range(2000):
        usage.consume_usage(db, report(session_id=f"closed-{number}"), 100)
    operations = 0
    def budget():
        nonlocal operations
        operations += 1
        return int(operations > 1000)
    def no_units(action, table, column, database, source):
        return sqlite3.SQLITE_DENY if action == sqlite3.SQLITE_READ and table == "usage_units" else sqlite3.SQLITE_OK
    db.set_authorizer(no_units)
    db.set_progress_handler(budget, 1)
    try:
        visible = usage.snapshot_usage(db, session_keys={("opencode", "session-1")})
    finally:
        db.set_progress_handler(None, 0)
        db.set_authorizer(None)
    assert visible["totals"]["reports"] == 2001
    assert [row["session_id"] for row in visible["by_session"]] == ["session-1"]
    assert operations < 1000


def test_cache_and_reasoning_are_subsets_not_extra_token_charges(db):
    usage.ensure_schema(db)
    assert usage.consume_usage(db, report(), 100)
    snapshot = usage.snapshot_usage(db)
    totals = snapshot["totals"]
    assert totals["reports"] == 1
    assert totals["input_tokens"] == 100
    assert totals["output_tokens"] == 40
    assert totals["total_tokens"] == 140
    assert totals["cached_input_tokens"] == 20
    assert totals["cache_write_tokens"] == 10
    assert totals["reasoning_output_tokens"] == 5
    assert totals["cost_usd"] == 0.0123
    assert totals["cost_sources"] == [
        {"source": "opencode runtime estimate", "reports": 1, "cost_usd": 0.0123}
    ]
    assert snapshot["currency"] == "USD"
    assert snapshot["cost_basis"] == "runtime_estimate"


def test_replayed_snapshot_ignores_receipt_time_and_unrelated_event_fields(db):
    usage.ensure_schema(db)
    original = report(ts=200, preview="not ledger data")
    assert usage.consume_usage(db, original, 300)
    before = usage.snapshot_usage(db)
    assert not usage.consume_usage(db, report(ts=100, preview="changed"), 400)
    assert usage.snapshot_usage(db) == before
    assert original["preview"] == "not ledger data"


def test_downward_correction_replaces_the_same_usage_unit(db):
    usage.ensure_schema(db)
    usage.consume_usage(db, report(), 100)
    assert usage.consume_usage(db, report(
        input_tokens=60, output_tokens=20, total_tokens=80,
        cost_usd=0.006,
    ), 101)
    totals = usage.snapshot_usage(db)["totals"]
    assert totals["reports"] == 1
    assert totals["input_tokens"] == 60
    assert totals["total_tokens"] == 80
    assert totals["cost_usd"] == 0.006
    assert totals["coverage"]["cost_usd"] == 1


def test_correction_moves_model_provider_and_cost_source_buckets(db):
    usage.ensure_schema(db)
    usage.consume_usage(db, report(), 100)
    usage.consume_usage(db, report(
        model="model-b", provider="provider-b", cost_usd=0.008,
        cost_source="corrected runtime estimate",
    ), 101)
    snapshot = usage.snapshot_usage(db)
    assert len(snapshot["by_model"]) == 1
    assert snapshot["by_model"][0]["model"] == "model-b"
    assert snapshot["by_model"][0]["provider"] == "provider-b"
    assert snapshot["by_model"][0]["total_tokens"] == 140
    assert snapshot["totals"]["cost_sources"] == [
        {"source": "corrected runtime estimate", "reports": 1, "cost_usd": 0.008}
    ]


def test_unavailable_correction_removes_previous_known_cost(db):
    usage.ensure_schema(db)
    usage.consume_usage(db, report(), 100)
    usage.consume_usage(db, report(cost_usd=None, cost_source=None), 101)
    totals = usage.snapshot_usage(db)["totals"]
    assert totals["reports"] == 1
    assert totals["cost_usd"] is None
    assert totals["coverage"]["cost_usd"] == 0
    assert totals["cost_sources"] == []


def test_partial_known_totals_expose_field_coverage(db):
    usage.ensure_schema(db)
    usage.consume_usage(db, report(), 100)
    usage.consume_usage(db, {
        "event": "usage", "usage_id": "turn-1", "platform": "codex",
        "session_id": "session-2", "output_tokens": 15,
    }, 101)
    snapshot = usage.snapshot_usage(db)
    totals = snapshot["totals"]
    assert totals["reports"] == 2
    assert totals["input_tokens"] == 100
    assert totals["output_tokens"] == 55
    assert totals["total_tokens"] == 140
    assert totals["cost_usd"] == 0.0123
    assert totals["coverage"]["input_tokens"] == 1
    assert totals["coverage"]["output_tokens"] == 2
    assert totals["coverage"]["total_tokens"] == 1
    assert totals["coverage"]["cost_usd"] == 1
    codex = next(row for row in snapshot["by_platform"] if row["platform"] == "codex")
    assert codex["total_tokens"] is None
    assert codex["cost_usd"] is None


def test_reported_zero_is_known_but_not_a_claim_of_free_billing(db):
    usage.ensure_schema(db)
    usage.consume_usage(db, {
        "event": "usage", "usage_id": "unit", "platform": "hermes",
        "session_id": "one", "input_tokens": 0, "output_tokens": 0,
        "cost_usd": 0,
    }, 100)
    snapshot = usage.snapshot_usage(db)
    totals = snapshot["totals"]
    assert totals["total_tokens"] == 0
    assert totals["cost_usd"] == 0
    assert totals["coverage"]["cost_usd"] == 1
    assert snapshot["cost_basis"] == "runtime_estimate"
    assert totals["cost_sources"] == [
        {"source": "runtime estimate", "reports": 1, "cost_usd": 0}
    ]


def test_source_total_is_preserved_and_missing_total_needs_both_inputs(db):
    usage.ensure_schema(db)
    usage.consume_usage(db, report(total_tokens=145), 100)
    assert usage.snapshot_usage(db)["totals"]["total_tokens"] == 145
    replacement = report(total_tokens=None)
    usage.consume_usage(db, replacement, 101)
    assert usage.snapshot_usage(db)["totals"]["total_tokens"] == 140
    usage.consume_usage(db, report(
        total_tokens=None, input_tokens=None, cached_input_tokens=None,
        cache_write_tokens=None,
    ), 102)
    totals = usage.snapshot_usage(db)["totals"]
    assert totals["total_tokens"] is None
    assert totals["output_tokens"] == 40


def test_same_provider_id_is_distinct_across_sessions_and_platforms(db):
    usage.ensure_schema(db)
    usage.consume_usage(db, report(), 100)
    usage.consume_usage(db, report(session_id="session-2"), 101)
    usage.consume_usage(db, report(platform="codex"), 102)
    snapshot = usage.snapshot_usage(db)
    assert snapshot["totals"]["reports"] == 3
    assert snapshot["totals"]["total_tokens"] == 420
    assert len(snapshot["by_session"]) == 3
    opencode = next(row for row in snapshot["by_platform"] if row["platform"] == "opencode")
    assert opencode["reports"] == 2
    assert opencode["total_tokens"] == 280


@pytest.mark.parametrize("changes", [
    {"event": "tool_start"}, {"usage_id": ""}, {"session_id": None},
    {"platform": []}, {"model": {"name": "bad"}},
    {"input_tokens": -1}, {"input_tokens": True}, {"output_tokens": "40"},
    {"total_tokens": 1.5}, {"input_tokens": float("inf")},
    {"cost_usd": float("nan")}, {"cost_usd": -0.1}, {"cost_usd": True},
    {"cached_input_tokens": 101}, {"cache_write_tokens": 101},
    {"reasoning_output_tokens": 41},
])
def test_invalid_reports_cannot_overwrite_existing_valid_accounting(db, changes):
    usage.ensure_schema(db)
    usage.consume_usage(db, report(), 100)
    before = usage.snapshot_usage(db)
    assert not usage.consume_usage(db, report(**changes), 101)
    assert usage.snapshot_usage(db) == before


def test_decimal_cost_corrections_do_not_leave_rounding_residue(db):
    usage.ensure_schema(db)
    usage.consume_usage(db, report(cost_usd=0.1), 100)
    usage.consume_usage(db, report(usage_id="second", cost_usd=0.2), 101)
    assert usage.snapshot_usage(db)["totals"]["cost_usd"] == 0.3
    usage.consume_usage(db, report(cost_usd=None), 102)
    assert usage.snapshot_usage(db)["totals"]["cost_usd"] == 0.2
    usage.consume_usage(db, report(usage_id="second", cost_usd=0), 103)
    assert usage.snapshot_usage(db)["totals"]["cost_usd"] == 0


def test_large_amount_correction_preserves_smaller_remaining_cost(db):
    usage.ensure_schema(db)
    usage.consume_usage(db, report(cost_usd=1e30), 100)
    usage.consume_usage(db, report(usage_id="second", cost_usd=0.1), 101)
    usage.consume_usage(db, report(cost_usd=None), 102)
    assert usage.snapshot_usage(db)["totals"]["cost_usd"] == 0.1


def test_unrepresentable_cost_sum_cannot_break_json_and_recovers_on_correction(db):
    usage.ensure_schema(db)
    usage.consume_usage(db, report(cost_usd=1e308), 100)
    usage.consume_usage(db, report(usage_id="second", cost_usd=1e308), 101)
    snapshot = usage.snapshot_usage(db)
    assert snapshot["totals"]["cost_usd"] is None
    assert snapshot["totals"]["overflow"]["cost_usd"] is True
    assert snapshot["totals"]["coverage"]["cost_usd"] == 2
    json.dumps(snapshot, allow_nan=False)
    usage.consume_usage(db, report(cost_usd=None), 102)
    assert usage.snapshot_usage(db)["totals"]["cost_usd"] == 1e308


def test_caller_rollback_restores_usage_and_other_checkpoint_writes(db):
    usage.ensure_schema(db)
    db.execute("CREATE TABLE checkpoint(value INTEGER)")
    db.commit()
    db.execute("BEGIN")
    db.execute("INSERT INTO checkpoint VALUES (7)")
    usage.ensure_schema(db)
    usage.consume_usage(db, report(), 100)
    assert usage.snapshot_usage(db)["totals"]["reports"] == 1
    db.rollback()
    assert db.execute("SELECT count(*) FROM checkpoint").fetchone()[0] == 0
    assert usage.snapshot_usage(db)["totals"]["reports"] == 0


def test_restart_and_raw_history_pruning_preserve_replay_accuracy(tmp_path):
    path = tmp_path / "accounting.sqlite3"
    with sqlite3.connect(path) as db:
        usage.ensure_schema(db)
        db.execute("CREATE TABLE history(event TEXT)")
        db.execute("INSERT INTO history VALUES ('raw activity')")
        usage.consume_usage(db, report(), 100)
    with sqlite3.connect(path) as db:
        db.execute("DELETE FROM history")
    with sqlite3.connect(path) as db:
        usage.ensure_schema(db)
        assert not usage.consume_usage(db, report(ts=1), 100000)
        assert usage.snapshot_usage(db)["totals"]["total_tokens"] == 140
        assert usage.consume_usage(db, report(total_tokens=142), 100001)
        assert usage.snapshot_usage(db)["totals"]["total_tokens"] == 142


def test_ledger_never_persists_prompt_preview_or_unrelated_event_fields(db):
    usage.ensure_schema(db)
    usage.consume_usage(db, report(
        prompt="secret prompt content", preview="private output content",
        command="sensitive shell input", ts=123456,
    ), 100)
    dump = "\n".join(db.iterdump())
    assert "secret prompt content" not in dump
    assert "private output content" not in dump
    assert "sensitive shell input" not in dump
    assert "123456" not in dump
    json.dumps(usage.snapshot_usage(db), allow_nan=False)


def test_aggregate_snapshot_never_refolds_the_usage_unit_history(db):
    usage.ensure_schema(db)
    usage.consume_usage(db, report(), 100)

    def forbid_ledger_read(action, table, column, database, source):
        if action == sqlite3.SQLITE_READ and table == "usage_units":
            return sqlite3.SQLITE_DENY
        return sqlite3.SQLITE_OK

    db.set_authorizer(forbid_ledger_read)
    assert usage.snapshot_usage(db)["totals"]["total_tokens"] == 140


def test_reset_deletes_compact_ledger_and_aggregates_together(db):
    usage.ensure_schema(db)
    usage.consume_usage(db, report(), 100)
    db.execute("DELETE FROM usage_units")
    db.execute("DELETE FROM usage_totals")
    assert usage.snapshot_usage(db)["totals"]["reports"] == 0
    assert usage.consume_usage(db, report(), 101)
    assert usage.snapshot_usage(db)["totals"]["total_tokens"] == 140
