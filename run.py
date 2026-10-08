#!/usr/bin/env python3
"""Serve Agent Office without installing Hermes or changing runtime settings."""
import argparse
import os
from pathlib import Path
import signal
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=int(os.environ.get('AGENT_OFFICE_PORT', 8113)))
    parser.add_argument('--enable-task-runner', action='store_true',
                        help='allow this server to launch supported local agent CLIs')
    parser.add_argument('--workspace', action='append', default=[], metavar='/ABSOLUTE/PROJECT',
                        help='allowlisted project directory (repeatable; requires --enable-task-runner)')
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('port must be between 1 and 65535')
    if args.enable_task_runner and not args.workspace:
        parser.error('--enable-task-runner requires at least one --workspace')
    if args.workspace and not args.enable_task_runner:
        parser.error('--workspace requires --enable-task-runner')
    os.environ['AGENT_OFFICE_PORT'] = str(args.port)
    import __init__ as office
    task_runner = None
    if args.enable_task_runner:
        from task_runner import TaskRunner
        try:
            task_runner = TaskRunner([Path(path) for path in args.workspace])
        except ValueError as exc:
            parser.error(str(exc))
    def stop_on_sigterm(_signum, _frame):
        raise KeyboardInterrupt

    previous_sigterm = None
    if hasattr(signal, 'SIGTERM'):
        previous_sigterm = signal.signal(signal.SIGTERM, stop_on_sigterm)
    try:
        office._serve(
            task_runner=task_runner,
            on_ready=lambda port: print(
                f'Agent Office — http://127.0.0.1:{port} (Ctrl+C to stop)', flush=True
            ),
        )
    except office.TaskRunnerStartupError as exc:
        print(f'Agent Office: {exc}', file=sys.stderr)
        raise SystemExit(1)
    except KeyboardInterrupt:
        pass
    finally:
        if previous_sigterm is not None:
            signal.signal(signal.SIGTERM, previous_sigterm)


if __name__ == '__main__':
    main()
