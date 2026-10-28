#!/usr/bin/env python3
"""Synthetic office activity in a temporary workspace. Never writes live progress."""
import argparse
import os
import random
import signal
import sys
import tempfile
import threading


def _feed(office, sessions, stopped):
    tools = [('terminal', {'command': 'python -m pytest -q'}), ('read_file', {'path': 'README.md'}),
             ('write_file', {'path': 'src/app.ts'}), ('web_search', {'query': 'Python documentation'})]
    n = 0
    while not stopped.is_set():
        for _, sid in sessions:
            if stopped.is_set():
                return
            tool, payload = random.choice(tools)
            office._pre_tool_call(session_id=sid, tool_name=tool, args=payload)
        if stopped.wait(3):
            return
        for _, sid in sessions:
            if stopped.is_set():
                return
            office._post_tool_call(session_id=sid, tool_name='terminal', status='ok')
        if n % 3 == 0:
            office._publish({'event': 'approval_request', 'session_id': 'claude-review', 'command': 'Apply the reviewed patch'})
        office._pre_tool_call(session_id='sub-tests', tool_name='terminal', args={'command': 'Run regression tests'})
        if stopped.wait(5):
            return
        office._post_approval_response(session_id='claude-review', choice='once')
        n += 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8114)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('port must be between 1 and 65535')
    def stop_on_sigterm(_signum, _frame):
        raise KeyboardInterrupt

    previous_sigterm = None
    if hasattr(signal, 'SIGTERM'):
        previous_sigterm = signal.signal(signal.SIGTERM, stop_on_sigterm)
    try:
        # A demo is always isolated, even if the shell sets a live HERMES_HOME.
        with tempfile.TemporaryDirectory(prefix='agent-office-demo-') as demo_home:
            os.environ['HERMES_HOME'] = demo_home
            os.environ['AGENT_OFFICE_PORT'] = str(args.port)
            os.environ['AGENT_OFFICE_DEMO'] = '1'
            import __init__ as office
            sessions = [('cli', 'cli-build'), ('claude', 'claude-review'), ('opencode', 'opencode-api'),
                        ('telegram', 'telegram-notes'), ('hermes', 'hermes-research')]
            stopped = threading.Event()
            producer = threading.Thread(target=_feed, args=(office, sessions, stopped),
                                        name='agent-office-demo-feed', daemon=True)

            def ready(port):
                for platform, sid in sessions:
                    office._on_session_start(session_id=sid, platform=platform)
                office._subagent_start(parent_session_id='cli-build', child_session_id='sub-tests', child_goal='Check the test suite')
                producer.start()
                print(f'DEMO — synthetic activity, separate progress: http://127.0.0.1:{port}', flush=True)

            # The main thread owns the listener. Demo publications must not
            # start a second hook server, including while shutdown is in progress.
            with office._server_start_lock:
                previous_server_thread = office._server_thread
                office._server_thread = threading.current_thread()
            try:
                office._serve(require_bind=True, on_ready=ready)
            except office.ObserverStartupError as exc:
                print(f'Agent Office demo: {exc}', file=sys.stderr)
                raise SystemExit(1)
            finally:
                stopped.set()
                if producer.is_alive():
                    producer.join()
                with office._server_start_lock:
                    office._server_thread = previous_server_thread
    except KeyboardInterrupt:
        pass
    finally:
        if previous_sigterm is not None:
            signal.signal(signal.SIGTERM, previous_sigterm)


if __name__ == '__main__':
    main()
