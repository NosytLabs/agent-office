/* Explicit, opt-in local CLI task runs. No observer activity is synthesized. */
(function () {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const root = byId("task-runs");
  if (!root) return;

  const capabilityText = byId("task-run-capability");
  const enableHelp = byId("task-run-enable");
  const form = byId("task-run-form");
  const workspace = byId("task-run-workspace");
  const runtime = byId("task-run-runtime");
  const mode = byId("task-run-mode");
  const prompt = byId("task-run-prompt");
  const count = byId("task-run-count");
  const submit = byId("task-run-submit");
  const formStatus = byId("task-run-form-status");
  const list = byId("task-run-list");
  const detail = byId("task-run-detail");
  const detailTitle = byId("task-run-detail-title");
  const detailMeta = byId("task-run-detail-meta");
  const output = byId("task-run-output");
  const cancel = byId("task-run-cancel");
  const copy = byId("task-run-copy");
  const reuse = byId("task-run-reuse");
  const download = byId("task-run-download");
  const refreshClis = byId("task-run-refresh");
  const search = byId("task-run-search");
  const filter = byId("task-run-filter");
  const clearFilters = byId("task-run-clear");
  const results = byId("task-run-results");
  const detailStatus = byId("task-run-detail-status");
  const draft = byId("task-draft-text");
  const draftRun = byId("task-draft-run");
  const draftTemplate = byId("task-draft-template");
  const preview = document.body.dataset.agentOfficePreview === "1";
  const remember = byId("task-run-remember");
  const clearDraft = byId("task-run-clear-draft");
  const newDraft = byId("task-run-new-draft");
  const draftStatus = byId("task-run-draft-status");
  const outputSize = byId("task-run-output-size");
  const wrap = byId("task-run-wrap");
  const readingStatus = byId("task-run-reading-status");
  const draftKey = "agent-office:local-run-draft:v1";
  const outputKey = "agent-office:run-output:v1";
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  let active = false;
  let connected = false;
  let capability = null;
  let runs = [];
  let selectedId = null;
  let selectedRun = null;
  let selectedOutput = "";
  let selectedOutputReady = false;
  let pollTimer = null;
  let refreshPromise = null;
  let detailPromise = null;
  let detailRequestId = null;
  let refreshSequence = 0;
  let detailSequence = 0;
  let submitting = false;
  let cancelling = false;
  let pendingRequest = null;
  let optionSignature = "";
  let formFeedback = "";
  let selectionVersion = 0;
  let copyVersion = 0;
  let discovering = false;
  let savedDraft = null;
  let draftRestored = false;
  let formEdited = false;
  let reviewRequired = false;
  const runNodes = new Map();

  function formPayload() {
    return {
      runtime: runtime.value,
      workspace_id: workspace.value,
      prompt: prompt.value,
      mode: mode.value,
    };
  }

  function persistDraft() {
    if (!remember || preview) return;
    try {
      if (!remember.checked) {
        sessionStorage.removeItem(draftKey);
        savedDraft = null;
        setText(
          draftStatus,
          "Draft retention is off. Your open prompt is unchanged.",
        );
        return;
      }
      const project = capability?.workspaces?.find(
        (item) => item.id === workspace.value,
      );
      if (!project?.path || !capability?.enabled) return;
      if (Array.from(prompt.value).length > 8192) {
        setText(
          draftStatus,
          "This prompt is too long to retain. The previously saved draft is unchanged.",
        );
        return;
      }
      const payload = formPayload();
      savedDraft = {
        version: 1,
        prompt: prompt.value,
        workspace_path: project.path,
        workspace_id: workspace.value,
        runtime: runtime.value,
        mode: mode.value,
        instance_id: capability.instance_id || null,
        pending_id:
          pendingRequest?.signature === payloadSignature(payload)
            ? pendingRequest.id
            : null,
        review_required: reviewRequired,
      };
      sessionStorage.setItem(draftKey, JSON.stringify(savedDraft));
      setText(
        draftStatus,
        "Draft retained in this tab until cleared. Reloading never starts a run.",
      );
    } catch {
      setText(
        draftStatus,
        "Browser storage is unavailable. This draft is usable but changes were not retained.",
      );
    }
  }

  function restoreDraft() {
    if (draftRestored || !capability?.enabled) return;
    draftRestored = true;
    if (!savedDraft) return;
    const retained = savedDraft;
    savedDraft = null;
    if (formEdited) {
      persistDraft();
      return;
    }
    prompt.value = retained.prompt;
    workspace.value =
      capability.workspaces.find(
        (item) => item.path === retained.workspace_path,
      )?.id || "";
    runtime.value = retained.runtime;
    fillModes();
    mode.value = retained.mode;
    reviewRequired =
      retained.review_required ||
      (!!retained.pending_id &&
        (!uuid.test(capability.instance_id || "") ||
          capability.instance_id !== retained.instance_id ||
          workspace.value !== retained.workspace_id));
    if (retained.pending_id && !reviewRequired)
      pendingRequest = {
        id: retained.pending_id,
        signature: payloadSignature(formPayload()),
        instance_id: retained.instance_id,
      };
    newDraft.hidden = !reviewRequired;
    formFeedback = reviewRequired
      ? "The previous submission may have run, and this server cannot safely retry it. Check the CLI's activity, then review this as a new run or clear the draft."
      : pendingRequest
        ? "Draft restored with its previous request ID. Retrying the unchanged prompt will reuse that ID."
        : "Draft restored. Review the project, CLI, mode, and exact prompt before running.";
    setText(draftStatus, "Draft restored from this tab. No run was started.");
    // Retire the initial restoration record. Later polls must never replace edits.
    formEdited = true;
  }

  if (remember) {
    remember.disabled = preview;
    try {
      const raw = !preview && sessionStorage.getItem(draftKey);
      if (raw) {
        if (raw.length > 70000) throw new Error("Oversized draft");
        const value = JSON.parse(raw);
        if (
          value?.version !== 1 ||
          typeof value.prompt !== "string" ||
          Array.from(value.prompt).length > 8192 ||
          typeof value.workspace_path !== "string" ||
          !value.workspace_path ||
          value.workspace_path.length > 4096 ||
          typeof value.workspace_id !== "string" ||
          value.workspace_id.length > 256 ||
          !["codex", "claude", "opencode"].includes(value.runtime) ||
          !["read", "edit", "default"].includes(value.mode) ||
          (value.pending_id != null &&
            (!uuid.test(value.pending_id) ||
              !uuid.test(value.instance_id || ""))) ||
          typeof value.review_required !== "boolean"
        )
          throw new Error("Invalid draft");
        savedDraft = value;
        remember.checked = true;
      }
    } catch {
      setText(
        draftStatus,
        "The saved draft could not be read. Your open prompt is unchanged; enable retention to replace it.",
      );
    }
    remember.addEventListener("change", persistDraft);
  }

  function applyReadingPreferences(save = false) {
    if (!outputSize || !wrap) return;
    output.dataset.size = outputSize.value;
    output.dataset.wrap = String(wrap.checked);
    if (!save) return;
    try {
      localStorage.setItem(
        outputKey,
        JSON.stringify({ size: outputSize.value, wrap: wrap.checked }),
      );
      if (readingStatus) readingStatus.hidden = true;
    } catch {
      setText(
        readingStatus,
        "Display preferences apply to this visit; browser storage is unavailable.",
      );
      if (readingStatus) readingStatus.hidden = false;
    }
  }
  if (outputSize && wrap) {
    try {
      const raw = localStorage.getItem(outputKey);
      const value = raw?.length <= 1024 ? JSON.parse(raw) : null;
      if (["small", "medium", "large"].includes(value?.size))
        outputSize.value = value.size;
      if (typeof value?.wrap === "boolean") wrap.checked = value.wrap;
    } catch {
      /* Reading controls remain available without storage. */
    }
    applyReadingPreferences();
    outputSize.addEventListener("change", () => applyReadingPreferences(true));
    wrap.addEventListener("change", () => applyReadingPreferences(true));
  }

  const publicStatus = {
    enabled: false,
    connected: false,
    running: 0,
    failed: 0,
  };

  function emitStatus() {
    const next = {
      enabled: !!capability?.enabled,
      connected,
      running: runs.filter((run) => run.status === "running").length,
      failed: runs.filter((run) => run.status === "failed").length,
    };
    Object.assign(publicStatus, next);
    if (!preview)
      setText(
        byId("footer-mode"),
        next.enabled
          ? "Local · Observer + task runner"
          : "Local · Observer only",
      );
    window.dispatchEvent(
      new CustomEvent("agent-office:task-runs", {
        detail: { ...next, runs: runs.map((run) => ({ ...run })) },
      }),
    );
  }

  function setText(element, value) {
    const text = String(value ?? "");
    if (element && element.textContent !== text) element.textContent = text;
  }

  function stripTerminalControls(value) {
    return String(value ?? "")
      .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "");
  }

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(path, {
        cache: "no-store",
        ...options,
        signal: controller.signal,
      });
      let body = null;
      try {
        body = await response.json();
      } catch {
        // The status code remains useful when an intermediary returns plain text.
      }
      if (!response.ok) {
        const error = new Error(body?.error || `HTTP ${response.status}`);
        error.status = response.status;
        error.body = body;
        throw error;
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  function selectedRuntime() {
    return capability?.runtimes?.find((item) => item.id === runtime.value);
  }

  function validityMessage() {
    if (preview)
      return "Local runs are available only from the local Agent Office browser, not this preview.";
    if (!connected)
      return "Local-run controls are disconnected. Open Agent Office in your local browser and keep python3 run.py running.";
    if (!capability?.enabled)
      return "Local task running is disabled. Restart Agent Office with the command shown above.";
    if (!capability?.workspaces?.length)
      return "No project workspace is configured for local runs.";
    if (!capability.workspaces.some((item) => item.id === workspace.value))
      return "Choose a configured project workspace.";
    if (reviewRequired)
      return "Review the previous uncertain submission as a new run, or clear this draft, before starting.";
    const selected = selectedRuntime();
    if (!selected) return "Choose an installed CLI.";
    if (!selected.available)
      return `${selected.name} was not found on the server PATH${selected.minimum_version ? ` (minimum ${selected.minimum_version})` : ""}.`;
    if (!mode.value) return "Choose how this CLI may work in the project.";
    if (
      runs.some(
        (run) =>
          run.status === "running" && run.workspace_id === workspace.value,
      )
    )
      return "This project has an active run. Wait for it to finish or cancel it.";
    if (!prompt.value.trim())
      return "Enter an exact prompt before running the task.";
    const max = Number(capability.max_prompt_chars) || 8192;
    if (Array.from(prompt.value).length > max)
      return `Prompt exceeds the ${max.toLocaleString()} character limit.`;
    if (
      runs.filter((run) => run.status === "running").length >=
      (Number(capability.max_running) || 2)
    )
      return "The local-run concurrency limit is in use. Wait for or cancel an active run.";
    return "";
  }

  function syncForm() {
    const max = Number(capability?.max_prompt_chars) || 8192;
    prompt.removeAttribute("maxlength");
    setText(
      count,
      `${Array.from(prompt.value).length.toLocaleString()} / ${max.toLocaleString()} characters`,
    );
    const issue = validityMessage();
    submit.disabled = submitting || discovering || !!issue;
    if (!submitting)
      setText(
        formStatus,
        formFeedback && issue
          ? `${formFeedback}\n${issue}`
          : formFeedback || issue,
      );
    if (draftRun) draftRun.disabled = !draft?.value.trim();
  }

  function fillModes() {
    const selected = selectedRuntime();
    const previous = mode.value;
    mode.replaceChildren();
    for (const item of selected?.modes || []) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name;
      mode.append(option);
    }
    if ([...mode.options].some((option) => option.value === previous))
      mode.value = previous;
    mode.disabled = !selected?.available || !mode.options.length;
    syncForm();
  }

  function fillOptions() {
    const signature = JSON.stringify([
      capability?.workspaces || [],
      capability?.runtimes || [],
    ]);
    if (signature === optionSignature) return;
    optionSignature = signature;
    const previousWorkspace = workspace.value;
    const previousRuntime = runtime.value;
    workspace.replaceChildren();
    for (const item of capability?.workspaces || []) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.name;
      option.title = item.path || item.name;
      workspace.append(option);
    }
    if (
      [...workspace.options].some(
        (option) => option.value === previousWorkspace,
      )
    )
      workspace.value = previousWorkspace;
    runtime.replaceChildren();
    for (const item of capability?.runtimes || []) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = `${item.name} — ${item.available ? "Available" : "Not found on PATH"}${item.minimum_version ? ` · minimum ${item.minimum_version}` : ""}`;
      runtime.append(option);
    }
    if ([...runtime.options].some((option) => option.value === previousRuntime))
      runtime.value = previousRuntime;
    else {
      const firstAvailable = capability?.runtimes?.find(
        (item) => item.available,
      );
      if (firstAvailable) runtime.value = firstAvailable.id;
    }
    workspace.disabled = !capability?.enabled || !workspace.options.length;
    runtime.disabled = !capability?.enabled || !runtime.options.length;
    fillModes();
  }

  const statusLabel = (status) =>
    ({
      running: "Running",
      succeeded: "Finished",
      failed: "Failed",
      cancelled: "Cancelled",
      interrupted: "Interrupted",
    })[status] || "Unknown";

  function timeLabel(run) {
    const created = Number(run.created_at);
    if (!Number.isFinite(created)) return "Start time unavailable";
    const started = new Date(created * 1000).toLocaleString();
    if (!run.finished_at) return `Started ${started}`;
    const elapsed = Math.max(0, Number(run.finished_at) - created);
    return `Started ${started} · ${Math.round(elapsed)}s`;
  }

  function updateRunNode(node, run) {
    node.dataset.runId = String(run.id);
    node.setAttribute("aria-pressed", String(run.id === selectedId));
    setText(
      node.querySelector("strong"),
      run.workspace_name || run.workspace_id || "Project",
    );
    const state = node.querySelector("span");
    state.className = `task-run-status-${run.status}`;
    setText(state, statusLabel(run.status));
    setText(
      node.querySelector("small"),
      `${run.runtime || "CLI"} · ${run.mode || "default"} · ${timeLabel(run)}`,
    );
    node.title = run.prompt || "Local CLI run";
  }

  function renderRuns() {
    for (const control of [search, filter, clearFilters])
      if (control) control.disabled = !runs.length;
    const filters = search?.closest(".task-run-filters");
    if (filters) filters.hidden = !runs.length;
    const wanted = new Set();
    const nodes = [];
    const query = (search?.value || "").trim().toLowerCase();
    const status = filter?.value || "all";
    let matches = 0;
    list.querySelector(".task-run-empty")?.remove();
    for (const run of runs) {
      const id = String(run.id);
      wanted.add(id);
      let node = runNodes.get(id);
      if (!node) {
        node = document.createElement("button");
        node.type = "button";
        node.className = "btn task-run-card";
        node.append(
          document.createElement("strong"),
          document.createElement("span"),
          document.createElement("small"),
        );
        node.onclick = () => selectRun(id);
        runNodes.set(id, node);
      }
      updateRunNode(node, run);
      node.hidden =
        (status !== "all" && run.status !== status) ||
        ![run.workspace_name, run.workspace_id, run.runtime, run.prompt].some(
          (value) =>
            String(value || "")
              .toLowerCase()
              .includes(query),
        );
      if (!node.hidden) matches++;
      else if (document.activeElement === node)
        search?.focus({ preventScroll: true });
      nodes.push(node);
    }
    for (const [id, node] of runNodes) {
      if (!wanted.has(id)) {
        node.remove();
        runNodes.delete(id);
      }
    }
    let cursor = list.firstChild;
    for (const node of nodes) {
      if (node === cursor) cursor = cursor.nextSibling;
      else list.insertBefore(node, cursor);
    }
    setText(results, `${matches} of ${runs.length} runs`);
    if (!matches) {
      let empty = list.querySelector(".task-run-empty");
      if (!empty) {
        empty = document.createElement("p");
        empty.className = "h task-run-empty";
        empty.textContent = runs.length
          ? "No runs match these filters. Clear filters to see all runs."
          : "No local runs in this server session.";
        list.append(empty);
      }
    }
    if (selectedId && !runs.some((run) => String(run.id) === selectedId)) {
      selectionVersion++;
      selectedId = null;
      selectedRun = null;
      selectedOutput = "";
      selectedOutputReady = false;
      detailSequence++;
      detailPromise = null;
      detailRequestId = null;
      detail.hidden = true;
    }
    emitStatus();
    syncForm();
  }

  function renderDetail(
    run,
    nextOutput = selectedOutput,
    outputReady = selectedOutputReady,
  ) {
    if (!run || String(run.id) !== selectedId) return;
    selectedRun = run;
    selectedOutput = stripTerminalControls(nextOutput);
    selectedOutputReady = outputReady;
    detail.hidden = false;
    setText(
      detailTitle,
      `${run.workspace_name || run.workspace_id || "Project"} · ${run.runtime || "CLI"}`,
    );
    setText(
      detailMeta,
      `${statusLabel(run.status)} · ${timeLabel(run)}${run.exit_code === null || run.exit_code === undefined ? "" : ` · exit ${run.exit_code}`}${run.output_truncated ? " · output truncated by server" : ""}${run.error ? ` · ${run.error}` : ""}`,
    );
    setText(output, selectedOutput || "No terminal output yet.");
    cancel.hidden = run.status !== "running";
    cancel.disabled = cancelling;
    copy.disabled = !selectedOutput;
    reuse.disabled = typeof run.prompt !== "string";
    if (download) download.disabled = !selectedOutputReady;
    for (const [id, node] of runNodes)
      node.setAttribute("aria-pressed", String(id === selectedId));
  }

  async function loadDetail(id) {
    if (!active || !id || preview || !connected || !capability?.enabled) return;
    if (detailPromise && detailRequestId === String(id)) return detailPromise;
    const sequence = ++detailSequence;
    detailRequestId = String(id);
    detailPromise = request(`task-runs/${encodeURIComponent(id)}`)
      .then((body) => {
        if (sequence !== detailSequence || selectedId !== String(id)) return;
        renderDetail(body?.run, body?.run?.output || "", true);
      })
      .catch((error) => {
        if (sequence === detailSequence)
          setText(detailStatus, `Could not refresh output: ${error.message}`);
      })
      .finally(() => {
        if (sequence === detailSequence) {
          detailPromise = null;
          detailRequestId = null;
        }
      });
    return detailPromise;
  }

  function selectRun(id) {
    selectionVersion++;
    selectedId = String(id);
    const summary = runs.find((run) => String(run.id) === selectedId);
    selectedOutputReady =
      selectedRun?.id === summary?.id && selectedOutputReady;
    selectedOutput = selectedRun?.id === summary?.id ? selectedOutput : "";
    renderDetail(summary, selectedOutput);
    setText(detailStatus, "");
    loadDetail(selectedId);
  }

  function syncCapability() {
    if (
      pendingRequest?.instance_id &&
      capability?.instance_id !== pendingRequest.instance_id
    ) {
      reviewRequired = true;
      if (newDraft) newDraft.hidden = false;
      formFeedback =
        "The local server changed after an uncertain submission. Check the CLI's activity before reviewing this as a new run.";
      persistDraft();
    }
    if (refreshClis) {
      refreshClis.disabled = preview || !connected || !capability?.enabled;
      refreshClis.setAttribute("aria-disabled", String(discovering));
      setText(refreshClis, discovering ? "Checking CLIs…" : "Refresh CLIs");
    }
    enableHelp.hidden = preview || !!capability?.enabled;
    if (preview)
      setText(
        capabilityText,
        "Local runs are available only from the local Agent Office browser. This preview cannot start or query CLIs.",
      );
    else if (!connected)
      setText(
        capabilityText,
        "Local-run controls are unavailable here. Open the URL printed by python3 run.py in a local browser; embedded VS Code hosts are not supported unless they can reach this origin.",
      );
    else if (!capability?.enabled)
      setText(
        capabilityText,
        "Local task running is disabled by default. Enable it only with explicitly configured project workspaces.",
      );
    else
      setText(
        capabilityText,
        `${capability.workspaces?.length || 0} configured project${capability.workspaces?.length === 1 ? "" : "s"} · ${capability.runtimes?.filter((item) => item.available).length || 0} CLI${capability.runtimes?.filter((item) => item.available).length === 1 ? "" : "s"} found on PATH`,
      );
    fillOptions();
    restoreDraft();
    syncForm();
    emitStatus();
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    if (preview || document.hidden) return;
    if (connected && capability && !capability.enabled) return;
    // Keep running work responsive without polling an idle, closed panel as often.
    const delay =
      active || runs.some((run) => run.status === "running") ? 1800 : 15000;
    pollTimer = setTimeout(() => refresh().finally(schedulePoll), delay);
  }

  async function refresh() {
    if (discovering) return;
    if (preview) {
      connected = false;
      syncCapability();
      return;
    }
    if (refreshPromise) return refreshPromise;
    const sequence = ++refreshSequence;
    refreshPromise = request("task-runs")
      .then((body) => {
        if (sequence !== refreshSequence) return;
        const valid =
          body &&
          typeof body === "object" &&
          typeof body.enabled === "boolean" &&
          (!body.enabled ||
            (Array.isArray(body.workspaces) &&
              Array.isArray(body.runtimes) &&
              Array.isArray(body.runs)));
        if (!valid)
          throw new Error("Server returned an invalid capability response");
        capability = body;
        connected = true;
        runs = Array.isArray(capability?.runs) ? capability.runs : [];
        syncCapability();
        renderRuns();
        if (selectedId) loadDetail(selectedId);
      })
      .catch((error) => {
        if (sequence !== refreshSequence) return;
        connected = false;
        syncCapability();
        setText(
          formStatus,
          `Local-run connection failed: ${error.message}. Your draft is unchanged.`,
        );
      })
      .finally(() => {
        refreshPromise = null;
      });
    return refreshPromise;
  }

  async function rediscover() {
    if (
      discovering ||
      preview ||
      !connected ||
      !capability?.enabled ||
      submitting
    )
      return;
    discovering = true;
    const sequence = ++refreshSequence;
    syncCapability();
    try {
      const body = await request("task-runs/refresh", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Office-Token": capability.token,
        },
        body: "{}",
      });
      if (sequence !== refreshSequence) return;
      if (
        !body?.enabled ||
        !Array.isArray(body.runtimes) ||
        !Array.isArray(body.workspaces) ||
        !Array.isArray(body.runs)
      )
        throw new Error("Server returned an invalid capability response");
      capability = body;
      runs = body.runs;
      renderRuns();
      formFeedback = "CLI availability checked. Your prompt is unchanged.";
    } catch (error) {
      if (sequence === refreshSequence)
        formFeedback = `Could not check CLIs: ${error.message}. Your prompt is unchanged.`;
    } finally {
      discovering = false;
      syncCapability();
    }
  }

  function setActive(value) {
    const next = !!value;
    byId("sheet-tasks")?.classList.toggle("task-runs-active", next);
    if (active === next) {
      root.hidden = !next;
      return;
    }
    active = next;
    if (!active) {
      selectionVersion++;
      detailSequence++;
      detailPromise = null;
      detailRequestId = null;
    }
    root.hidden = !active;
    clearTimeout(pollTimer);
    refresh().finally(schedulePoll);
  }

  function open() {
    const tasksButton = document.querySelector('[data-sheet="sheet-tasks"]');
    const sheet = byId("sheet-tasks");
    if (tasksButton && sheet?.hidden) tasksButton.click();
    const localTab = document.querySelector('[data-task-view="local-runs"]');
    if (localTab?.getAttribute("aria-pressed") !== "true") localTab?.click();
    setActive(true);
  }

  function close() {
    setActive(false);
  }

  function prefill(value) {
    open();
    prompt.value = String(value ?? "");
    formEdited = true;
    pendingRequest = null;
    reviewRequired = false;
    if (newDraft) newDraft.hidden = true;
    formFeedback =
      "Draft copied here. Review the project, CLI, mode, and prompt before running.";
    syncForm();
    persistDraft();
    prompt.focus({ preventScroll: true });
  }

  function payloadSignature(payload) {
    return JSON.stringify([
      payload.runtime,
      payload.workspace_id,
      payload.prompt,
      payload.mode,
    ]);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const issue = validityMessage();
    if (issue || submitting || discovering) {
      formFeedback =
        issue ||
        (discovering
          ? "Checking CLI availability. Try Run task when it finishes."
          : "A run request is already being submitted.");
      setText(formStatus, formFeedback);
      return;
    }
    const payload = formPayload();
    const signature = payloadSignature(payload);
    if (!pendingRequest || pendingRequest.signature !== signature)
      pendingRequest = {
        signature,
        id: crypto.randomUUID(),
        instance_id: capability.instance_id,
      };
    payload.request_id = pendingRequest.id;
    persistDraft();
    submitting = true;
    formFeedback = "Starting local CLI run…";
    setText(formStatus, formFeedback);
    syncForm();
    try {
      refreshSequence++;
      const body = await request("task-runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Office-Token": capability.token,
        },
        body: JSON.stringify(payload),
      });
      const run = body?.run;
      if (!run?.id) throw new Error("Server returned an invalid run");
      refreshSequence++;
      pendingRequest = null;
      persistDraft();
      const index = runs.findIndex(
        (item) => String(item.id) === String(run.id),
      );
      if (index >= 0) runs[index] = run;
      else runs = [run, ...runs];
      if (search) search.value = "";
      if (filter) filter.value = "all";
      renderRuns();
      selectRun(run.id);
      formFeedback =
        run.status === "running"
          ? "Run started. This is a new CLI process, separate from existing observed sessions."
          : run.status === "failed"
            ? `${run.exit_code == null ? "Run could not start" : "Run failed"}. Review the run details before retrying.`
            : `Run ${statusLabel(run.status).toLowerCase()}. Review its output and status before starting another task.`;
      setText(formStatus, formFeedback);
    } catch (error) {
      const uncertain = !error.status || error.name === "AbortError";
      formFeedback = `${uncertain ? "The result is uncertain; retrying this unchanged prompt will reuse its request ID." : "Run was not started."} ${error.message} Your prompt is unchanged.`;
      setText(formStatus, formFeedback);
    } finally {
      submitting = false;
      syncForm();
    }
  });

  async function cancelSelected() {
    if (!selectedRun || selectedRun.status !== "running" || cancelling) return;
    const id = selectedId,
      version = selectionVersion;
    const current = () =>
      active && selectedId === id && selectionVersion === version;
    cancelling = true;
    detailSequence++;
    detailPromise = null;
    detailRequestId = null;
    refreshSequence++;
    renderDetail(selectedRun);
    setText(detailStatus, "Requesting cancellation…");
    try {
      const body = await request(`task-runs/${encodeURIComponent(id)}/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Office-Token": capability.token,
        },
        body: "{}",
      });
      const run = body?.run;
      if (!run || String(run.id) !== id)
        throw new Error("Server returned an invalid cancellation response");
      if (run) {
        refreshSequence++;
        const index = runs.findIndex(
          (item) => String(item.id) === String(run.id),
        );
        if (index >= 0) runs[index] = run;
        renderRuns();
        if (current()) {
          // A detail request begun before cancellation must not revive old status.
          detailSequence++;
          detailPromise = null;
          detailRequestId = null;
          renderDetail(run);
        }
      }
      if (current()) setText(detailStatus, "Cancellation requested.");
    } catch (error) {
      if (current())
        setText(
          detailStatus,
          `Could not confirm cancellation: ${error.message}`,
        );
    } finally {
      cancelling = false;
      if (selectedRun) renderDetail(selectedRun);
    }
  }

  runtime.addEventListener("change", () => {
    formEdited = true;
    pendingRequest = null;
    formFeedback = "";
    fillModes();
    persistDraft();
  });
  for (const control of [workspace, mode])
    control.addEventListener("change", () => {
      formEdited = true;
      pendingRequest = null;
      formFeedback = "";
      syncForm();
      persistDraft();
    });
  prompt.addEventListener("input", () => {
    formEdited = true;
    pendingRequest = null;
    formFeedback = "";
    syncForm();
    persistDraft();
  });
  clearDraft?.addEventListener("click", () => {
    prompt.value = "";
    formEdited = true;
    pendingRequest = null;
    reviewRequired = false;
    if (newDraft) newDraft.hidden = true;
    if (remember) remember.checked = false;
    formFeedback = "Draft cleared. Running CLI processes are unchanged.";
    persistDraft();
    syncForm();
    prompt.focus({ preventScroll: true });
  });
  newDraft?.addEventListener("click", () => {
    reviewRequired = false;
    pendingRequest = null;
    formEdited = true;
    newDraft.hidden = true;
    formFeedback =
      "Prepared as a new run. Review all fields, then select Run task to start it.";
    persistDraft();
    syncForm();
    prompt.focus({ preventScroll: true });
  });
  draft?.addEventListener("input", syncForm);
  draftTemplate?.addEventListener("click", () => queueMicrotask(syncForm));
  window.addEventListener("agent-office:task-draft-change", syncForm);
  draftRun?.addEventListener("click", () => prefill(draft.value));
  cancel.addEventListener("click", cancelSelected);
  copy.addEventListener("click", async () => {
    if (!selectedId || !selectedOutput) return;
    const id = selectedId,
      version = selectionVersion,
      action = ++copyVersion,
      text = selectedOutput;
    const current = () =>
      active &&
      selectedId === id &&
      selectionVersion === version &&
      copyVersion === action;
    try {
      await navigator.clipboard.writeText(text);
      if (current()) setText(detailStatus, "Output copied.");
    } catch {
      if (!current()) return;
      if (selectedOutput !== text) {
        setText(
          detailStatus,
          "Output changed while copying. Choose Copy output again for the current text.",
        );
        return;
      }
      const selection = getSelection();
      const range = document.createRange();
      range.selectNodeContents(output);
      selection.removeAllRanges();
      selection.addRange(range);
      setText(
        detailStatus,
        "Clipboard unavailable; output selected for copying.",
      );
    }
  });
  reuse.addEventListener("click", () => prefill(selectedRun?.prompt || ""));
  refreshClis?.addEventListener("click", rediscover);
  search?.addEventListener("input", renderRuns);
  filter?.addEventListener("change", renderRuns);
  clearFilters?.addEventListener("click", () => {
    if (search) search.value = "";
    if (filter) filter.value = "all";
    renderRuns();
    search?.focus({ preventScroll: true });
  });
  download?.addEventListener("click", () => {
    if (!selectedRun || !selectedId || !selectedOutputReady) return;
    const run = selectedRun;
    const text = [
      "Agent Office local run",
      `Run: ${selectedId}`,
      `Project: ${run.workspace_name || run.workspace_id || "Project"}`,
      `CLI: ${run.runtime} · ${run.mode}`,
      `Process: ${statusLabel(run.status)} · exit ${run.exit_code ?? "pending"}`,
      ...(run.error ? [`Error: ${run.error}`] : []),
      timeLabel(run),
      `Captured: ${new Date().toISOString()}`,
      run.output_truncated
        ? "Captured output truncated by server."
        : "Captured output snapshot.",
      "A process exit does not verify task completion. Review output and project changes.",
      "",
      "--- Exact prompt ---",
      run.prompt || "",
      "",
      "--- Output ---",
      selectedOutput,
      "",
    ].join("\n");
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `agent-office-run-${selectedId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64)}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setText(
      detailStatus,
      "Run downloaded with its prompt and captured output.",
    );
  });
  document.addEventListener("visibilitychange", () => {
    clearTimeout(pollTimer);
    if (!document.hidden) refresh().finally(schedulePoll);
  });

  window.officeTaskRunner = {
    open,
    close,
    prefill,
    refresh,
    setActive,
    status: publicStatus,
  };
  syncForm();
  syncCapability();
  if (!preview) refresh().finally(schedulePoll);
})();
