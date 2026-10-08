"""Process, validation, and lifecycle boundaries for the opt-in task runner."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
import uuid

import pytest

from task_runner import MAX_OUTPUT_BYTES, TaskRunner, TaskRunnerError


@pytest.fixture
def runner(tmp_path, monkeypatch):
    binaries = tmp_path / "bin"
    binaries.mkdir()
    source = f"""#!{sys.executable}
import json, os, subprocess, sys, time
prompt = sys.stdin.read()
if prompt == 'sleep':
    print('started', flush=True)
    time.sleep(30)
elif prompt == 'descendant':
    child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])
    open('descendant.pid', 'w').write(str(child.pid))
    print('leader exited', flush=True)
elif prompt == 'fail':
    print('provider failure')
    raise SystemExit(7)
elif prompt == 'huge':
    sys.stdout.buffer.write(b'x' * ({MAX_OUTPUT_BYTES} + 8192))
else:
    print(json.dumps({{'argv': sys.argv[1:], 'cwd': os.getcwd(), 'stdin': prompt}}))
"""
    for name in ("codex", "claude"):
        path = binaries / name
        path.write_text(source)
        path.chmod(0o755)
    monkeypatch.setenv("PATH", str(binaries))
    first = tmp_path / "one"
    second = tmp_path / "two"
    first.mkdir()
    second.mkdir()
    manager = TaskRunner([first, second])
    yield manager
    manager.shutdown(timeout=3)


def _payload(**updates):
    payload = {
        "request_id": str(uuid.uuid4()),
        "runtime": "codex",
        "workspace_id": "w1",
        "prompt": "explain $(touch never-created); `uname` & exit",
        "mode": "read",
    }
    payload.update(updates)
    return payload


def _finished(manager, run_id, timeout=5):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        run = manager.detail(run_id)["run"]
        if run["status"] != "running":
            return run
        time.sleep(0.01)
    raise AssertionError("task did not finish")


def test_codex_uses_fixed_read_only_command_exact_stdin_and_selected_cwd(runner):
    payload = _payload()
    created, is_new = runner.create(payload)
    assert is_new is True
    run = _finished(runner, created["run"]["id"])
    record = json.loads(run["output"])
    assert record == {
        "argv": ["exec", "--sandbox", "read-only", "-"],
        "cwd": runner.capabilities()["workspaces"][0]["path"],
        "stdin": payload["prompt"],
    }
    assert run["status"] == "succeeded"
    assert run["exit_code"] == 0
    assert run["error"] is None
    assert "output" not in runner.capabilities()["runs"][0]


def test_runtime_specific_modes_and_claude_noninteractive_permission_command(runner):
    created, _ = runner.create(_payload(runtime="claude", mode="default", prompt="hello"))
    record = json.loads(_finished(runner, created["run"]["id"])["output"])
    assert record["argv"] == [
        "-p", "--output-format", "text", "--permission-mode", "default",
        "--permission-prompts", "none",
    ]
    capabilities = runner.capabilities()
    assert capabilities["runtimes"][0]["modes"] == [
        {"id": "read", "name": "Review, read-only sandbox"},
        {"id": "edit", "name": "Allow project edits"},
    ]
    assert capabilities["runtimes"][1]["modes"] == [
        {"id": "default", "name": "CLI permissions"}
    ]
    with pytest.raises(TaskRunnerError, match="unsupported mode"):
        runner.create(_payload(runtime="claude", mode="read"))

    edited, _ = runner.create(_payload(mode="edit", prompt="edit"))
    edit_record = json.loads(_finished(runner, edited["run"]["id"])["output"])
    assert edit_record["argv"] == ["exec", "--sandbox", "workspace-write", "-"]


def test_failure_launch_error_and_bounded_output(runner):
    failed, _ = runner.create(_payload(prompt="fail"))
    failure = _finished(runner, failed["run"]["id"])
    assert failure["status"] == "failed"
    assert failure["exit_code"] == 7
    assert failure["error"] == "codex CLI exited with status 7"

    huge, _ = runner.create(_payload(prompt="huge"))
    bounded = _finished(runner, huge["run"]["id"])
    assert len(bounded["output"].encode()) == MAX_OUTPUT_BYTES
    assert bounded["output_truncated"] is True

    Path(runner._executables["codex"]).unlink()
    missing, _ = runner.create(_payload(prompt="launch"))
    launch = _finished(runner, missing["run"]["id"])
    assert launch["status"] == "failed"
    assert launch["exit_code"] is None
    assert launch["error"].startswith("could not start codex CLI:")


def test_worker_start_failure_is_terminal_idempotent_and_releases_admission(runner, monkeypatch):
    original_start = threading.Thread.start
    failed_threads = []
    children = []
    original_popen = subprocess.Popen

    def start(thread):
        if thread.name.startswith("task-run-") and not failed_threads:
            failed_threads.append(thread)
            raise RuntimeError("worker thread unavailable")
        return original_start(thread)

    def popen(*args, **kwargs):
        process = original_popen(*args, **kwargs)
        children.append(process)
        return process

    monkeypatch.setattr(threading.Thread, "start", start)
    monkeypatch.setattr(subprocess, "Popen", popen)
    payload = _payload(prompt="worker cannot start")
    try:
        created, is_new = runner.create(payload)
        failed = created["run"]
        assert is_new is True
        assert failed["status"] == "failed"
        assert failed["finished_at"] is not None
        assert failed["exit_code"] is None
        assert failed["error"] == "could not start task worker: worker thread unavailable"
        assert children == []
        assert runner._threads == set()
        assert failed_threads[0].ident is None

        repeated, is_new = runner.create(dict(payload))
        assert is_new is False
        assert repeated["run"] == failed

        # Both global slots and the failed run's workspace remain available.
        first, _ = runner.create(_payload(prompt="sleep", workspace_id="w1"))
        second, _ = runner.create(_payload(prompt="sleep", workspace_id="w2"))
        runner.cancel(first["run"]["id"])
        runner.cancel(second["run"]["id"])
        assert _finished(runner, first["run"]["id"])["status"] == "cancelled"
        assert _finished(runner, second["run"]["id"])["status"] == "cancelled"
        runner.shutdown(timeout=3)
        assert runner._threads == set()
    finally:
        # A regression must not make fixture teardown join an unstarted thread.
        for thread in failed_threads:
            if thread.ident is None:
                runner._threads.discard(thread)


def test_stdin_start_failure_terminates_and_reaps_child_before_releasing_workspace(runner, monkeypatch):
    original_start = threading.Thread.start
    original_popen = subprocess.Popen
    failed_threads = []
    worker_threads = []
    children = []

    def start(thread):
        if thread.name.startswith("task-stdin-") and not failed_threads:
            failed_threads.append(thread)
            raise RuntimeError("stdin thread unavailable")
        if thread.name.startswith("task-run-"):
            worker_threads.append(thread)
        return original_start(thread)

    def popen(*args, **kwargs):
        process = original_popen(*args, **kwargs)
        children.append(process)
        return process

    monkeypatch.setattr(threading.Thread, "start", start)
    monkeypatch.setattr(subprocess, "Popen", popen)
    payload = _payload(prompt="stdin cannot start")
    try:
        created, _ = runner.create(payload)
        worker_threads[0].join(timeout=5)
        assert not worker_threads[0].is_alive()
        failed = runner.detail(created["run"]["id"])["run"]
        assert failed["status"] == "failed"
        assert failed["finished_at"] is not None
        assert failed["error"] == "could not run codex CLI: stdin thread unavailable"
        assert len(children) == 1
        process = children[0]
        # returncode is set by the runner's reap; this assertion cannot reap it.
        assert process.returncode is not None and process.returncode != 0
        assert failed["exit_code"] == process.returncode
        assert process.stdin.closed and process.stdout.closed
        assert runner._runs[failed["id"]]["process"] is None
        assert runner._threads == set()
        assert failed_threads[0].ident is None

        repeated, is_new = runner.create(dict(payload))
        assert is_new is False
        assert repeated["run"] == {key: value for key, value in failed.items() if key != "output"}
        recovered, _ = runner.create(_payload(prompt="workspace released"))
        assert _finished(runner, recovered["run"]["id"])["status"] == "succeeded"
        runner.shutdown(timeout=3)
        assert runner._threads == set()
    finally:
        # Reap the fixture child even when the lifecycle regression reappears.
        for process in children:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=3)
            for stream in (process.stdin, process.stdout):
                if stream is not None:
                    stream.close()


def test_request_id_is_idempotent_but_cannot_name_different_content(runner):
    payload = _payload(prompt="same")
    first, created = runner.create(payload)
    second, created_again = runner.create(dict(payload))
    assert created is True and created_again is False
    assert second["run"]["id"] == first["run"]["id"]
    with pytest.raises(TaskRunnerError) as conflict:
        runner.create({**payload, "prompt": "different"})
    assert conflict.value.status == 409


def test_uuid_case_is_canonicalized_for_idempotency(runner):
    payload = _payload(prompt="same uuid")
    payload["request_id"] = payload["request_id"].upper()
    first, created = runner.create(payload)
    second, created_again = runner.create({**payload, "request_id": payload["request_id"].lower()})
    assert created is True and created_again is False
    assert first["run"]["id"] == second["run"]["id"]
    assert first["run"]["request_id"] == payload["request_id"].lower()


@pytest.mark.parametrize("change", [
    {"extra": "no"},
    {"prompt": None},
    {"request_id": True},
    {"workspace_id": "w99"},
    {"prompt": ""},
    {"prompt": " \n\t "},
    {"prompt": "x" * 8193},
    {"prompt": "\ud800"},
    {"mode": "edit", "runtime": "claude"},
])
def test_rejects_unknown_fields_wrong_types_and_prompt_boundaries(runner, change):
    with pytest.raises(TaskRunnerError) as invalid:
        runner.create({**_payload(), **change})
    assert invalid.value.status == 400


def test_concurrency_is_global_two_and_exclusive_per_resolved_workspace(runner):
    first, _ = runner.create(_payload(prompt="sleep", workspace_id="w1"))
    with pytest.raises(TaskRunnerError, match="already running"):
        runner.create(_payload(prompt="sleep", workspace_id="w1"))
    second, _ = runner.create(_payload(prompt="sleep", workspace_id="w2"))
    with pytest.raises(TaskRunnerError, match="concurrency limit"):
        runner.create(_payload(prompt="third", workspace_id="w1"))
    runner.cancel(first["run"]["id"])
    runner.cancel(second["run"]["id"])
    assert _finished(runner, first["run"]["id"])["status"] == "cancelled"
    assert _finished(runner, second["run"]["id"])["status"] == "cancelled"


def test_cancel_and_shutdown_terminate_processes_and_preserve_terminal_status(runner):
    created, _ = runner.create(_payload(prompt="sleep"))
    run_id = created["run"]["id"]
    deadline = time.monotonic() + 3
    while runner._runs[run_id]["process"] is None and time.monotonic() < deadline:
        time.sleep(0.01)
    process = runner._runs[run_id]["process"]
    cancelled = runner.cancel(run_id)["run"]
    assert cancelled["status"] in {"running", "cancelled"}
    if cancelled["status"] == "running":
        assert cancelled["finished_at"] is None
    assert _finished(runner, run_id)["status"] == "cancelled"
    assert process.wait(timeout=2) != 0

    other, _ = runner.create(_payload(prompt="sleep", workspace_id="w2"))
    other_id = other["run"]["id"]
    deadline = time.monotonic() + 3
    while runner._runs[other_id]["process"] is None and time.monotonic() < deadline:
        time.sleep(0.01)
    process = runner._runs[other_id]["process"]
    runner.shutdown(timeout=3)
    assert runner.detail(other_id)["run"]["status"] == "interrupted"
    assert process.wait(timeout=2) != 0
    with pytest.raises(TaskRunnerError) as closing:
        runner.create(_payload(prompt="after shutdown"))
    assert closing.value.status == 503


def test_short_flushed_output_is_visible_while_process_is_running(runner):
    created, _ = runner.create(_payload(prompt="sleep"))
    run_id = created["run"]["id"]
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        detail = runner.detail(run_id)["run"]
        if detail["output"] == "started\n":
            assert detail["status"] == "running"
            break
        time.sleep(0.01)
    else:
        raise AssertionError("flushed output was not visible before process exit")
    runner.cancel(run_id)
    assert _finished(runner, run_id)["status"] == "cancelled"


def test_output_and_stdin_are_pumped_concurrently_without_pipe_deadlock(runner):
    executable = Path(runner._executables["codex"])
    executable.write_text(f"""#!{sys.executable}
import sys
sys.stdout.buffer.write(b'x' * 131072)
sys.stdout.buffer.flush()
prompt = sys.stdin.buffer.read()
sys.stdout.buffer.write(b'\\nread=' + str(len(prompt)).encode())
""")
    executable.chmod(0o755)
    prompt = "😀" * 8192
    created, _ = runner.create(_payload(prompt=prompt))
    finished = _finished(runner, created["run"]["id"], timeout=5)
    assert finished["status"] == "succeeded"
    assert finished["output"].endswith("\nread=32768")


@pytest.mark.skipif(os.name != "posix", reason="POSIX process-group regression")
def test_cancel_kills_descendant_after_leader_exits_and_releases_workspace(runner):
    created, _ = runner.create(_payload(prompt="descendant"))
    run_id = created["run"]["id"]
    pid_path = Path(runner.capabilities()["workspaces"][0]["path"]) / "descendant.pid"
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        process = runner._runs[run_id]["process"]
        if pid_path.exists() and process is not None and process.poll() is not None:
            break
        time.sleep(0.01)
    else:
        raise AssertionError("leader did not exit while descendant retained its output pipe")
    descendant_pid = int(pid_path.read_text())
    assert runner.detail(run_id)["run"]["status"] == "running"
    runner.cancel(run_id)
    assert _finished(runner, run_id, timeout=5)["status"] == "cancelled"

    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        try:
            stat = Path(f"/proc/{descendant_pid}/stat").read_text()
            if stat.split()[2] == "Z":
                break
            os.kill(descendant_pid, 0)
        except (FileNotFoundError, ProcessLookupError):
            break
        time.sleep(0.02)
    else:
        raise AssertionError("descendant survived process-group cancellation")

    next_run, _ = runner.create(_payload(prompt="workspace released"))
    assert _finished(runner, next_run["run"]["id"])["status"] == "succeeded"


def test_workspace_validation_rechecks_the_allowlisted_resolved_directory(runner):
    workspace = Path(runner.capabilities()["workspaces"][0]["path"])
    moved = workspace.with_name("moved")
    workspace.rename(moved)
    workspace.symlink_to(moved, target_is_directory=True)
    with pytest.raises(TaskRunnerError, match="no longer matches"):
        runner.create(_payload())


def test_workspace_configuration_requires_absolute_existing_unique_directories(tmp_path):
    project = tmp_path / "project"
    project.mkdir()
    with pytest.raises(ValueError, match="absolute"):
        TaskRunner([Path("relative")])
    with pytest.raises(ValueError, match="unavailable"):
        TaskRunner([tmp_path / "missing"])
    with pytest.raises(ValueError, match="more than once"):
        TaskRunner([project, project / "."])
    with pytest.raises(ValueError, match="at least one"):
        TaskRunner([])


def test_runtime_availability_only_reflects_path_discovery(tmp_path, monkeypatch):
    project = tmp_path / "project"
    project.mkdir()
    monkeypatch.setenv("PATH", "")
    manager = TaskRunner([project])
    try:
        assert [item["available"] for item in manager.capabilities()["runtimes"]] == [False, False]
        with pytest.raises(TaskRunnerError, match="CLI is not available") as unavailable:
            manager.create(_payload())
        assert unavailable.value.status == 409
    finally:
        manager.shutdown()


def test_finished_history_is_bounded_and_newest_first(runner):
    ids = []
    for index in range(42):
        created, _ = runner.create(_payload(prompt=f"task {index}"))
        ids.append(created["run"]["id"])
        _finished(runner, ids[-1])
    runs = runner.capabilities()["runs"]
    assert len(runs) == 40
    assert runs[0]["prompt"] == "task 41"
    assert runs[-1]["prompt"] == "task 2"
    with pytest.raises(TaskRunnerError) as removed:
        runner.detail(ids[0])
    assert removed.value.status == 404

