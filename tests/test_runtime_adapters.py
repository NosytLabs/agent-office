"""Real local adapter payload → immutable inbox → restarted durable state."""
import json
import os
from pathlib import Path
import subprocess
import sys

import __init__ as office
from event_store import EventStore

ROOT = Path(__file__).resolve().parents[1]


def state(directory, now=1000):
    # New store per request verifies persistence, not process-local cached state.
    return EventStore(directory).consume(lambda: [], now)


def agents(snapshot):
    return {agent["id"]: agent for agent in snapshot["agents"]}


def test_opencode_real_child_lifecycle_through_bridge_inbox_and_restart(tmp_path):
    script = f"""
      import factory from {json.dumps((ROOT / 'opencode/index.js').as_uri())};
      import readline from 'node:readline';
      Date.now = () => 1000000;
      const bridge = await factory();
      for await (const line of readline.createInterface({{input: process.stdin}})) {{
        for (const event of JSON.parse(line)) {{
          if (event.hook) await bridge[event.hook](event.input, event.output ?? {{}});
          else await bridge.event({{event}});
        }}
        process.stdout.write('published\\n');
      }}
    """
    process = subprocess.Popen(["node", "--input-type=module", "-e", script], stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                               env={**os.environ, "HERMES_HOME": str(tmp_path)})
    directory = tmp_path / "pixel-office"

    def send(events):
        process.stdin.write(json.dumps(events) + "\n")
        process.stdin.flush()
        assert process.stdout.readline() == "published\n"

    try:
        send([
            {"type": "session.created", "properties": {"info": {"id": "parent"}}},
            {"hook": "tool.execute.before", "input": {"sessionID": "parent", "callID": "delegate", "tool": "task"},
             "output": {"args": {"description": "Review source"}}},
            {"type": "session.created", "properties": {"info": {"id": "child", "parentID": "parent", "title": "Review source"}}},
            {"hook": "tool.execute.before", "input": {"sessionID": "child", "callID": "read", "tool": "read"}},
        ])
        first = state(directory)
        observed = agents(first)
        assert set(observed) == {"parent", "child"}  # no synthetic task clone
        assert observed["child"]["kind"] == "subagent" and observed["child"]["parent"] == "parent"
        assert observed["child"]["status"] == "working" and observed["child"]["tool"] == "read"
        assert first["progress"]["stats"]["subagents"] == 1
        send([{"type": "session.status", "properties": {"sessionID": "child", "status": {"type": "idle"}}}])
        done = agents(state(directory, 1001))
        assert done["child"]["status"] == "done" and done["parent"]["status"] == "working"
        assert agents(state(directory, 1121))["child"]["status"] == "done"
        assert set(agents(state(directory, 1122))) == {"parent"}
        send([{"type": "message.part.updated", "properties": {"part": {
            "sessionID": "child", "type": "tool", "callID": "read", "tool": "read",
            "state": {"status": "completed", "time": {"start": 1000, "end": 1001}}}}}])
        assert set(agents(state(directory, 1123))) == {"parent"}
        assert not list((directory / "inbox").glob("*.json"))
    finally:
        process.stdin.close()
        process.wait(timeout=10)
        assert process.returncode == 0, process.stderr.read()


def test_hermes_real_callbacks_preserve_parent_and_completed_child(tmp_path, monkeypatch):
    monkeypatch.setattr(office, "_office_dir", lambda: tmp_path)
    monkeypatch.setattr(office, "_ensure_server", lambda: None)
    monkeypatch.setattr(office, "_server_bound", lambda: True)
    monkeypatch.setattr(office.time, "time", lambda: 1000)
    office._on_session_start(session_id="parent", platform="hermes")
    office._pre_llm_call(session_id="parent")
    office._subagent_start(parent_session_id="parent", child_session_id="child", child_goal="Review")
    office._pre_tool_call(session_id="child", tool_call_id="read", tool_name="read_file")
    observed = agents(state(tmp_path))
    assert observed["child"]["status"] == "working" and observed["child"]["parent"] == "parent"
    office._subagent_stop(child_session_id="child")
    assert agents(state(tmp_path, 1001))["child"]["status"] == "done"
    assert agents(state(tmp_path, 1121))["child"]["status"] == "done"
    assert set(agents(state(tmp_path, 1122))) == {"parent"}
    office._post_tool_call(session_id="child", tool_call_id="read", tool_name="read_file", status="ok")
    assert set(agents(state(tmp_path, 1123))) == {"parent"}
    office._post_llm_call(session_id="parent")
    assert agents(state(tmp_path, 1123))["parent"]["status"] == "idle"


def test_codex_stdin_permission_interrupt_and_child_completion_through_inbox(tmp_path):
    def send(name, **fields):
        result = subprocess.run([sys.executable, str(ROOT / "codex/hook.py")],
                                input=json.dumps({"hook_event_name": name, "session_id": "parent", **fields}),
                                text=True, capture_output=True, env={**os.environ, "HERMES_HOME": str(tmp_path)})
        assert result.returncode == 0 and result.stdout == "" and result.stderr == ""
    import time
    now = time.time()
    directory = tmp_path / "pixel-office"
    send("SessionStart")
    send("PreToolUse", tool_name="Bash", tool_use_id="run", tool_input={"command": "pytest"})
    send("PermissionRequest", tool_name="Bash", tool_input={"command": "pytest"})
    assert agents(state(directory, now))["parent"]["status"] == "waiting"
    send("PostToolUse", tool_name="Bash", tool_use_id="run", tool_response={"exit_code": 0})
    assert agents(state(directory, now))["parent"]["status"] == "thinking"
    send("SubagentStart", agent_id="child", agent_type="reviewer")
    send("SubagentStop", agent_id="child", agent_type="reviewer")
    assert agents(state(directory, now))["child"]["status"] == "done"
    send("Interrupt", turn_id="turn")
    assert agents(state(directory, now))["parent"]["status"] == "idle"
    assert set(agents(state(directory, now + 122))) == {"parent"}


def opencode_once(home, events):
    """Each call constructs a fresh plugin, as after an OpenCode restart."""
    script = f"""
      import factory from {json.dumps((ROOT / 'opencode/index.js').as_uri())};
      Date.now = () => 1000000;
      const bridge = await factory();
      for (const event of JSON.parse(process.argv[1])) await bridge.event({{event}});
    """
    result = subprocess.run(["node", "--input-type=module", "-e", script, json.dumps(events)],
                            text=True, capture_output=True, env={**os.environ, "HERMES_HOME": str(home)})
    assert result.returncode == 0 and result.stdout == "" and result.stderr == ""


def test_opencode_plugin_restart_keeps_known_child_completion_and_removal(tmp_path):
    directory = tmp_path / "pixel-office"
    opencode_once(tmp_path, [
        {"type": "session.created", "properties": {"info": {"id": "parent"}}},
        {"type": "session.created", "properties": {"info": {"id": "child", "parentID": "parent"}}},
    ])
    assert agents(state(directory))["child"]["status"] == "working"
    idle = {"type": "session.status", "properties": {"sessionID": "child", "status": {"type": "idle"}}}
    # The new JS instance has no childSessions metadata; SQLite still does.
    opencode_once(tmp_path, [idle])
    assert agents(state(directory, 1001))["child"]["status"] == "done"
    assert set(agents(state(directory, 1122))) == {"parent"}
    opencode_once(tmp_path, [idle, idle])
    assert set(agents(state(directory, 1123))) == {"parent"}
    opencode_once(tmp_path, [
        {"type": "session.updated", "properties": {"info": {"id": "child", "parentID": "parent", "title": "Updated title"}}},
        idle,
    ])
    assert set(agents(state(directory, 1124))) == {"parent"}


def test_hermes_repeated_stop_and_late_turn_completion_cannot_renew_child_lifetime(tmp_path, monkeypatch):
    monkeypatch.setattr(office, "_office_dir", lambda: tmp_path)
    monkeypatch.setattr(office, "_ensure_server", lambda: None)
    monkeypatch.setattr(office, "_server_bound", lambda: True)
    monkeypatch.setattr(office.time, "time", lambda: 1000)
    office._on_session_start(session_id="parent", platform="hermes")
    office._subagent_start(parent_session_id="parent", child_session_id="child")
    office._subagent_stop(child_session_id="child")
    assert agents(state(tmp_path))["child"]["status"] == "done"
    assert set(agents(state(tmp_path, 1121))) == {"parent"}
    office._subagent_stop(child_session_id="child")
    office._post_llm_call(session_id="child")
    assert set(agents(state(tmp_path, 1122))) == {"parent"}
    # Explicit new work is still allowed to reopen the same runtime identity.
    office._subagent_start(parent_session_id="parent", child_session_id="child")
    assert agents(state(tmp_path, 1123))["child"]["status"] == "working"


def test_orphan_terminal_events_after_tombstone_expiry_do_not_create_agents(tmp_path, monkeypatch):
    monkeypatch.setattr(office, "_office_dir", lambda: tmp_path)
    monkeypatch.setattr(office, "_ensure_server", lambda: None)
    monkeypatch.setattr(office, "_server_bound", lambda: True)
    monkeypatch.setattr(office.time, "time", lambda: 1000)
    office._subagent_start(parent_session_id="parent", child_session_id="child")
    office._subagent_stop(child_session_id="child")
    state(tmp_path)
    assert not state(tmp_path, 3000)["agents"]
    office._post_tool_call(session_id="child", tool_call_id="read", tool_name="read_file", status="ok")
    office._post_approval_response(session_id="child", request_id="approval", choice="once")
    assert not state(tmp_path, 3001)["agents"]
