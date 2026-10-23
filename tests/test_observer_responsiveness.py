"""Slow ingestion must not stop the listener accepting bootstrap requests."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import http.client
import http.server
import logging
import threading

import __init__ as office


@contextmanager
def running_observer(monkeypatch, release):
    """Run the production handler with an ephemeral loopback listener."""
    servers = []
    ready = threading.Event()
    base = http.server.ThreadingHTTPServer

    class CapturedServer(base):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            servers.append(self)

    monkeypatch.setattr(http.server, 'ThreadingHTTPServer', CapturedServer)
    monkeypatch.setattr(office, '_resolve_port', lambda: 0)
    monkeypatch.setattr(office, '_port', office._port)
    worker = threading.Thread(target=office._serve,
                              kwargs={'on_ready': lambda _port: ready.set()}, daemon=True)
    worker.start()
    try:
        assert ready.wait(3), 'production listener must start'
        yield servers[0], worker
    finally:
        # Always unblock the old implementation too; failing tests must not leak
        # a server or leave a monkeypatched builder running after teardown.
        release.set()
        if servers:
            servers[0].shutdown()
        worker.join(4)
        assert not worker.is_alive(), 'observer stopped'


def get(server, route):
    connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=1)
    try:
        connection.request('GET', route)
        response = connection.getresponse()
        return response.status, response.read()
    finally:
        connection.close()


def test_stalled_maintenance_keeps_bootstrap_and_capabilities_responsive(monkeypatch):
    entered, release = threading.Event(), threading.Event()
    calls = []

    def blocked_state():
        calls.append(threading.get_ident())
        entered.set()
        assert release.wait(10), 'test released ingestion'
        return {}

    monkeypatch.setattr(office, 'build_state', blocked_state)
    with running_observer(monkeypatch, release) as (server, _):
        assert entered.wait(3), 'maintenance entered the stalled ingestion'
        paths = ['/', '/js/office.js', '/js/task-runner.js', '/js/task-desk.js', '/task-runs']
        with ThreadPoolExecutor(max_workers=len(paths)) as pool:
            replies = list(pool.map(lambda route: get(server, route), paths))
        assert all(status == 200 and body for status, body in replies)
        for _ in range(20):
            server.service_actions()
        assert len(calls) == 1, 'listener cycles must not spawn overlapping maintenance'
        # The background worker must not expand the observer trust boundary.
        connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=1)
        try:
            connection.request('GET', '/', headers={'Host': 'untrusted.example'})
            response = connection.getresponse()
            assert response.status == 403
            response.read()
        finally:
            connection.close()


def test_listener_can_stop_while_ingestion_is_stalled(monkeypatch):
    entered, release, stopped = threading.Event(), threading.Event(), threading.Event()

    def blocked_state():
        entered.set()
        assert release.wait(10), 'test released ingestion'
        return {}

    monkeypatch.setattr(office, 'build_state', blocked_state)
    with running_observer(monkeypatch, release) as (server, worker):
        assert entered.wait(3)
        def stop():
            server.shutdown()
            worker.join(2)
            if not worker.is_alive():
                stopped.set()
        stopper = threading.Thread(target=stop, daemon=True)
        stopper.start()
        try:
            assert stopped.wait(3), 'stalled disk ingestion must not prevent listener shutdown'
        finally:
            release.set()
            stopper.join(3)
        maintenance = getattr(server, '_maintenance_thread', None)
        if maintenance is not None:
            maintenance.join(2)
            assert not maintenance.is_alive(), 'stopped worker exits after its current read'


def test_ingestion_failure_is_redacted_and_does_not_kill_maintenance(monkeypatch, caplog):
    release, recovered = threading.Event(), threading.Event()
    calls = []
    def flaky_state():
        calls.append(1)
        if len(calls) == 1:
            raise OSError('sensitive-path secret-token private-event-body')
        recovered.set()
        return {}
    monkeypatch.setattr(office, 'build_state', flaky_state)
    caplog.set_level(logging.WARNING, logger=office.logger.name)
    with running_observer(monkeypatch, release) as (server, _):
        assert recovered.wait(4), 'next maintenance pass recovers without a page request'
        assert get(server, '/js/office.js')[0] == 200
    assert 'OSError' in caplog.text
    assert not any(value in caplog.text for value in ['sensitive-path', 'secret-token', 'private-event-body'])


def test_broken_logging_destination_does_not_end_maintenance(monkeypatch):
    release, recovered = threading.Event(), threading.Event()
    calls = []

    def flaky_state():
        calls.append(1)
        if len(calls) == 1:
            raise OSError('synthetic ingestion failure')
        recovered.set()
        return {}

    def broken_logger(*args, **kwargs):
        raise RuntimeError('synthetic log destination failure')

    monkeypatch.setattr(office, 'build_state', flaky_state)
    monkeypatch.setattr(office.logger, 'warning', broken_logger)
    with running_observer(monkeypatch, release) as (server, _):
        assert recovered.wait(4), 'logging failure must not disable future ingestion'
        assert get(server, '/js/office.js')[0] == 200
