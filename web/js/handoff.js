/* OpenCode session handoff. An explicit, loopback-only send of one reviewed
 * prompt to a paired, existing OpenCode session, with a durable receipt for
 * every submission. Only the explicit Send action dispatches.
 */
(function () {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const root = byId("session-handoff");
  if (!root) return;

  const capabilityText = byId("handoff-capability");
  const enableHelp = byId("handoff-enable");
  const pairedCard = byId("handoff-paired");
  const pairServer = byId("handoff-pair-server");
  const pairSession = byId("handoff-pair-session");
  const pairProject = byId("handoff-pair-project");
  const pairVersion = byId("handoff-pair-version");
  const pairAt = byId("handoff-pair-at");
  const changeButton = byId("handoff-change");
  const unpairButton = byId("handoff-unpair");
  const pairForm = byId("handoff-form");
  const pairServerInput = byId("handoff-server-url");
  const pairSessionInput = byId("handoff-session-id");
  const pairProjectInput = byId("handoff-project");
  const pairSubmit = byId("handoff-pair-submit");
  const pairCancel = byId("handoff-pair-cancel");
  const pairStatus = byId("handoff-pair-status");
  const sendForm = byId("handoff-send");
  const prompt = byId("handoff-prompt");
  const count = byId("handoff-count");
  const remember = byId("handoff-remember");
  const draftStatus = byId("handoff-draft-status");
  const clearDraft = byId("handoff-clear-draft");
  const sendSubmit = byId("handoff-send-submit");
  const sendStatus = byId("handoff-send-status");
  // Receipt history.
  const search = byId("handoff-search");
  const filter = byId("handoff-filter");
  const clearFilters = byId("handoff-clear");
  const results = byId("handoff-results");
  const list = byId("handoff-list");

  const preview = document.body.dataset.agentOfficePreview === "1";
  const draftKey = "agent-office:handoff-draft:v1";
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  const ACTIVE = new Set([
    "submitted",
    "accepted",
    "executing",
    "awaiting_input",
    "unknown",
  ]);
  const STATE_LABEL = {
    submitted: "Submitted",
    accepted: "Accepted",
    executing: "Executing",
    awaiting_input: "Waiting for input",
    completed: "Completed",
    failed: "Failed",
    rejected: "Rejected",
    cancelled: "Cancelled",
    unknown: "Delivery uncertain",
  };

  let active = false;
  let connected = false;
  let capability = null;
  let operations = [];
  let selectedId = null;
  let selectedOp = null;
  let pollTimer = null;
  let refreshPromise = null;
  let detailPromise = null;
  let detailRequestId = null;
  let refreshSequence = 0;
  let detailSequence = 0;
  let pairingInFlight = false;
  let unpairing = false;
  let sending = false;
  let refreshing = false;
  let cancelling = false;
  let cancelTarget = null;
  let pairingFormOpen = false;
  let pendingRequest = null;
  let reviewRequired = false;
  let formEdited = false;
  let savedDraft = null;
  let draftRestored = false;
  let draftSaveDeferred = false;
  const opNodes = new Map();

  const pad = (value) =>
    typeof value === "string" || typeof value === "number" ? String(value) : "";

  function setText(element, value) {
    const text = String(value ?? "");
    if (element && element.textContent !== text) element.textContent = text;
  }

  function instanceId() {
    return capability?.instance_id || "";
  }

  function pairing() {
    return capability?.paired ? capability?.pairing : null;
  }

  // Destination changes and dispatch share one exclusive transition. Polls
  // may observe its result afterward, but cannot supersede its acknowledgement.
  function destinationBusy() {
    return pairingInFlight || unpairing || sending;
  }

  const pairingFields = [
    "server_url",
    "session_id",
    "project_directory",
    "runtime_version",
  ];

  function reviewedPairing() {
    const p = pairing();
    return p
      ? Object.fromEntries(pairingFields.map((key) => [key, p[key]]))
      : null;
  }

  function validPairingSnapshot(value) {
    return (
      value &&
      typeof value === "object" &&
      Object.keys(value).length === pairingFields.length &&
      pairingFields.every(
        (key) =>
          typeof value[key] === "string" &&
          value[key].length > 0 &&
          value[key].length <= 8192,
      )
    );
  }

  function matchesReviewedPairing(value) {
    const p = pairing();
    return (
      !!p &&
      validPairingSnapshot(value) &&
      pairingFields.every((key) => value[key] === p[key])
    );
  }

  function timeLabel(value) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0)
      return "time unavailable";
    const date = new Date(timestamp * 1000);
    return Number.isFinite(date.getTime())
      ? date.toLocaleString()
      : "time unavailable";
  }

  function stateTerminal(op) {
    return !ACTIVE.has(op?.state);
  }

  // -- persistence --------------------------------------------------------

  function formPayload() {
    return { prompt: prompt.value };
  }

  function payloadSignature(payload) {
    return JSON.stringify([payload.prompt]);
  }

  function persistDraft() {
    if (!remember || preview) return;
    try {
      if (!remember.checked) {
        draftSaveDeferred = false;
        sessionStorage.removeItem(draftKey);
        savedDraft = null;
        setText(
          draftStatus,
          "Draft retention is off. Your open prompt is unchanged.",
        );
        return;
      }
      const p = pairing();
      if (!capability?.enabled || !p) {
        draftSaveDeferred = true;
        setText(
          draftStatus,
          "Waiting for a paired destination. Current edits have not been retained yet.",
        );
        return;
      }
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
        server_url: p.server_url,
        session_id: p.session_id,
        project_directory: p.project_directory,
        instance_id: capability.instance_id || null,
        pending_id:
          pendingRequest?.signature === payloadSignature(payload)
            ? pendingRequest.id
            : null,
        expected_pairing:
          pendingRequest?.signature === payloadSignature(payload)
            ? pendingRequest.pairing
            : reviewedPairing(),
        review_required: reviewRequired,
      };
      sessionStorage.setItem(draftKey, JSON.stringify(savedDraft));
      draftSaveDeferred = false;
      setText(
        draftStatus,
        "Draft retained in this tab until cleared. Reloading never sends it.",
      );
    } catch {
      setText(
        draftStatus,
        "Browser storage is unavailable. This draft is usable but changes were not retained.",
      );
    }
  }

  function syncPairingFormFromDraft() {
    if (!savedDraft) return;
    pairServerInput.value = savedDraft.server_url || pairServerInput.value;
    pairSessionInput.value = savedDraft.session_id || pairSessionInput.value;
    pairProjectInput.value =
      savedDraft.project_directory || pairProjectInput.value;
  }

  function restoreDraft() {
    if (draftRestored || !capability?.enabled) return;
    draftRestored = true;
    if (!savedDraft) return;
    const retained = savedDraft;
    savedDraft = null;
    const editedBeforeRestore = formEdited;
    if (!editedBeforeRestore) prompt.value = retained.prompt;
    const p = pairing();
    const destinationMatches =
      !!p &&
      p.server_url === retained.server_url &&
      p.session_id === retained.session_id &&
      p.project_directory === retained.project_directory;
    if (retained.pending_id)
      pendingRequest = {
        id: retained.pending_id,
        signature: payloadSignature(formPayload()),
        pairing: retained.expected_pairing || null,
      };
    if (destinationMatches) {
      // Reuse the previous request identity for the unchanged prompt so a
      // reload neither duplicates nor loses an uncertain submission.
      reviewRequired =
        retained.review_required ||
        (!!retained.pending_id &&
          (editedBeforeRestore ||
            !matchesReviewedPairing(retained.expected_pairing) ||
            !uuid.test(capability.instance_id || "") ||
            capability.instance_id !== retained.instance_id));
    } else {
      // The destination changed or is no longer paired; never reuse the old
      // request identity silently. The prompt stays, but review is required.
      reviewRequired = true;
    }
    recallPairingForm();
    setText(
      draftStatus,
      reviewRequired
        ? "Draft restored, but the destination must be reviewed before sending. `Clear draft` starts fresh."
        : "Draft restored with its previous request ID. An unchanged retry reuses that ID.",
    );
    formEdited = true;
    if (editedBeforeRestore) persistDraft();
  }

  function recallPairingForm() {
    // If we restore a draft whose destination is no longer paired, pre-fill
    // the reviewed values so a re-review is quick.
    syncPairingFormFromDraft();
  }

  if (remember) {
    remember.disabled = true;
    try {
      const raw = !preview && sessionStorage.getItem(draftKey);
      if (raw) {
        if (raw.length > 70000) throw new Error("Oversized draft");
        const value = JSON.parse(raw);
        if (
          value?.version !== 1 ||
          typeof value.prompt !== "string" ||
          Array.from(value.prompt).length > 8192 ||
          typeof value.server_url !== "string" ||
          !value.server_url ||
          value.server_url.length > 2048 ||
          typeof value.session_id !== "string" ||
          !value.session_id ||
          value.session_id.length > 256 ||
          typeof value.project_directory !== "string" ||
          !value.project_directory ||
          value.project_directory.length > 4096 ||
          !uuid.test(value.instance_id || "") ||
          (value.pending_id != null && !uuid.test(value.pending_id)) ||
          (value.expected_pairing != null &&
            !validPairingSnapshot(value.expected_pairing)) ||
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

  // -- HTTP ---------------------------------------------------------------

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
        // The status code remains useful when an intermediary returns text.
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

  // -- validity -----------------------------------------------------------

  function sendValidity() {
    if (preview)
      return "Session handoff is available only from the local Agent Office browser, not this preview.";
    if (!connected)
      return "Handoff controls are disconnected. Open Agent Office in your local browser and keep python3 run.py running.";
    if (!capability?.enabled)
      return "Session handoff is disabled. Restart Agent Office with the command shown above.";
    if (pairingInFlight || unpairing)
      return "Wait for the destination change to finish before sending.";
    if (!pairing()) return "Choose and review a destination before sending.";
    if (reviewRequired)
      return "Review the previous uncertain submission as a new send, or clear this draft, before sending.";
    if (!prompt.value.trim()) return "Enter an exact prompt before sending.";
    const max = Number(capability.max_prompt_chars) || 8192;
    if (Array.from(prompt.value).length > max)
      return `Prompt exceeds the ${max.toLocaleString()} character limit.`;
    if (
      operations.filter((op) => ACTIVE.has(op.state)).length >=
      (Number(capability.max_active_operations) || 2)
    )
      return "The handoff adapter is at its active operation limit. Wait for or cancel a receipt.";
    return "";
  }

  function pairValidity() {
    if (preview || !connected || !capability?.enabled)
      return "Pairing is unavailable until the local handoff adapter is connected and enabled.";
    if (sending || unpairing)
      return "Wait for the current handoff action before changing destination.";
    if (
      !pairServerInput.value.trim() ||
      !pairSessionInput.value.trim() ||
      !pairProjectInput.value.trim()
    )
      return "Enter the server, session ID, and project directory you reviewed.";
    if (/^https?:/i.test(pairServerInput.value.trim())) {
      if (
        !/^https?:\/\/127\.0\.0\.1(:\d+)?\/?$|^https?:\/\/localhost(:\d+)?\/?$|^https?:\/\/\[::1\](:\d+)?\/?$/.test(
          pairServerInput.value.trim(),
        )
      )
        return "The server must be a loopback OpenCode origin like http://127.0.0.1:4096.";
    }
    if (/\s|\/|\?|#/.test(pairSessionInput.value.trim()))
      return "Session ID must not contain whitespace, slashes, or query hashes.";
    return "";
  }

  function syncSendForm() {
    const max = Number(capability?.max_prompt_chars) || 8192;
    prompt.removeAttribute("maxlength");
    setText(
      count,
      `${Array.from(prompt.value).length.toLocaleString()} / ${max.toLocaleString()} characters`,
    );
    const issue = sendValidity();
    sendSubmit.disabled =
      sending || refreshing || !!issue || !capability?.enabled || !pairing();
  }

  // -- receipt rendering ---------------------------------------------------

  function receiptTitle(op) {
    const p = pairing();
    return (
      op.project_directory ||
      (p?.project_directory ? `${p.project_directory}` : "Paired project")
    );
  }

  function renderFilters() {
    // Build the state filter from the states actually present so a user can
    // filter to a single visible delivery state.
    const states = [...new Set(operations.map((op) => op.state))].sort();
    const wanted = new Set(states);
    const keep = [...filter.options].filter(
      (option) => option.value === "all" || wanted.has(option.value),
    );
    const current = filter.value;
    if (keep.length !== filter.options.length) {
      const was = filter.value;
      filter.replaceChildren(...keep);
      if ([...filter.options].some((option) => option.value === was))
        filter.value = was;
      else filter.value = "all";
    }
    if (current !== filter.value) renderOperations();
  }

  function renderOperations() {
    renderFilters();
    const empty = list.querySelector(".handoff-empty");
    const query = (search?.value || "").trim().toLowerCase();
    const state = filter?.value || "all";
    let matches = 0;
    const wanted = new Set();
    empty?.remove();
    for (const op of operations) {
      const id = String(op.id);
      wanted.add(id);
      let node = opNodes.get(id);
      if (!node) {
        node = document.createElement("button");
        node.type = "button";
        node.className = "btn handoff-card";
        node.append(
          document.createElement("strong"),
          document.createElement("span"),
          document.createElement("small"),
        );
        node.setAttribute("aria-pressed", "false");
        node.onclick = () => selectOperation(id);
        opNodes.set(id, node);
      }
      updateOpNode(node, op);
      node.hidden =
        (state !== "all" && op.state !== state) ||
        ![
          op.prompt,
          op.session_id,
          op.project_directory,
          op.runtime_version,
        ].some((value) =>
          String(value || "")
            .toLowerCase()
            .includes(query),
        );
      if (!node.hidden) matches++;
      list.append(node);
    }
    for (const [id, node] of opNodes) {
      if (!wanted.has(id)) {
        node.remove();
        opNodes.delete(id);
      }
    }
    setText(results, `${matches} of ${operations.length} receipts`);
    if (!matches) {
      let note = list.querySelector(".handoff-empty");
      if (!note) {
        note = document.createElement("p");
        note.className = "h handoff-empty";
        note.textContent = operations.length
          ? "No receipts match these filters. Clear filters to see all receipts."
          : "No handoff receipts yet. Pair a destination and send a prompt.";
        list.append(note);
      }
    }
    if (selectedId && !operations.some((op) => String(op.id) === selectedId)) {
      detailSequence++;
      detailPromise = null;
      detailRequestId = null;
      selectedId = null;
      selectedOp = null;
    }
    if (selectedId) loadDetail(selectedId);
    if (selectedOp) renderDetail();
    syncSendForm();
  }

  function updateOpNode(node, op) {
    node.dataset.operationId = String(op.id);
    node.setAttribute("aria-pressed", String(op.id === selectedId));
    const p = pairing();
    setText(node.querySelector("strong"), op.session_id || "Paired session");
    const badge = node.querySelector("span");
    badge.className = `handoff-status-${op.state}`;
    setText(badge, STATE_LABEL[op.state] || op.state);
    setText(
      node.querySelector("small"),
      `${p?.server_url || op.server_url || "server"} · ${timeLabel(op.created_at)}`,
    );
    node.title = `Receipt ${op.id}`;
  }

  function renderDetail() {
    if (!selectedOp) return;
    const op = selectedOp;
    // The detail is rendered into a detail region we build inline per card.
    const detailEl = list.querySelector(`[data-detail="${op.id}"]`);
    if (!detailEl) return;
    const status = detailEl.querySelector(".handoff-detail-status");
    const refreshBtn = detailEl.querySelector(".handoff-refresh");
    const cancelBtn = detailEl.querySelector(".handoff-cancel");
    const promptText = detailEl.querySelector(".handoff-prompt-text");
    const meta = detailEl.querySelector(".handoff-detail-meta");
    if (promptText) setText(promptText, op.prompt || "");
    const pieces = [];
    pieces.push(`state ${op.state}`);
    pieces.push(`destination ${op.project_directory || "paired"}`);
    if (op.runtime_version) pieces.push(`runtime ${op.runtime_version}`);
    pieces.push(`created ${timeLabel(op.created_at)}`);
    if (op.finished_at) pieces.push(`finished ${timeLabel(op.finished_at)}`);
    if (op.delivered_message_id)
      pieces.push(`delivered ${op.delivered_message_id}`);
    if (op.assistant_message_id)
      pieces.push(`assistant ${op.assistant_message_id}`);
    if (op.cancel_requested) pieces.push("cancellation requested");
    const errorBits = [];
    if (op.error) errorBits.push(op.error);
    if (!op.error && ACTIVE.has(op.state))
      errorBits.push(
        op.state === "unknown"
          ? "delivery is uncertain; refresh reconciles against runtime history"
          : "refresh reconciles this receipt against runtime history",
      );
    if (errorBits.length) pieces.push(errorBits.join(" · "));
    setText(meta, pieces.join(" · "));
    refreshBtn.disabled = refreshing;
    refreshBtn.hidden = false;
    refreshBtn.onclick = () => refreshOperation(op.id);
    cancelBtn.disabled = cancelling;
    cancelBtn.hidden = stateTerminal(op);
    cancelBtn.onclick = () => cancelOperation(op.id);
    const current = cancelling && cancelTarget === op.id;
    // Preserve the last action message (reconciled / cancellation recorded)
    // across reconciliation polls; only overwrite it while a cancel is in
    // flight or when a different receipt is selected.
    if (current) setText(status, "Requesting cancellation…");
  }

  function operationDetailNode(op) {
    let detailEl = list.querySelector(`[data-detail="${op.id}"]`);
    if (detailEl) return detailEl;
    detailEl = document.createElement("div");
    detailEl.dataset.detail = op.id;
    detailEl.className = "handoff-detail";
    detailEl.append(
      Object.assign(document.createElement("p"), {
        className: "h handoff-detail-meta",
      }),
      Object.assign(document.createElement("pre"), {
        className: "handoff-prompt-text",
        tabIndex: 0,
      }),
      Object.assign(document.createElement("div"), { className: "cluster" }),
    );
    const actions = detailEl.querySelector(".cluster");
    const refresh = Object.assign(document.createElement("button"), {
      type: "button",
      className: "btn handoff-refresh",
      textContent: "Refresh",
    });
    const cancel = Object.assign(document.createElement("button"), {
      type: "button",
      className: "btn handoff-cancel",
      textContent: "Cancel",
    });
    actions.append(refresh, cancel);
    detailEl.append(
      Object.assign(document.createElement("p"), {
        className: "h handoff-detail-status",
        role: "status",
        "aria-live": "polite",
      }),
    );
    list.append(detailEl);
    return detailEl;
  }

  function selectOperation(id) {
    detailSequence++;
    selectedId = String(id);
    const op = operations.find((item) => String(item.id) === selectedId);
    if (!op) {
      selectedId = null;
      selectedOp = null;
      return;
    }
    selectedOp = { ...op };
    operationDetailNode(selectedOp);
    setText(
      list.querySelector(
        '[data-detail="' + selectedId + '"] .handoff-detail-status',
      ),
      "",
    );
    renderOperations();
    loadDetail(selectedId);
  }

  async function loadDetail(id) {
    if (!active || !id || preview || !connected || !capability?.enabled) return;
    if (detailPromise && detailRequestId === String(id)) return detailPromise;
    const sequence = ++detailSequence;
    detailRequestId = String(id);
    detailPromise = request(`opencode-handoff/${encodeURIComponent(id)}`)
      .then((body) => {
        if (sequence !== detailSequence || selectedId !== String(id)) return;
        const op = body?.operation;
        if (!op) throw new Error("Server returned an invalid receipt");
        const index = operations.findIndex(
          (item) => String(item.id) === String(id),
        );
        if (index >= 0) operations[index] = op;
        else operations = [op, ...operations];
        selectedOp = op;
        renderOperations();
      })
      .catch((error) => {
        if (sequence === detailSequence)
          setText(
            operationDetailNode({ id })?.querySelector(
              ".handoff-detail-status",
            ),
            `Could not load receipt: ${error.message}`,
          );
      })
      .finally(() => {
        if (sequence === detailSequence) {
          detailPromise = null;
          detailRequestId = null;
        }
      });
    return detailPromise;
  }

  // -- pair / unpair ------------------------------------------------------

  function syncPairingForm() {
    const p = pairing();
    const available = !preview && connected && !!capability?.enabled;
    pairForm.hidden = !available || (!!p && !pairingFormOpen);
    pairCancel.hidden = !p;
    if (p) {
      setText(pairServer, p.server_url);
      setText(
        pairSession,
        p.session_title ? `${p.session_id} · ${p.session_title}` : p.session_id,
      );
      setText(pairProject, p.project_directory);
      setText(pairVersion, p.runtime_version || "unknown");
      setText(pairAt, timeLabel(p.paired_at));
      pairedCard.hidden = false;
      sendForm.hidden = false;
      pairSubmit.textContent = "Update & pair";
    } else {
      pairedCard.hidden = true;
      sendForm.hidden = true;
      pairSubmit.textContent = "Review & pair";
    }
    unpairButton.disabled = !available || destinationBusy() || !p;
    changeButton.disabled = !available || destinationBusy();
    pairSubmit.disabled = !available || destinationBusy();
    syncSendForm();
  }

  function openPairingForm() {
    if (preview || !connected || !capability?.enabled) {
      syncPairingForm();
      return;
    }
    pairingFormOpen = true;
    pairForm.hidden = false;
    pairCancel.hidden = !pairing();
    pairStatus.textContent = "";
    setText(pairStatus, "");
    if (!pairing()) {
      pairServerInput.focus({ preventScroll: true });
    }
    syncPairingForm();
  }

  function closePairingForm() {
    pairingFormOpen = false;
    pairForm.hidden = true;
    syncPairingForm();
  }

  pairForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const issue = pairValidity();
    if (issue || pairingInFlight) {
      setText(pairStatus, issue || "A pairing request is already in progress.");
      return;
    }
    const payload = {
      server_url: pairServerInput.value.trim(),
      session_id: pairSessionInput.value.trim(),
      project_directory: pairProjectInput.value.trim(),
    };
    pairingInFlight = true;
    syncPairingForm();
    setText(pairStatus, "Reviewing the server, session and project…");
    try {
      const sequence = ++refreshSequence;
      const body = await request("opencode-handoff/pair", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Office-Token": capability.token,
        },
        body: JSON.stringify(payload),
      });
      if (sequence !== refreshSequence) return;
      if (!body?.pairing) throw new Error("Server returned an invalid pairing");
      capability = {
        ...capability,
        paired: true,
        pairing: body.pairing,
      };
      // A new destination invalidates any pending request identity.
      pendingRequest = null;
      reviewRequired = false;
      formEdited = true;
      pairingFormOpen = false;
      setText(pairStatus, "Paired. Review the exact prompt before sending.");
      syncCapability();
      persistDraft();
      restoreDraft();
    } catch (error) {
      setText(
        pairStatus,
        `Could not pair: ${error.message}. Review the server, session and project.`,
      );
    } finally {
      pairingInFlight = false;
      pairSubmit.disabled = false;
      syncPairingForm();
    }
  });

  changeButton.addEventListener("click", () => {
    syncPairingFormFromDraft();
    openPairingForm();
  });
  pairCancel.addEventListener("click", closePairingForm);

  unpairButton.addEventListener("click", async () => {
    if (!pairing() || destinationBusy()) return;
    const ownedFocus = document.activeElement === unpairButton;
    const interactionCurrent = capturePanelInteraction();
    unpairing = true;
    syncPairingForm();
    setText(pairStatus, "Unpairing…");
    try {
      const sequence = ++refreshSequence;
      const body = await request("opencode-handoff/unpair", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Office-Token": capability.token,
        },
        body: "{}",
      });
      if (sequence !== refreshSequence) return;
      if (body?.pairing !== null)
        throw new Error("Server returned an invalid unpairing response");
      capability = { ...capability, paired: false, pairing: null };
      pendingRequest = null;
      reviewRequired = false;
      formEdited = true;
      setText(
        pairStatus,
        "Unpaired. No prompt can be sent until you pair again.",
      );
      const focusStillOwned =
        ownedFocus &&
        (document.activeElement === unpairButton ||
          document.activeElement === document.body);
      syncCapability();
      if (
        active &&
        focusStillOwned &&
        interactionCurrent() &&
        (document.activeElement === unpairButton ||
          document.activeElement === document.body)
      )
        pairServerInput.focus({ preventScroll: true });
      persistDraft();
    } catch (error) {
      const uncertain = !error.status || error.name === "AbortError";
      setText(
        pairStatus,
        `${uncertain ? "Unpair result uncertain; refresh and check status before sending." : "Could not unpair."} ${error.message}`,
      );
    } finally {
      unpairing = false;
      syncPairingForm();
    }
  });

  // -- send ---------------------------------------------------------------

  sendForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const issue = sendValidity();
    if (issue || sending) {
      setText(
        sendStatus,
        issue || "A send is already in progress. Your draft is unchanged.",
      );
      return;
    }
    if (!pairing()) {
      setText(sendStatus, "Pair a destination before sending.");
      return;
    }
    const payload = formPayload();
    const signature = payloadSignature(payload);
    if (!pendingRequest || pendingRequest.signature !== signature)
      pendingRequest = {
        signature,
        id: crypto.randomUUID(),
        pairing: reviewedPairing(),
      };
    payload.request_id = pendingRequest.id;
    payload.expected_pairing = pendingRequest.pairing;
    persistDraft();
    sending = true;
    setText(
      sendStatus,
      "Recording the receipt, then sending the exact prompt…",
    );
    syncPairingForm();
    try {
      const sequence = ++refreshSequence;
      const body = await request("opencode-handoff/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Agent-Office-Token": capability.token,
        },
        body: JSON.stringify(payload),
      });
      if (sequence !== refreshSequence) return;
      const op = body?.operation;
      if (!op?.id) throw new Error("Server returned an invalid receipt");
      pendingRequest = null;
      persistDraft();
      const index = operations.findIndex(
        (item) => String(item.id) === String(op.id),
      );
      if (index >= 0) operations[index] = op;
      else operations = [op, ...operations];
      if (search) search.value = "";
      if (filter) filter.value = "all";
      renderOperations();
      selectOperation(op.id);
      setText(
        sendStatus,
        op.state === "failed" || op.state === "rejected"
          ? `Send recorded as ${STATE_LABEL[op.state]?.toLowerCase()}. Review the receipt.`
          : op.state === "unknown"
            ? "Send recorded; delivery is uncertain. Use Refresh on the receipt to reconcile it."
            : "Prompt sent. Refresh the receipt to reconcile delivery.",
      );
    } catch (error) {
      const uncertain = !error.status || error.name === "AbortError";
      setText(
        sendStatus,
        `${uncertain ? "The result is uncertain; retrying this unchanged prompt reuses its request ID." : "Prompt was not dispatched."} ${error.message} Your draft is unchanged.`,
      );
    } finally {
      sending = false;
      syncPairingForm();
    }
  });

  // -- refresh / cancel ---------------------------------------------------

  async function refreshOperation(id) {
    if (refreshing || !id) return;
    refreshing = true;
    const sequence = ++detailSequence;
    syncSendForm();
    try {
      const body = await request(
        `opencode-handoff/${encodeURIComponent(id)}/refresh`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Agent-Office-Token": capability.token,
          },
          body: "{}",
        },
      );
      if (sequence !== detailSequence) return;
      const op = body?.operation;
      if (!op) throw new Error("Server returned an invalid reconciliation");
      const index = operations.findIndex(
        (item) => String(item.id) === String(id),
      );
      if (index >= 0) operations[index] = op;
      if (selectedId === String(id)) selectedOp = op;
      renderOperations();
      if (selectedId === String(id))
        setText(
          list.querySelector(
            '[data-detail="' + id + '"] .handoff-detail-status',
          ),
          `Reconciled: ${STATE_LABEL[op.state] || op.state}.`,
        );
    } catch (error) {
      if (sequence === detailSequence)
        setText(
          list.querySelector(
            '[data-detail="' + id + '"] .handoff-detail-status',
          ),
          `Could not refresh: ${error.message}`,
        );
    } finally {
      refreshing = false;
      syncSendForm();
    }
  }

  async function cancelOperation(id) {
    if (cancelling || !id) return;
    const op = operations.find((item) => String(item.id) === String(id));
    if (!op || stateTerminal(op)) return;
    cancelling = true;
    cancelTarget = id;
    const sequence = ++detailSequence;
    setText(
      list.querySelector('[data-detail="' + id + '"] .handoff-detail-status'),
      "Requesting cancellation…",
    );
    try {
      const body = await request(
        `opencode-handoff/${encodeURIComponent(id)}/cancel`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Agent-Office-Token": capability.token,
          },
          body: "{}",
        },
      );
      if (sequence === detailSequence) {
        const op2 = body?.operation;
        if (op2) {
          const index = operations.findIndex(
            (item) => String(item.id) === String(id),
          );
          if (index >= 0) operations[index] = op2;
          if (selectedId === String(id)) selectedOp = op2;
          renderOperations();
          setText(
            list.querySelector(
              '[data-detail="' + id + '"] .handoff-detail-status',
            ),
            `Cancellation recorded: ${STATE_LABEL[op2.state] || op2.state}.`,
          );
        }
      }
    } catch (error) {
      if (sequence === detailSequence)
        setText(
          list.querySelector(
            '[data-detail="' + id + '"] .handoff-detail-status',
          ),
          `Could not confirm cancellation: ${error.message}`,
        );
    } finally {
      cancelling = false;
      cancelTarget = null;
      syncSendForm();
    }
  }

  // -- capability sync ----------------------------------------------------

  function syncCapability() {
    if (pendingRequest && !matchesReviewedPairing(pendingRequest.pairing)) {
      reviewRequired = true;
      setText(
        sendStatus,
        "The destination changed after an uncertain send. Review and pair again before starting a new send.",
      );
    }
    if (remember)
      remember.disabled = preview || !connected || !capability?.enabled;
    enableHelp.hidden = preview || !!capability?.enabled;
    const p = pairing();
    if (preview)
      setText(
        capabilityText,
        "Session handoff is available only from the local Agent Office browser. This preview cannot pair or send.",
      );
    else if (!connected)
      setText(
        capabilityText,
        "Handoff controls are unavailable here. Open the URL printed by python3 run.py in a local browser.",
      );
    else if (!capability?.enabled)
      setText(
        capabilityText,
        "Session handoff is disabled by default. Enable it only when you start Agent Office.",
      );
    else if (!p)
      setText(
        capabilityText,
        "Not paired. Choose a reviewed loopback server, session and project to enable sending.",
      );
    else
      setText(
        capabilityText,
        `Paired to ${p.server_url} · session ${p.session_id} · runtime ${p.runtime_version || "unknown"}`,
      );
    syncPairingForm();
    restoreDraft();
    if (draftSaveDeferred) persistDraft();
    syncSendForm();
    renderOperations();
  }

  function schedulePoll() {
    clearTimeout(pollTimer);
    if (preview || document.hidden) return;
    if (connected && capability && !capability.enabled) return;
    const delay = active ? 1800 : 15000;
    pollTimer = setTimeout(() => refresh().finally(schedulePoll), delay);
  }

  async function refresh() {
    if (preview) {
      connected = false;
      syncCapability();
      return;
    }
    if (destinationBusy()) return;
    if (refreshPromise) return refreshPromise;
    const sequence = ++refreshSequence;
    refreshPromise = request("opencode-handoff")
      .then((body) => {
        if (sequence !== refreshSequence) return;
        const valid =
          body &&
          typeof body === "object" &&
          typeof body.enabled === "boolean" &&
          typeof body.paired === "boolean" &&
          Array.isArray(body.operations);
        if (!valid)
          throw new Error("Server returned an invalid handoff response");
        capability = body;
        connected = true;
        operations = Array.isArray(body.operations)
          ? body.operations.map((op) => ({ ...op }))
          : [];
        syncCapability();
        if (selectedId) loadDetail(selectedId);
      })
      .catch((error) => {
        if (sequence !== refreshSequence) return;
        connected = false;
        syncCapability();
        setText(
          sendStatus,
          `Handoff connection failed: ${error.message}. Your draft is unchanged.`,
        );
      })
      .finally(() => {
        refreshPromise = null;
      });
    return refreshPromise;
  }

  function setActive(value) {
    const next = !!value;
    if (active === next) {
      root.hidden = !next;
      return;
    }
    active = next;
    root.hidden = !active;
    clearTimeout(pollTimer);
    if (active) {
      refresh().finally(schedulePoll);
      if (!pairing()) openPairingForm();
    }
  }

  function open() {
    const tasksButton = document.querySelector('[data-sheet="sheet-tasks"]');
    const sheet = byId("sheet-tasks");
    if (tasksButton && sheet?.hidden) tasksButton.click();
    const tab = document.querySelector('[data-task-view="handoff"]');
    if (tab?.getAttribute("aria-pressed") !== "true") tab?.click();
    setActive(true);
  }

  function close() {
    setActive(false);
  }

  // Wire the initial pairing form + send form visibility.
  prompt.addEventListener("input", () => {
    formEdited = true;
    pendingRequest = null;
    syncSendForm();
    persistDraft();
  });
  clearDraft?.addEventListener("click", () => {
    prompt.value = "";
    formEdited = true;
    pendingRequest = null;
    reviewRequired = false;
    if (remember) remember.checked = false;
    persistDraft();
    syncSendForm();
    prompt.focus({ preventScroll: true });
  });
  search?.addEventListener("input", renderOperations);
  filter?.addEventListener("change", renderOperations);
  clearFilters?.addEventListener("click", () => {
    if (search) search.value = "";
    if (filter) filter.value = "all";
    renderOperations();
    search?.focus({ preventScroll: true });
  });
  document.addEventListener("visibilitychange", () => {
    clearTimeout(pollTimer);
    if (!document.hidden) refresh().finally(schedulePoll);
  });

  window.officeHandoff = {
    open,
    close,
    setActive,
    refresh,
    status: () => ({
      enabled: !!capability?.enabled,
      connected,
      paired: !!pairing(),
      operations: operations.length,
    }),
  };
  syncCapability();
  if (!preview) refresh().finally(schedulePoll);
})();
