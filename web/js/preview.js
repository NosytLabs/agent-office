/* Public static demo transport. Included only by tools/build_preview.mjs. */
"use strict";
(() => {
  const fixture = window.__AGENT_OFFICE_PREVIEW_SEED__;
  if (!fixture?.synthetic || fixture.version !== 1)
    throw new Error("The static preview requires its synthetic fixture.");
  const storageKey = "agent-office:static-preview:v1";
  const nativeFetch = window.fetch.bind(window);
  const startedAt = Date.now() / 1000;
  let shift = startedAt - fixture.base_time;
  const clone = (value) => structuredClone(value);
  const emptySaved = () => ({
    settings: {},
    settingsRevision: "preview-empty-v1",
    reset: false,
    historyCleared: false,
  });
  let storageAvailable = true;
  let storageError = "";
  let legacySnapshot = null;
  let saved = readStored() || emptySaved();
  const demoSettings = {};
  syncSettings();

  function storageNotice() {
    const note = document.querySelector("#preview-notice p");
    if (note)
      note.textContent =
        "All agents, activity, XP and usage are fictional. Browser storage is unavailable; changes last for this visit only. Run locally to observe your own sessions.";
  }
  function readStored() {
    if (!storageAvailable) return null;
    let raw;
    try {
      raw = localStorage.getItem(storageKey);
    } catch {
      storageAvailable = false;
      storageNotice();
      return null;
    }
    if (raw === null) {
      legacySnapshot = null;
      storageError = "";
      return emptySaved();
    }
    try {
      if (raw.length > 65536 || new TextEncoder().encode(raw).length > 65536)
        throw new Error("Stored preferences exceed the supported size");
      const stored = JSON.parse(raw);
      if (
        stored?.version !== 1 ||
        Array.isArray(stored) ||
        !stored.settings ||
        typeof stored.settings !== "object" ||
        Array.isArray(stored.settings) ||
        (stored.settingsRevision !== undefined &&
          (typeof stored.settingsRevision !== "string" ||
            !/^[a-zA-Z0-9-]{1,128}$/.test(stored.settingsRevision)))
      )
        throw new Error("Stored preferences are invalid");
      if (stored.settingsRevision !== undefined) legacySnapshot = null;
      else if (legacySnapshot?.raw !== raw) {
        // Legacy records have no shared revision. Guard their exact bytes,
        // keeping a bounded, view-local token until a normal save persists
        // one. Another old tab's write must invalidate a stale full-map save.
        legacySnapshot = {
          raw,
          revision: "preview-legacy-" + crypto.randomUUID(),
        };
      }
      storageError = "";
      return {
        settings: normalizeSettings(stored.settings),
        settingsRevision: stored.settingsRevision || legacySnapshot.revision,
        reset: stored.reset === true,
        historyCleared: stored.historyCleared === true,
      };
    } catch {
      legacySnapshot = null;
      // Keep the last readable view and the original stored bytes. Defaults
      // must never turn unreadable preferences into a writable empty record.
      storageError = "demo-settings-invalid";
      return null;
    }
  }
  function syncSettings() {
    Object.assign(
      demoSettings,
      clone(DEFAULT_SETTINGS),
      normalizeSettings(fixture.settings),
      saved.settings,
    );
  }
  function refreshStored() {
    const latest = readStored();
    if (latest) saved = latest;
    syncSettings();
  }
  function persist() {
    if (!storageAvailable) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ version: 1, ...saved }),
      );
    } catch {
      // A quota/write failure may still permit reads of the old value. Stay
      // in memory for this visit so those reads cannot undo a completed edit.
      storageAvailable = false;
      storageNotice();
    }
  }
  async function changeSaved(change) {
    const commit = () => {
      refreshStored();
      if (storageError) return unavailableSettings();
      const result = change();
      if (result instanceof Response && !result.ok) return result;
      syncSettings();
      persist();
      return result;
    };
    // Serialize cooperating tabs when Web Locks is available. The fallback
    // still reads and merges the latest stored value without awaiting between
    // that read and its write.
    const locks = globalThis.navigator?.locks;
    return storageAvailable && locks?.request
      ? locks.request(storageKey, commit)
      : commit();
  }
  function rebase(value) {
    const times = new Set([
      "ts",
      "at",
      "received_at",
      "first_seen",
      "updated_at",
      "first_received_at",
      "observed_at",
      "source_updated_at",
    ]);
    function visit(item) {
      if (!item || typeof item !== "object") return;
      for (const [key, child] of Object.entries(item)) {
        if (times.has(key) && typeof child === "number" && child > 0)
          item[key] = child + shift;
        else visit(child);
      }
    }
    visit(value);
    return value;
  }
  function history() {
    refreshStored();
    return saved.reset || saved.historyCleared
      ? []
      : rebase(clone(fixture.history));
  }
  function state() {
    refreshStored();
    const now = Date.now() / 1000;
    const result = rebase(
      clone(saved.reset ? fixture.empty_state : fixture.state),
    );
    result.ts = now;
    result.mode = "demo";
    result.synthetic = true;
    result.settings = clone(demoSettings);
    result.settings_revision = storageError
      ? undefined
      : saved.settingsRevision;
    result.settings_status = storageError
      ? { available: false, error: storageError }
      : { available: true };
    const recordedAgents = clone(result.agents);
    result.agents = result.agents.filter((agent) => {
      const age = Math.max(0, now - agent.observed_at);
      if (agent.status === "done" && age > 120) return false;
      if (agent.status === "gone" && age > 20) return false;
      if (agent.status !== "waiting" && age > 1800) return false;
      if (["working", "thinking"].includes(agent.status) && age > 300)
        Object.assign(agent, {
          quiet: true,
          recorded_status: agent.status,
          last_tool: agent.tool || "",
          status: "idle",
          tool: "",
          activity: "",
          detail: "",
        });
      const end = ["done", "gone"].includes(agent.status)
        ? agent.observed_at
        : now;
      agent.duration_s = Math.max(0, Math.floor(end - agent.first_received_at));
      agent.idle_s = Math.floor(age);
      agent.label =
        demoSettings.agent_names[agent.id] ||
        agent.observed_label ||
        agent.label;
      return true;
    });
    result.tasks = (result.tasks || []).map((board) => {
      const matches = (agent) =>
        agent.id === board.session_id &&
        (agent.platform || "hermes") === board.runtime;
      const current = result.agents.find(matches),
        recorded = recordedAgents.find(matches);
      return {
        ...board,
        age_s: Math.max(0, Math.floor(now - board.observed_at)),
        session_status: (current || recorded)?.status || "unobserved",
        historical: !current || ["done", "gone"].includes(current.status),
      };
    });
    const visible = new Set(
      result.agents.map((agent) => `${agent.platform}\u0000${agent.id}`),
    );
    result.usage.by_session = result.usage.by_session.filter((row) =>
      visible.has(`${row.platform}\u0000${row.session_id}`),
    );
    if (saved.historyCleared) {
      result.events = [];
      result.tracking.retained = 0;
      result.tracking.retained_bytes = 0;
    }
    return result;
  }
  const response = (body, status = 200, revision = null) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...(revision ? { ETag: '"' + revision + '"' } : {}),
      },
    });
  const unavailableSettings = () =>
    response(
      {
        error:
          "Saved demo preferences cannot be read. Their original data has been kept.",
        settings: clone(demoSettings),
        settings_status: { available: false, error: storageError },
      },
      503,
    );
  window.fetch = async (input, options = {}) => {
    const request = new Request(input, options);
    if (request.signal.aborted) throw new DOMException("Aborted", "AbortError");
    const url = new URL(request.url);
    if (url.origin !== location.origin)
      return response(
        {
          error:
            "The static demo does not connect to external or local observers.",
        },
        403,
      );
    const route = url.pathname;
    if (route.startsWith("/user/"))
      return response(
        { error: "Optional local assets are not part of the public demo." },
        404,
      );
    if (!["/state", "/settings", "/history"].includes(route)) {
      if (request.method !== "GET" && request.method !== "HEAD")
        return response({ error: "Static demo endpoint not found." }, 404);
      return nativeFetch(request);
    }
    if (request.method === "GET") {
      if (route === "/state") return response(state());
      if (route === "/settings") {
        refreshStored();
        if (storageError) return unavailableSettings();
        return response(clone(demoSettings), 200, saved.settingsRevision);
      }
      const limit = Number(url.searchParams.get("limit") || 1000);
      if (!Number.isInteger(limit))
        return response({ error: "history limit must be an integer" }, 400);
      return response({
        events: history().slice(0, Math.max(1, Math.min(limit, 5000))),
      });
    }
    if (request.method === "POST" && route === "/settings") {
      if (
        request.headers.get("Content-Type")?.split(";")[0] !==
        "application/json"
      )
        return response({ error: "use application/json" }, 415);
      try {
        const text = await request.text();
        if (!text.length || new TextEncoder().encode(text).length > 65536)
          return response({ error: "settings must be 1–65536 bytes" }, 413);
        const patch = JSON.parse(text);
        if (!patch || typeof patch !== "object" || Array.isArray(patch))
          return response({ error: "expected a JSON object" }, 400);
        const condition = request.headers.get("If-Match");
        if (!condition)
          return response(
            {
              error:
                "Read current settings and send their ETag in If-Match before saving.",
            },
            428,
          );
        return await changeSaved(() => {
          if (condition !== '"' + saved.settingsRevision + '"')
            return response(
              {
                error:
                  "Settings changed in another view. Review the current settings before saving again.",
                settings: clone(demoSettings),
                settings_revision: saved.settingsRevision,
                settings_status: { available: true },
              },
              409,
              saved.settingsRevision,
            );
          Object.assign(saved.settings, normalizeSettings(patch));
          saved.settingsRevision = crypto.randomUUID();
          syncSettings();
          return response(clone(demoSettings), 200, saved.settingsRevision);
        });
      } catch {
        return response({ error: "expected a JSON object" }, 400);
      }
    }
    if (request.method === "DELETE" && route === "/history") {
      const removed = await changeSaved(() => {
        const count =
          saved.reset || saved.historyCleared ? 0 : fixture.history.length;
        saved.historyCleared = true;
        return count;
      });
      if (removed instanceof Response) return removed;
      return response({ ok: true, removed_events: removed, synthetic: true });
    }
    if (request.method === "DELETE" && route === "/state") {
      const result = await changeSaved(() => {
        saved.reset = true;
        saved.historyCleared = true;
      });
      if (result instanceof Response) return result;
      return response({
        ok: true,
        cleared: ["progress", "history", "usage"],
        legacy_log_retained: false,
        synthetic: true,
      });
    }
    return response({ error: "Method not supported by the static demo." }, 405);
  };
  document.addEventListener("DOMContentLoaded", () => {
    function clearHistoryCache() {
      historyRequest++;
      historyLoading = false;
      historyLoaded = false;
      historyEvents = [];
      historyError = "";
      historyReceived = -1;
    }
    function refreshDemo() {
      // Use the application's normal renderer without reloading. This keeps
      // demo resets coherent even when browser storage is unavailable.
      clearHistoryCache();
      seenUnlocks.clear();
      initialized = false;
      closeSheets();
      applyState(state());
    }
    window.addEventListener("storage", (event) => {
      if (event.key !== storageKey && event.key !== null) return;
      refreshStored();
      // A state read may already have observed the new flags before this
      // notification. Invalidate the separate history view unconditionally.
      clearHistoryCache();
      // Preserve open panels, local drafts, and the application's pending
      // setting patches while showing another tab's confirmed changes.
      applyState(state());
    });
    document.getElementById("preview-restore").onclick = async () => {
      const result = await changeSaved(() => {
        saved.reset = false;
        saved.historyCleared = false;
      });
      if (result instanceof Response && !result.ok) {
        applyState(state());
        return;
      }
      shift = Date.now() / 1000 - fixture.base_time;
      refreshDemo();
    };
    document.getElementById("resetbtn").onclick = async () => {
      if (
        !confirm(
          "Reset the fictional agents, demo XP, usage and history? Your room preferences will stay. Restore sample can bring the example back.",
        )
      )
        return;
      const result = await fetch("state", { method: "DELETE" });
      if (result.ok) refreshDemo();
    };
    document.getElementById("resetbtn").textContent = "Reset demo progress";
    document.getElementById("clear-history").textContent = "Clear demo history";
  });
})();
