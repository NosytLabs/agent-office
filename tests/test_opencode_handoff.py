"""Contract tests for the OpenCode session handoff adapter (issue #18).

These tests use a synthetic in-process transport fixture.  They establish the
adapter's pairing, durability, reconciliation, and cancellation behaviour;
they do not verify an installed OpenCode runtime or a provider account.
"""
from __future__ import annotations

import json
import uuid

import pytest

import opencode_handoff as handoff
from opencode_handoff import (
    HandoffError,
    OpenCodeHandoff,
    TransportFailure,
    TransportResponse,
)

SERVER = "http://127.0.0.1:4096"
SESSION = "ses_test123"


class FakeOpenCode:
    """A scriptable stand-in for the OpenCode server HTTP contract."""

    def __init__(self, directory: str, *, version: str = "2.0.29"):
        self.directory = directory
        self.version = version
        self.healthy = True
        self.sessions = {SESSION: {"id": SESSION, "title": "Fixture session",
                                   "directory": directory}}
        self.messages: list[dict] = []
        self.status: dict = {}
        self.permissions: list[dict] = []
        self.questions: list[dict] = []
        self.prompt_calls: list[dict] = []
        self.abort_calls: list[str] = []
        self.reject_status: int | None = None
        self.drop_ack = False        # accept the prompt, then lose the ack
        self.drop_before_accept = False  # lose the request before accepting

    def __call__(self, method, url, body, timeout):
        assert url.startswith(SERVER), url
        path = url[len(SERVER):]
        if path == "/global/health":
            return TransportResponse(200, {"healthy": self.healthy, "version": self.version})
        if path == f"/session/{SESSION}":
            session = self.sessions.get(SESSION)
            return TransportResponse(200 if session else 404, session)
        if path == f"/session/{SESSION}/message":
            if method == "GET":
                return TransportResponse(200, self.messages)
        if path == f"/session/{SESSION}/prompt_async":
            self.prompt_calls.append(body)
            if self.drop_before_accept:
                raise TransportFailure("connection reset", may_have_been_accepted=True)
            if self.reject_status is not None:
                return TransportResponse(self.reject_status, {"error": "provider said no"})
            self.accept(body)
            if self.drop_ack:
                raise TransportFailure("timeout after send", may_have_been_accepted=True)
            return TransportResponse(204, None)
        if path == f"/session/{SESSION}/abort":
            self.abort_calls.append(SESSION)
            self.status[SESSION] = {"type": "idle"}
            return TransportResponse(200, True)
        if path == "/session/status":
            return TransportResponse(200, self.status)
        if path == "/permission":
            return TransportResponse(200, self.permissions)
        if path == "/question":
            return TransportResponse(200, self.questions)
        return TransportResponse(404, None)

    def accept(self, body):
        text = body["parts"][0]["text"]
        self.messages.append({
            "info": {"id": f"msg_user_{len(self.messages)}", "role": "user",
                     "sessionID": SESSION, "time": {"created": 1}},
            "parts": [{"type": "text", "text": text}],
        })
        self.status[SESSION] = {"type": "busy"}

    def complete_turn(self, *, error_name: str | None = None):
        info = {"id": f"msg_asst_{len(self.messages)}", "role": "assistant",
                "sessionID": SESSION, "time": {"created": 2, "completed": 3}}
        if error_name:
            info["error"] = {"name": error_name, "data": {"message": "sensitive detail"}}
        self.messages.append({"info": info, "parts": [{"type": "text", "text": "done"}]})
        self.status[SESSION] = {"type": "idle"}


@pytest.fixture()
def project(tmp_path):
    return tmp_path / "project"


@pytest.fixture()
def fake(project):
    project.mkdir()
    return FakeOpenCode(str(project.resolve()))


@pytest.fixture()
def adapter(tmp_path, fake):
    return OpenCodeHandoff(tmp_path / "handoff.json", transport=fake)


def pair(adapter, project):
    return adapter.pair({
        "server_url": SERVER,
        "session_id": SESSION,
        "project_directory": str(project),
    })


def submit(adapter, prompt="hello", request_id=None):
    return adapter.submit({
        "request_id": request_id or str(uuid.uuid4()),
        "prompt": prompt,
    })


def test_pairing_records_runtime_version_and_session(adapter, fake, project):
    result = pair(adapter, project)
    assert result["pairing"]["runtime_version"] == "2.0.29"
    assert result["pairing"]["session_id"] == SESSION
    assert result["pairing"]["project_directory"] == str(project.resolve())


@pytest.mark.parametrize("url", [
    "https://127.0.0.1:4096",          # TLS scheme is not the local server contract
    "http://192.168.1.10:4096",        # not loopback
    "http://user@127.0.0.1:4096",      # credentials are never accepted
    "http://127.0.0.1:4096/path",      # an origin has no path
    "http://127.0.0.1",                # an explicit port is required
])
def test_pairing_rejects_non_loopback_or_malformed_origins(adapter, fake, project, url):
    with pytest.raises(HandoffError) as caught:
        adapter.pair({"server_url": url, "session_id": SESSION,
                      "project_directory": str(project)})
    assert caught.value.status == 400
    assert fake.prompt_calls == []


def test_pairing_rejects_unhealthy_runtime(adapter, fake, project):
    fake.healthy = False
    with pytest.raises(HandoffError) as caught:
        pair(adapter, project)
    assert caught.value.status == 409


def test_pairing_rejects_stale_project_selection(adapter, fake, project, tmp_path):
    other = tmp_path / "other"
    other.mkdir()
    with pytest.raises(HandoffError) as caught:
        adapter.pair({"server_url": SERVER, "session_id": SESSION,
                      "project_directory": str(other)})
    assert caught.value.status == 409


def test_submit_requires_pairing(adapter, fake):
    with pytest.raises(HandoffError) as caught:
        submit(adapter)
    assert caught.value.status == 409
    assert fake.prompt_calls == []


def test_submit_preserves_literal_prompt_with_shell_metacharacters(adapter, fake, project):
    pair(adapter, project)
    prompt = "run `rm -rf /` ; echo $HOME && cat a|b > c"
    result, created = submit(adapter, prompt)
    assert created is True
    assert result["operation"]["prompt"] == prompt
    assert fake.prompt_calls[0]["parts"][0]["text"] == prompt
    # Acceptance is not completion.
    assert result["operation"]["state"] == "accepted"


def test_double_submit_with_same_request_id_dispatches_once(adapter, fake, project):
    pair(adapter, project)
    request_id = str(uuid.uuid4())
    first, created_first = submit(adapter, "hello", request_id)
    second, created_second = submit(adapter, "hello", request_id)
    assert created_first is True and created_second is False
    assert first["operation"]["id"] == second["operation"]["id"]
    assert len(fake.prompt_calls) == 1


def test_request_id_reuse_with_different_prompt_is_rejected(adapter, fake, project):
    pair(adapter, project)
    request_id = str(uuid.uuid4())
    submit(adapter, "hello", request_id)
    with pytest.raises(HandoffError) as caught:
        submit(adapter, "different", request_id)
    assert caught.value.status == 409
    assert len(fake.prompt_calls) == 1


def test_lost_acknowledgement_reconciles_without_redispatch(adapter, fake, project):
    pair(adapter, project)
    fake.drop_ack = True
    result, _ = submit(adapter, "are you there")
    operation = result["operation"]
    assert operation["state"] == "unknown"
    fake.complete_turn()
    refreshed = adapter.refresh(operation["id"])["operation"]
    assert refreshed["state"] == "completed"
    assert refreshed["delivered_message_id"] is not None
    assert len(fake.prompt_calls) == 1  # reconciled, never resent


def test_uncertain_delivery_with_no_runtime_trace_stays_unknown(adapter, fake, project):
    pair(adapter, project)
    fake.drop_before_accept = True
    result, _ = submit(adapter, "lost in transit")
    operation = result["operation"]
    assert operation["state"] == "unknown"
    refreshed = adapter.refresh(operation["id"])["operation"]
    assert refreshed["state"] == "unknown"
    assert len(fake.prompt_calls) == 1


def test_runtime_rejection_is_terminal_and_redacted(adapter, fake, project):
    pair(adapter, project)
    fake.reject_status = 422
    result, _ = submit(adapter, "no thanks")
    operation = result["operation"]
    assert operation["state"] == "rejected"
    assert operation["finished_at"] is not None
    assert "provider said no" in operation["error"]


def test_executing_then_completed_states_are_distinguishable(adapter, fake, project):
    pair(adapter, project)
    result, _ = submit(adapter, "work")
    operation_id = result["operation"]["id"]
    assert adapter.refresh(operation_id)["operation"]["state"] == "executing"
    fake.complete_turn()
    assert adapter.refresh(operation_id)["operation"]["state"] == "completed"


def test_permission_and_question_waits_surface_as_awaiting_input(adapter, fake, project):
    pair(adapter, project)
    result, _ = submit(adapter, "work")
    operation_id = result["operation"]["id"]
    fake.permissions.append({"id": "perm_1", "sessionID": SESSION})
    assert adapter.refresh(operation_id)["operation"]["state"] == "awaiting_input"
    fake.permissions.clear()
    fake.questions.append({"id": "ques_1", "sessionID": SESSION})
    assert adapter.refresh(operation_id)["operation"]["state"] == "awaiting_input"


def test_assistant_error_is_a_failure_not_a_completion(adapter, fake, project):
    pair(adapter, project)
    result, _ = submit(adapter, "work")
    fake.complete_turn(error_name="ProviderAuthError")
    refreshed = adapter.refresh(result["operation"]["id"])["operation"]
    assert refreshed["state"] == "failed"
    assert "ProviderAuthError" in refreshed["error"]
    assert "sensitive detail" not in refreshed["error"]


def test_cancellation_aborts_only_the_paired_session(adapter, fake, project):
    pair(adapter, project)
    result, _ = submit(adapter, "work")
    operation_id = result["operation"]["id"]
    fake.complete_turn(error_name="MessageAbortedError")
    cancelled = adapter.cancel(operation_id)["operation"]
    assert fake.abort_calls == [SESSION]
    assert cancelled["cancel_requested"] is True
    assert cancelled["state"] == "cancelled"


def test_restart_preserves_pairing_receipts_and_dedupes(adapter, fake, project, tmp_path):
    pair(adapter, project)
    request_id = str(uuid.uuid4())
    result, _ = submit(adapter, "durable hello", request_id)
    restarted = OpenCodeHandoff(tmp_path / "handoff.json", transport=fake)
    status = restarted.status()
    assert status["paired"] is True
    assert [op["id"] for op in status["operations"]] == [result["operation"]["id"]]
    again, created = restarted.submit({"request_id": request_id, "prompt": "durable hello"})
    assert created is False
    assert again["operation"]["id"] == result["operation"]["id"]
    assert len(fake.prompt_calls) == 1


def test_ledger_file_is_separate_and_self_describing(adapter, fake, project, tmp_path):
    pair(adapter, project)
    submit(adapter, "hello")
    data = json.loads((tmp_path / "handoff.json").read_text())
    assert set(data) == {"version", "pairing", "operations"}
    assert data["operations"][0]["prompt"] == "hello"


def test_corrupt_ledger_is_an_error_not_a_silent_reset(tmp_path, fake):
    path = tmp_path / "handoff.json"
    path.write_text("{not json")
    with pytest.raises(HandoffError) as caught:
        OpenCodeHandoff(path, transport=fake)
    assert caught.value.status == 503


def test_prompt_validation_bounds(adapter, fake, project):
    pair(adapter, project)
    with pytest.raises(HandoffError):
        submit(adapter, "   ")
    with pytest.raises(HandoffError):
        submit(adapter, "x" * (handoff.MAX_PROMPT_CHARS + 1))
    assert fake.prompt_calls == []


def test_active_operation_limit_is_bounded(adapter, fake, project):
    pair(adapter, project)
    submit(adapter, "one")
    submit(adapter, "two")
    with pytest.raises(HandoffError) as caught:
        submit(adapter, "three")
    assert caught.value.status == 409
    assert len(fake.prompt_calls) == 2


def test_pruning_never_drops_active_receipts(tmp_path, fake, project, monkeypatch):
    monkeypatch.setattr(handoff, "MAX_RECEIPTS", 3)
    adapter = OpenCodeHandoff(tmp_path / "handoff.json", transport=fake)
    pair(adapter, project)
    active, _ = submit(adapter, "keep me")
    fake.reject_status = 400
    for label in ("a", "b", "c"):
        submit(adapter, label)
    fake.reject_status = None
    retained = [op["id"] for op in adapter.status()["operations"]]
    assert active["operation"]["id"] in retained
    assert len(retained) == 3
