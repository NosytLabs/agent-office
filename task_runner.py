"""Opt-in local CLI task execution for the standalone Agent Office server.

The runner is deliberately independent from the observer adapters.  It accepts
only workspace ids established at server startup and fixed command templates;
HTTP callers can never provide an executable, arguments, or a working directory.
"""
from __future__ import annotations

import os
import secrets
import shutil
import signal
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable


MAX_PROMPT_CHARS = 8192
MAX_OUTPUT_BYTES = 256 * 1024
MAX_RUNNING = 2
MAX_HISTORY = 40


class TaskRunnerError(Exception):
    """A request error that can be returned to the local HTTP caller."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class TaskRunner:
    """Run fixed, user-selected CLIs in explicitly allowlisted workspaces."""

    def __init__(self, workspaces: Iterable[os.PathLike[str] | str]):
        entries = []
        seen = set()
        for index, raw in enumerate(workspaces, 1):
            path = Path(raw)
            if not path.is_absolute():
                raise ValueError(f"workspace must be an absolute path: {raw}")
            try:
                resolved = path.resolve(strict=True)
            except (OSError, RuntimeError) as exc:
                raise ValueError(f"workspace is unavailable: {raw}") from exc
            if not resolved.is_dir():
                raise ValueError(f"workspace is not a directory: {raw}")
            key = os.path.normcase(str(resolved))
            if key in seen:
                raise ValueError(f"workspace is listed more than once: {resolved}")
            seen.add(key)
            entries.append({
                "id": f"w{index}",
                "name": resolved.name or str(resolved),
                "path": str(resolved),
                "resolved": resolved,
            })
        if not entries:
            raise ValueError("at least one workspace is required")

        self.token = secrets.token_urlsafe(32)
        self._workspaces = entries
        self._workspace_by_id = {entry["id"]: entry for entry in entries}
        self._executables = {
            "codex": shutil.which("codex"),
            "claude": shutil.which("claude"),
        }
        self._lock = threading.RLock()
        self._runs: Dict[str, Dict[str, Any]] = {}
        self._request_ids: Dict[str, str] = {}
        self._order: list[str] = []
        self._active_workspaces: set[str] = set()
        self._threads: set[threading.Thread] = set()
        self._closing = False

    def capabilities(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "enabled": True,
                "token": self.token,
                "workspaces": [
                    {key: entry[key] for key in ("id", "name", "path")}
                    for entry in self._workspaces
                ],
                "runtimes": [
                    {
                        "id": "codex",
                        "name": "Codex",
                        "available": bool(self._executables["codex"]),
                        "modes": [
                            {"id": "read", "name": "Review, read-only sandbox"},
                            {"id": "edit", "name": "Allow project edits"},
                        ],
                    },
                    {
                        "id": "claude",
                        "name": "Claude Code",
                        "available": bool(self._executables["claude"]),
                        "modes": [{"id": "default", "name": "CLI permissions"}],
                        "minimum_version": "2.1.259",
                    },
                ],
                "runs": [self._summary(self._runs[run_id]) for run_id in reversed(self._order)],
                "max_prompt_chars": MAX_PROMPT_CHARS,
                "max_running": MAX_RUNNING,
            }

    def detail(self, run_id: str) -> Dict[str, Any]:
        with self._lock:
            run = self._runs.get(run_id)
            if run is None:
                raise TaskRunnerError(404, "task run not found")
            return {"run": {**self._summary(run), "output": self._output_text(run)}}

    def create(self, payload: Any) -> tuple[Dict[str, Any], bool]:
        clean = self._validate_payload(payload)
        fingerprint = (
            clean["runtime"], clean["workspace_id"], clean["prompt"], clean["mode"]
        )
        with self._lock:
            previous_id = self._request_ids.get(clean["request_id"])
            if previous_id is not None:
                previous = self._runs[previous_id]
                if previous["fingerprint"] != fingerprint:
                    raise TaskRunnerError(409, "request_id was already used for a different task")
                return {"run": self._summary(previous)}, False
            if self._closing:
                raise TaskRunnerError(503, "task runner is shutting down")
            executable = self._executables[clean["runtime"]]
            if not executable:
                raise TaskRunnerError(409, f"{clean['runtime']} CLI is not available")
            workspace = self._workspace_by_id[clean["workspace_id"]]
            try:
                current = Path(workspace["path"]).resolve(strict=True)
            except (OSError, RuntimeError):
                raise TaskRunnerError(409, "workspace is no longer available")
            if not current.is_dir() or current != workspace["resolved"]:
                raise TaskRunnerError(409, "workspace no longer matches its allowlisted path")
            running = sum(run["holds_slot"] for run in self._runs.values())
            if running >= MAX_RUNNING:
                raise TaskRunnerError(409, "the task runner is at its concurrency limit")
            workspace_key = os.path.normcase(str(current))
            if workspace_key in self._active_workspaces:
                raise TaskRunnerError(409, "another task is already running in this workspace")

            run_id = uuid.uuid4().hex
            run = {
                "id": run_id,
                "request_id": clean["request_id"],
                "runtime": clean["runtime"],
                "workspace_id": clean["workspace_id"],
                "workspace_name": workspace["name"],
                "prompt": clean["prompt"],
                "mode": clean["mode"],
                "status": "running",
                "created_at": time.time(),
                "finished_at": None,
                "exit_code": None,
                "output": bytearray(),
                "output_truncated": False,
                "error": None,
                "fingerprint": fingerprint,
                "workspace_path": str(current),
                "workspace_key": workspace_key,
                "executable": executable,
                "process": None,
                "cancel_requested": False,
                "interrupt_requested": False,
                "holds_slot": True,
            }
            self._runs[run_id] = run
            self._request_ids[clean["request_id"]] = run_id
            self._order.append(run_id)
            self._active_workspaces.add(workspace_key)
            thread = threading.Thread(
                target=self._execute, args=(run_id,), name=f"task-run-{run_id[:8]}", daemon=True
            )
            self._threads.add(thread)
            thread.start()
            return {"run": self._summary(run)}, True

    def cancel(self, run_id: str) -> Dict[str, Any]:
        process = None
        with self._lock:
            run = self._runs.get(run_id)
            if run is None:
                raise TaskRunnerError(404, "task run not found")
            if run["holds_slot"]:
                run["cancel_requested"] = True
                process = run["process"]
        if process is not None:
            self._terminate_process(process)
        with self._lock:
            return {"run": self._summary(run)}

    def shutdown(self, timeout: float = 5.0) -> None:
        processes = []
        with self._lock:
            self._closing = True
            for run in self._runs.values():
                if run["holds_slot"]:
                    run["interrupt_requested"] = True
                    if run["process"] is not None:
                        processes.append(run["process"])
            threads = list(self._threads)
        for process in processes:
            self._terminate_process(process)
        deadline = time.monotonic() + max(0, timeout)
        for thread in threads:
            thread.join(max(0, deadline - time.monotonic()))

    def _validate_payload(self, payload: Any) -> Dict[str, str]:
        expected = {"request_id", "runtime", "workspace_id", "prompt", "mode"}
        if not isinstance(payload, dict) or set(payload) != expected:
            raise TaskRunnerError(400, "expected exactly request_id, runtime, workspace_id, prompt, and mode")
        if not all(isinstance(payload[key], str) for key in expected):
            raise TaskRunnerError(400, "task fields must be strings")
        try:
            parsed = uuid.UUID(payload["request_id"])
        except (ValueError, AttributeError):
            raise TaskRunnerError(400, "request_id must be a UUID")
        if str(parsed) != payload["request_id"].lower():
            raise TaskRunnerError(400, "request_id must be a canonical UUID")
        runtime = payload["runtime"]
        if runtime not in self._executables:
            raise TaskRunnerError(400, "unsupported runtime")
        workspace_id = payload["workspace_id"]
        if workspace_id not in self._workspace_by_id:
            raise TaskRunnerError(400, "unknown workspace_id")
        prompt = payload["prompt"]
        if not prompt.strip() or len(prompt) > MAX_PROMPT_CHARS:
            raise TaskRunnerError(400, f"prompt must contain 1–{MAX_PROMPT_CHARS} characters")
        if any(0xD800 <= ord(char) <= 0xDFFF for char in prompt):
            raise TaskRunnerError(400, "prompt contains invalid Unicode")
        mode = payload["mode"]
        modes = {"codex": {"read", "edit"}, "claude": {"default"}}[runtime]
        if mode not in modes:
            raise TaskRunnerError(400, "unsupported mode for runtime")
        clean = {key: payload[key] for key in expected}
        clean["request_id"] = str(parsed)
        return clean

    def _command(self, run: Dict[str, Any]) -> list[str]:
        if run["runtime"] == "codex":
            sandbox = "read-only" if run["mode"] == "read" else "workspace-write"
            return [run["executable"], "exec", "--sandbox", sandbox, "-"]
        return [
            run["executable"], "-p", "--output-format", "text",
            "--permission-mode", "default", "--permission-prompts", "none",
        ]

    def _execute(self, run_id: str) -> None:
        with self._lock:
            run = self._runs[run_id]
            command = self._command(run)
            cwd = run["workspace_path"]
        popen_options: Dict[str, Any] = {}
        if os.name == "posix":
            popen_options["start_new_session"] = True
        elif os.name == "nt":
            popen_options["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
        process = None
        stdin_thread = None
        exit_code = None
        launch_error = None
        try:
            process = subprocess.Popen(
                command,
                cwd=cwd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                shell=False,
                **popen_options,
            )
            with self._lock:
                run = self._runs[run_id]
                run["process"] = process
                stop_now = run["cancel_requested"] or run["interrupt_requested"]
            if stop_now:
                self._terminate_process(process)
            if process.stdin is not None:
                prompt_bytes = run["prompt"].encode("utf-8")

                def write_stdin():
                    try:
                        process.stdin.write(prompt_bytes)
                        process.stdin.close()
                    except (BrokenPipeError, OSError, ValueError):
                        pass

                stdin_thread = threading.Thread(
                    target=write_stdin, name=f"task-stdin-{run_id[:8]}", daemon=True
                )
                stdin_thread.start()
            if process.stdout is not None:
                while True:
                    chunk = os.read(process.stdout.fileno(), 65536)
                    if not chunk:
                        break
                    with self._lock:
                        stored = self._runs[run_id]["output"]
                        remaining = MAX_OUTPUT_BYTES - len(stored)
                        if remaining > 0:
                            stored.extend(chunk[:remaining])
                        if len(chunk) > remaining:
                            self._runs[run_id]["output_truncated"] = True
            exit_code = process.wait()
        except (OSError, ValueError, subprocess.SubprocessError) as exc:
            launch_error = f"could not start {run['runtime']} CLI: {exc}"
        finally:
            if process is not None:
                if stdin_thread is not None:
                    stdin_thread.join(timeout=1)
                for stream in (process.stdin, process.stdout):
                    try:
                        if stream is not None:
                            stream.close()
                    except OSError:
                        pass
            with self._lock:
                run = self._runs[run_id]
                run["process"] = None
                run["exit_code"] = exit_code
                if run["interrupt_requested"]:
                    self._mark_stopped(run, "interrupted")
                elif run["cancel_requested"]:
                    self._mark_stopped(run, "cancelled")
                elif launch_error is not None:
                    run["error"] = launch_error
                    self._mark_stopped(run, "failed")
                elif exit_code == 0:
                    self._mark_stopped(run, "succeeded")
                else:
                    run["error"] = f"{run['runtime']} CLI exited with status {exit_code}"
                    self._mark_stopped(run, "failed")
                if run["holds_slot"]:
                    # Defensive: _mark_stopped normally releases this.
                    self._release_slot(run)
                self._threads.discard(threading.current_thread())
                self._prune_locked()

    def _mark_stopped(self, run: Dict[str, Any], status: str) -> None:
        run["status"] = status
        if run["finished_at"] is None:
            run["finished_at"] = time.time()
        if run["holds_slot"]:
            self._release_slot(run)

    def _release_slot(self, run: Dict[str, Any]) -> None:
        run["holds_slot"] = False
        self._active_workspaces.discard(run["workspace_key"])

    def _prune_locked(self) -> None:
        while len(self._order) > MAX_HISTORY:
            removable = next((run_id for run_id in self._order if not self._runs[run_id]["holds_slot"]), None)
            if removable is None:
                break
            self._order.remove(removable)
            run = self._runs.pop(removable)
            self._request_ids.pop(run["request_id"], None)

    @staticmethod
    def _terminate_process(process: subprocess.Popen[bytes]) -> None:
        if os.name == "posix":
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                return
            except OSError:
                pass
            deadline = time.monotonic() + 1.5
            while time.monotonic() < deadline:
                try:
                    os.killpg(process.pid, 0)
                except ProcessLookupError:
                    return
                except OSError:
                    break
                time.sleep(0.02)
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except OSError:
                pass
            try:
                process.wait(timeout=1.5)
            except (OSError, subprocess.TimeoutExpired):
                pass
            return
        try:
            os.kill(process.pid, signal.CTRL_BREAK_EVENT)
        except OSError:
            pass
        try:
            process.wait(timeout=1.5)
            return
        except (OSError, subprocess.TimeoutExpired):
            pass
        try:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=1.5)
            if process.poll() is None:
                process.kill()
        except (OSError, subprocess.TimeoutExpired):
            pass

    @staticmethod
    def _summary(run: Dict[str, Any]) -> Dict[str, Any]:
        keys = (
            "id", "request_id", "runtime", "workspace_id", "workspace_name", "prompt",
            "mode", "status", "created_at", "finished_at", "exit_code",
            "output_truncated", "error",
        )
        return {key: run[key] for key in keys}

    @staticmethod
    def _output_text(run: Dict[str, Any]) -> str:
        return bytes(run["output"]).decode("utf-8", errors="replace")

