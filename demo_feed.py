#!/usr/bin/env python3
"""Synthetic office activity in a temporary workspace. Never writes live progress."""
import argparse
import os
import random
import tempfile
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8114)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('port must be between 1 and 65535')
    # A demo is always isolated, even if the shell sets a live HERMES_HOME.
    with tempfile.TemporaryDirectory(prefix='agent-office-demo-') as demo_home:
        os.environ['HERMES_HOME'] = demo_home
        os.environ['AGENT_OFFICE_PORT'] = str(args.port)
        os.environ['AGENT_OFFICE_DEMO'] = '1'
        import __init__ as office
        if office._probe_port(args.port) == 'office':
            parser.error('port is already running an office; choose another --port')
        sessions = [('cli', 'cli-build'), ('claude', 'claude-review'), ('opencode', 'opencode-api'),
                    ('telegram', 'telegram-notes'), ('hermes', 'hermes-research')]
        for platform, sid in sessions:
            office._on_session_start(session_id=sid, platform=platform)
        office._subagent_start(parent_session_id='cli-build', child_session_id='sub-tests', child_goal='Check the test suite')
        print(f'DEMO — synthetic activity, separate progress: http://127.0.0.1:{args.port}', flush=True)
        tools = [('terminal', {'command': 'python -m pytest -q'}), ('read_file', {'path': 'README.md'}),
                 ('write_file', {'path': 'src/app.ts'}), ('web_search', {'query': 'Python documentation'})]
        try:
            n = 0
            while True:
                for _, sid in sessions:
                    tool, payload = random.choice(tools)
                    office._pre_tool_call(session_id=sid, tool_name=tool, args=payload)
                time.sleep(3)
                for _, sid in sessions:
                    office._post_tool_call(session_id=sid, tool_name='terminal', status='ok')
                if n % 3 == 0:
                    office._publish({'event': 'approval_request', 'session_id': 'claude-review', 'command': 'Apply the reviewed patch'})
                office._pre_tool_call(session_id='sub-tests', tool_name='terminal', args={'command': 'Run regression tests'})
                time.sleep(5)
                office._post_approval_response(session_id='claude-review', choice='once')
                n += 1
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
