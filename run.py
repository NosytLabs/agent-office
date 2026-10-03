#!/usr/bin/env python3
"""Serve Agent Office without installing Hermes or changing runtime settings."""
import argparse
import os


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=int(os.environ.get('AGENT_OFFICE_PORT', 8113)))
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('port must be between 1 and 65535')
    os.environ['AGENT_OFFICE_PORT'] = str(args.port)
    import __init__ as office
    print(f'Agent Office — http://127.0.0.1:{args.port} (Ctrl+C to stop)', flush=True)
    try:
        office._serve()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
