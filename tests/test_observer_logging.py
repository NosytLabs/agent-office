"""Observer diagnostics must stay bounded and must never stop the runtime."""
from concurrent.futures import ThreadPoolExecutor
import logging

import pytest
import __init__ as office
import event_inbox


@pytest.fixture
def failing_publisher(tmp_path, monkeypatch, caplog):
    clock = [100.0]
    attempts = []
    monkeypatch.setattr(office, '_publish_warning_at', None, raising=False)
    monkeypatch.setattr(office, '_publish_warnings_suppressed', 0, raising=False)
    monkeypatch.setattr(office.time, 'monotonic', lambda: clock[0])
    monkeypatch.setattr(office, '_office_dir', lambda: tmp_path)
    monkeypatch.setattr(office, '_ensure_server', lambda: None)
    monkeypatch.setattr(office, '_server_bound', lambda: True)

    def fail(directory, event):
        attempts.append(event)
        raise OSError('private/path secret-token event-body must not enter diagnostics')

    monkeypatch.setattr(event_inbox, 'publish', fail)
    caplog.set_level(logging.WARNING, logger=office.logger.name)
    return clock, attempts


def test_repeated_failures_limit_only_warnings_not_event_attempts(failing_publisher, caplog):
    _, attempts = failing_publisher
    for i in range(200):
        office._publish({'event': 'tool_start', 'call_id': str(i)})
    assert len(attempts) == 200
    assert len(caplog.records) == 1


def test_publish_diagnostic_omits_raw_exception_and_event_text(failing_publisher, caplog):
    office._publish({'event': 'tool_start', 'detail': 'event-body'})
    assert 'OSError' in caplog.text
    assert not any(value in caplog.text for value in ('private/path', 'secret-token', 'event-body'))


def test_next_warning_summarizes_suppressed_failures(failing_publisher, caplog):
    clock, _ = failing_publisher
    for _ in range(4):
        office._publish({'event': 'tool_start'})
    clock[0] += 60
    office._publish({'event': 'tool_start'})
    assert len(caplog.records) == 2
    assert '3 similar warnings suppressed' in caplog.records[-1].getMessage()


def test_failing_log_handler_cannot_escape_into_agent_loop(failing_publisher, monkeypatch):
    def broken_handler(*args, **kwargs):
        raise RuntimeError('logging destination unavailable')
    monkeypatch.setattr(office.logger, 'warning', broken_handler)
    office._publish({'event': 'tool_start'})


def test_concurrent_hook_failures_share_one_diagnostic_window(failing_publisher, caplog):
    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(lambda _: office._publish({'event': 'tool_start'}), range(64)))
    assert len(caplog.records) == 1


def test_successful_events_publish_during_a_warning_cooldown(tmp_path, monkeypatch, caplog):
    monkeypatch.setattr(office, '_publish_warning_at', 100.0, raising=False)
    monkeypatch.setattr(office, '_publish_warnings_suppressed', 9, raising=False)
    monkeypatch.setattr(office.time, 'monotonic', lambda: 110.0)
    monkeypatch.setattr(office, '_office_dir', lambda: tmp_path)
    monkeypatch.setattr(office, '_ensure_server', lambda: None)
    monkeypatch.setattr(office, '_server_bound', lambda: True)
    office._publish({'event': 'session_start', 'session_id': 'healthy', 'platform': 'hermes'})
    assert len(list((tmp_path / 'inbox').glob('*.json'))) == 1
    assert not caplog.records


def test_server_start_failure_does_not_claim_a_published_event_was_lost(tmp_path, monkeypatch, caplog):
    monkeypatch.setattr(office, '_publish_warning_at', None)
    monkeypatch.setattr(office, '_publish_warnings_suppressed', 0)
    monkeypatch.setattr(office, '_office_dir', lambda: tmp_path)
    def cannot_start():
        raise OSError('private server configuration')
    monkeypatch.setattr(office, '_ensure_server', cannot_start)
    office._publish({'event': 'session_start', 'session_id': 'already-published'})
    assert len(list((tmp_path / 'inbox').glob('*.json'))) == 1
    assert 'observer event handling failed' in caplog.text
    assert 'failed to record event' not in caplog.text
    assert 'private server configuration' not in caplog.text
