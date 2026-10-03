# Project status

Verified locally 2026-10-03. Agent Office is an observer dashboard with Hermes,
OpenCode, Claude, and VS Code integrations, a local web server, assets, and
automated tests.

Verification: 34 Python tests and five Node bridge tests pass. The bridge
tests write real event files with current OpenCode SDK event shapes and a
custom `HERMES_HOME`. Installer tests cover valid empty configurations and
preserve invalid JSON configurations. The demo feed served two synthetic
sessions through the real hook callbacks and local HTTP server.

Quick check: install `requirements-dev.txt`, run `python3 -m pytest -q` and
`npm --prefix opencode test`, then use `python3 demo_feed.py` to populate the
local office. The demo uses synthetic activity; a live multi-agent run was
not part of this verification. CI remains manually dispatched.

Readiness: usable local observer; it does not execute agents or enforce policy.
