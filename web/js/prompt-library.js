/* Explicitly saved, browser-local task briefs. Never contacts a runtime. */
"use strict";
(function (root) {
  const MAX_BRIEFS = 12,
    MAX_TEXT = 8192,
    MAX_NAME = 48,
    MAX_BYTES = 1048576;
  const runtimes = new Set([
    "opencode",
    "claude",
    "codex",
    "hermes",
    "gemini",
    "openclaw",
    "other",
  ]);
  const storageKey = (preview = false) =>
    "agent-office:prompt-library:v1:" + (preview ? "preview" : "observer");
  const copy = (items) => items.map((item) => ({ ...item }));
  const textLength = (value) => Array.from(value).length;
  const nameKey = (name) => name.toLowerCase();
  function validName(value) {
    return (
      typeof value === "string" &&
      value === value.trim() &&
      value.length > 0 &&
      value.length <= MAX_NAME &&
      !/[\x00-\x1f\x7f]/.test(value)
    );
  }
  function validText(value) {
    return (
      typeof value === "string" &&
      textLength(value) <= MAX_TEXT &&
      !!value.trim()
    );
  }
  function validBrief(item) {
    return (
      item &&
      typeof item === "object" &&
      !Array.isArray(item) &&
      Object.keys(item).sort().join(",") === "id,name,runtime,text" &&
      typeof item.id === "string" &&
      /^[a-zA-Z0-9_-]{1,80}$/.test(item.id) &&
      validName(item.name) &&
      runtimes.has(item.runtime) &&
      validText(item.text)
    );
  }
  function parseLibrary(raw) {
    if (raw === null) return { version: 1, briefs: [] };
    try {
      if (
        typeof raw !== "string" ||
        raw.length > MAX_BYTES ||
        new TextEncoder().encode(raw).byteLength > MAX_BYTES
      )
        throw new Error();
      const value = JSON.parse(raw);
      if (
        !value ||
        Object.keys(value).sort().join(",") !== "briefs,version" ||
        value.version !== 1 ||
        !Array.isArray(value.briefs) ||
        value.briefs.length > MAX_BRIEFS
      )
        throw new Error();
      const ids = new Set(),
        names = new Set();
      for (const item of value.briefs) {
        if (
          !validBrief(item) ||
          ids.has(item.id) ||
          names.has(nameKey(item.name))
        )
          throw new Error();
        ids.add(item.id);
        names.add(nameKey(item.name));
      }
      return { version: 1, briefs: copy(value.briefs) };
    } catch {
      throw new Error(
        "Saved brief data is invalid. Stored data was left untouched; your open draft is unchanged.",
      );
    }
  }
  function searchBriefs(items, query) {
    const needle = String(query || "")
      .slice(0, 160)
      .trim()
      .toLowerCase();
    return items.filter(
      (item) =>
        !needle ||
        [item.name, item.runtime, item.text].some((value) =>
          value.toLowerCase().includes(needle),
        ),
    );
  }
  function serializeLibrary(briefs) {
    const raw = JSON.stringify({ version: 1, briefs }, null, 2) + "\n";
    parseLibrary(raw);
    return raw;
  }
  function prepareImport(current, incoming, choice) {
    if (choice !== "merge" && choice !== "replace")
      throw new Error("Review this backup and choose Merge or Replace first.");
    const existing = parseLibrary(serializeLibrary(current)).briefs;
    const additions = parseLibrary(serializeLibrary(incoming)).briefs;
    if (choice === "replace") return { version: 1, briefs: additions };
    if (existing.length + additions.length > MAX_BRIEFS)
      throw new Error(
        "Merge would exceed the 12-brief limit. Choose Replace or Cancel; nothing has changed.",
      );
    if (
      additions.some((item) =>
        existing.some(
          (saved) =>
            saved.id === item.id || nameKey(saved.name) === nameKey(item.name),
        ),
      )
    )
      throw new Error(
        "A saved brief already has the same name or identity. Merge cannot replace it. Choose Replace or Cancel; nothing has changed.",
      );
    return { version: 1, briefs: [...existing, ...additions] };
  }
  function prepareLoad(current, item, choice) {
    if (
      !validBrief(item) ||
      !current ||
      typeof current.text !== "string" ||
      !runtimes.has(current.runtime)
    )
      throw new Error("Invalid brief or draft. Your open draft is unchanged.");
    if (current.text.length && choice !== "append" && choice !== "replace")
      throw new Error(
        "Review the current draft and choose Append or Replace first.",
      );
    if (choice && choice !== "append" && choice !== "replace")
      throw new Error("Invalid load choice.");
    const next =
      choice === "append"
        ? {
            text: current.text ? current.text + "\n\n" + item.text : item.text,
            runtime: current.runtime,
          }
        : { text: item.text, runtime: item.runtime };
    if (textLength(next.text) > MAX_TEXT)
      throw new Error(
        "There is not enough space to append this brief. The draft limit is 8,192 characters; your draft is unchanged.",
      );
    return next;
  }
  function createStore({
    storage,
    key,
    idFactory = () =>
      "brief-" +
      (root.crypto?.randomUUID?.() ||
        Date.now().toString(36) + Math.random().toString(36).slice(2)),
  }) {
    let briefs = [],
      revision,
      revisionId = 0,
      available = false,
      error = "";
    const state = () => ({ available, briefs: copy(briefs), error });
    function read() {
      try {
        const raw = storage.getItem(key),
          next = parseLibrary(raw);
        briefs = next.briefs;
        if (revision !== raw) revisionId++;
        revision = raw;
        available = true;
        error = "";
      } catch (failure) {
        available = false;
        error = failure.message?.startsWith("Saved brief data is invalid")
          ? failure.message
          : "Browser storage is unavailable. Saved briefs cannot be read or changed; your open draft is unchanged.";
      }
      return state();
    }
    const fail = (message) => {
      error = message;
      return { ok: false, error };
    };
    function checkFresh() {
      if (!available)
        return fail(
          error || "Saved briefs are unavailable. Retry reading storage first.",
        );
      let raw;
      try {
        raw = storage.getItem(key);
      } catch {
        read();
        return fail(error);
      }
      if (raw !== revision) {
        read();
        return fail(
          available
            ? "Saved briefs changed in another tab. Review the library and retry."
            : error,
        );
      }
      return { ok: true };
    }
    function change(edit) {
      if (!checkFresh().ok) return { ok: false, error };
      let next, raw;
      try {
        next = edit(copy(briefs));
        raw = JSON.stringify({ version: 1, briefs: next });
        parseLibrary(raw);
      } catch (failure) {
        return fail(failure.message || "Invalid brief. Nothing was changed.");
      }
      try {
        storage.setItem(key, raw);
      } catch {
        return fail(
          "Changes were not saved. The previous library is still stored and your open draft is unchanged. Retry when browser storage is available.",
        );
      }
      briefs = next;
      revision = raw;
      revisionId++;
      error = "";
      return { ok: true };
    }
    function uniqueName(items, value, except) {
      const name = typeof value === "string" ? value.trim() : "";
      if (!validName(name))
        throw new Error("Enter a brief name of 1–48 characters on one line.");
      if (
        items.some(
          (item) => item.id !== except && nameKey(item.name) === nameKey(name),
        )
      )
        throw new Error(
          "That brief name is already used. Choose another name; nothing was replaced.",
        );
      return name;
    }
    return {
      state,
      read,
      checkFresh,
      revisionToken: () => revisionId,
      importLibrary(raw, choice) {
        return change((items) => {
          if (typeof raw !== "string")
            throw new Error(
              "Backup data is invalid. Your saved library is unchanged.",
            );
          return prepareImport(items, parseLibrary(raw).briefs, choice).briefs;
        });
      },
      add(item) {
        return change((items) => {
          if (items.length >= MAX_BRIEFS)
            throw new Error(
              "The library holds 12 briefs. Delete one before saving another.",
            );
          const next = {
            id: idFactory(),
            name: uniqueName(items, item?.name),
            runtime: item?.runtime,
            text: item?.text,
          };
          if (!validBrief(next))
            throw new Error(
              "Choose a supported destination and enter a draft of 1–8,192 characters.",
            );
          return [...items, next];
        });
      },
      rename(id, name) {
        return change((items) => {
          const item = items.find((entry) => entry.id === id);
          if (!item)
            throw new Error(
              "This brief is no longer in the library. Review the list.",
            );
          item.name = uniqueName(items, name, id);
          return items;
        });
      },
      remove(id) {
        return change((items) => {
          if (!items.some((item) => item.id === id))
            throw new Error(
              "This brief is no longer in the library. Review the list.",
            );
          return items.filter((item) => item.id !== id);
        });
      },
    };
  }
  function install(options = {}) {
    const doc = options.document || root.document;
    if (!doc || doc.getElementById("prompt-library")) return null;
    const draft = doc.getElementById("task-draft"),
      text = doc.getElementById("task-draft-text"),
      runtime = doc.getElementById("task-draft-runtime");
    if (!draft || !text || !runtime) return null;
    let storage;
    try {
      storage = options.storage || root.localStorage;
    } catch {
      /* Read failure is displayed by the store. */
    }
    const key = storageKey(doc.body.dataset.agentOfficePreview === "1"),
      store = createStore({ storage, key });
    const coordinated = typeof root.navigator?.locks?.request === "function";
    const coordinationMessage =
      "Saving briefs is unavailable in this browser. You can still read saved briefs and use your draft.";
    const element = doc.createElement("section");
    element.id = "prompt-library";
    element.className = "prompt-library";
    element.setAttribute("aria-labelledby", "prompt-library-heading");
    // All authored names and text below are assigned through textContent/value.
    element.innerHTML =
      '<h4 id="prompt-library-heading">Saved briefs</h4><p class="prompt-library-help">Save up to 12 reusable briefs in this browser. Loading a brief only changes your draft.</p><p id="prompt-library-coordination" class="prompt-library-help" hidden></p><form class="prompt-library-save-form"><label for="prompt-library-name">Brief name</label><div class="prompt-library-controls"><input id="prompt-library-name" class="txt" type="text" maxlength="48" autocomplete="off" placeholder="e.g. Review a change"><button id="prompt-library-save" class="btn" type="submit">Save current draft</button></div></form><label for="prompt-library-search">Find a saved brief</label><input id="prompt-library-search" class="txt" type="search" maxlength="160" autocomplete="off" placeholder="Search name, destination or text"><p id="prompt-library-count" class="prompt-library-help"></p><ul class="prompt-library-list"></ul><div id="prompt-library-review" class="prompt-library-review" hidden></div><p id="prompt-library-status" role="status" aria-live="polite"></p><button id="prompt-library-retry" class="btn" type="button" hidden>Retry reading saved briefs</button>';
    draft.append(element);
    const backups = doc.createElement("div");
    backups.className = "prompt-library-controls prompt-library-backups";
    backups.innerHTML =
      '<button id="prompt-library-export" class="btn" type="button">Export briefs</button><button id="prompt-library-import" class="btn" type="button">Import briefs</button><input id="prompt-library-file" type="file" accept=".json,application/json" aria-label="Choose a saved brief backup" hidden>';
    element.querySelector(".prompt-library-save-form").before(backups);
    const find = (id) => element.querySelector("#prompt-library-" + id),
      name = find("name"),
      search = find("search"),
      list = element.querySelector(".prompt-library-list"),
      review = find("review"),
      status = find("status"),
      save = find("save"),
      retry = find("retry"),
      exportButton = find("export"),
      importButton = find("import"),
      fileInput = find("file"),
      rows = new Map();
    find("coordination").hidden = coordinated;
    find("coordination").textContent = coordinated ? "" : coordinationMessage;
    let pending = null,
      busy = false,
      storageGeneration = 0,
      reviewGeneration = 0,
      destroyed = false;
    const savingMessage =
      "Saving changes to your briefs. Wait for the result before choosing another action.";
    const current = () => ({ text: text.value, runtime: runtime.value });
    const announce = (message) => {
      status.textContent = message || store.state().error;
    };
    const visible = (control) =>
      control?.isConnected &&
      !control.disabled &&
      control.getClientRects().length &&
      !control.closest("[hidden], [inert]");
    const activeWorkspace = () => visible(text);
    const captureFocus = () => ({
      control: doc.activeElement,
      owned: element.contains(doc.activeElement),
      origin: pending?.origin,
    });
    function focusWithin(...controls) {
      if (activeWorkspace())
        controls.find(visible)?.focus({ preventScroll: false });
    }
    function recoverFocus(before) {
      if (
        before.owned &&
        (doc.activeElement === doc.body || !visible(doc.activeElement))
      )
        focusWithin(before.origin, before.control, search, retry, name);
    }
    function button(label, action) {
      const control = doc.createElement("button");
      control.type = "button";
      control.className = "btn";
      control.textContent = label;
      control.addEventListener("click", (event) => {
        if (busy) {
          announce(savingMessage);
          return;
        }
        action(event);
      });
      return control;
    }
    function cancelReview(focus = false) {
      reviewGeneration++;
      const origin = pending?.origin;
      const restore =
        focus &&
        (review.contains(doc.activeElement) ||
          doc.activeElement === origin ||
          doc.activeElement === doc.body);
      pending = null;
      review.hidden = true;
      review.replaceChildren();
      if (restore) focusWithin(origin, search, retry, name);
    }
    function render() {
      const state = store.state(),
        shown = searchBriefs(state.briefs, search.value),
        visible = new Set(shown.map((item) => item.id));
      find("count").textContent =
        state.briefs.length +
        " / 12 saved" +
        (search.value ? " · " + shown.length + " found" : "");
      element.setAttribute("aria-busy", String(busy));
      save.disabled = !state.available || !coordinated;
      save.setAttribute("aria-disabled", String(save.disabled || busy));
      retry.hidden = state.available;
      for (const control of [exportButton, importButton]) {
        control.disabled = !state.available;
        control.setAttribute("aria-disabled", String(control.disabled || busy));
      }
      for (const [id, row] of rows)
        if (!state.briefs.some((item) => item.id === id)) {
          row.remove();
          rows.delete(id);
        }
      for (const item of state.briefs) {
        let row = rows.get(item.id);
        if (!row) {
          row = doc.createElement("li");
          row.className = "prompt-library-item";
          const heading = doc.createElement("strong"),
            detail = doc.createElement("span"),
            controls = doc.createElement("div");
          heading.className = "prompt-library-name";
          detail.className = "prompt-library-detail";
          controls.className = "prompt-library-controls";
          for (const action of ["Load", "Rename", "Delete"])
            controls.append(
              button(action, (event) =>
                begin(action.toLowerCase(), item.id, event.currentTarget),
              ),
            );
          row.append(heading, detail, controls);
          rows.set(item.id, row);
          list.append(row);
        }
        row.querySelector("strong").textContent = item.name;
        row.querySelector(".prompt-library-detail").textContent =
          runtimeLabel(item.runtime) +
          " · " +
          textLength(item.text).toLocaleString() +
          " characters";
        row.hidden = !visible.has(item.id);
        for (const control of row.querySelectorAll("button")) {
          control.disabled =
            !state.available ||
            (!coordinated && control.textContent !== "Load");
          control.setAttribute(
            "aria-disabled",
            String(control.disabled || busy),
          );
        }
      }
      for (const control of review.querySelectorAll("button, input")) {
        control.setAttribute("aria-disabled", String(busy || control.disabled));
        if (control.tagName === "INPUT") control.readOnly = busy;
      }
      list.hidden = !state.briefs.length;
    }
    function runtimeLabel(value) {
      return (
        Array.from(runtime.options).find((option) => option.value === value)
          ?.textContent || value
      );
    }
    async function mutate(action, success) {
      if (busy) {
        announce(savingMessage);
        return;
      }
      if (!coordinated) {
        announce(coordinationMessage);
        return;
      }
      const beforeFocus = captureFocus();
      // A later save supersedes an unfinished file read. Its completion must
      // not replace the pending save's review or progress message.
      if (pending?.action === "reading") cancelReview();
      const generation = storageGeneration;
      busy = true;
      render();
      announce(savingMessage);
      try {
        // Cooperating tabs serialize writes; the action also rechecks the exact
        // stored revision after obtaining the lock.
        const result = await root.navigator.locks.request(key, () =>
          !destroyed && generation === storageGeneration
            ? action()
            : {
                ok: false,
                error:
                  store.state().error ||
                  "Saved briefs changed in another tab while this save was waiting. Review the library and retry.",
              },
        );
        if (result.ok) {
          busy = false;
          render();
          success();
        } else announce(result.error);
      } catch {
        announce(
          "Changes could not be saved. Your library and open draft are unchanged. Retry when browser storage is available.",
        );
      } finally {
        busy = false;
        render();
        // An actual read failure can disable the focused action. Recover only
        // that lost focus, without stealing focus from intervening user edits.
        recoverFocus(beforeFocus);
      }
    }
    function apply(item, choice) {
      if (busy) return;
      const beforeFocus = captureFocus();
      if (!store.checkFresh().ok) {
        cancelReview();
        render();
        recoverFocus(beforeFocus);
        announce();
        return;
      }
      const now = current();
      if (
        pending &&
        (pending.current.text !== now.text ||
          pending.current.runtime !== now.runtime)
      ) {
        pending.current = now;
        updateLoadSummary();
        announce(
          "Your draft changed while review was open. Review the updated draft and choose again; nothing was overwritten.",
        );
        return;
      }
      try {
        const next = prepareLoad(now, item, choice);
        text.value = next.text;
        runtime.value = next.runtime;
        text.dispatchEvent(new root.Event("input", { bubbles: true }));
        runtime.dispatchEvent(new root.Event("change", { bubbles: true }));
        cancelReview();
        text.focus();
        announce(
          choice === "append"
            ? "Brief appended. The current destination was kept. Review your draft before copying or running it."
            : "Brief loaded into the draft. Review it before copying or running it.",
        );
      } catch (failure) {
        announce(failure.message);
      }
    }
    function updateLoadSummary() {
      const summary = find("load-summary");
      if (summary)
        summary.textContent =
          "Current draft: " +
          textLength(text.value).toLocaleString() +
          " characters for " +
          runtimeLabel(runtime.value) +
          ". Replace uses the saved destination; Append keeps your current destination.";
    }
    function begin(action, id, origin) {
      if (busy) return;
      const beforeFocus = captureFocus();
      if (!store.checkFresh().ok) {
        cancelReview();
        render();
        recoverFocus(beforeFocus);
        announce();
        return;
      }
      const item = store.state().briefs.find((entry) => entry.id === id);
      if (!item) return;
      cancelReview();
      if (action === "load" && !text.value.length) {
        apply(item, "replace");
        return;
      }
      pending = { action, id, origin, current: current() };
      const heading = doc.createElement("h5");
      heading.textContent =
        action === "load"
          ? "Load “" + item.name + "”?"
          : action === "rename"
            ? "Rename “" + item.name + "”"
            : "Delete “" + item.name + "”?";
      review.append(heading);
      if (action === "load") {
        const summary = doc.createElement("p"),
          destination = doc.createElement("p"),
          preview = doc.createElement("pre"),
          controls = doc.createElement("div");
        summary.id = "prompt-library-load-summary";
        destination.textContent =
          "Saved destination: " +
          runtimeLabel(item.runtime) +
          " · " +
          textLength(item.text).toLocaleString() +
          " characters";
        preview.id = "prompt-library-preview";
        preview.textContent = item.text;
        preview.tabIndex = 0;
        preview.setAttribute("aria-label", "Saved brief text");
        controls.className = "prompt-library-controls";
        controls.append(
          button("Replace draft", () => apply(item, "replace")),
          button("Append to draft", () => apply(item, "append")),
          button("Cancel", () => cancelReview(true)),
        );
        review.append(summary, destination, preview, controls);
        updateLoadSummary();
      } else if (action === "rename") {
        const form = doc.createElement("form"),
          label = doc.createElement("label"),
          input = doc.createElement("input"),
          controls = doc.createElement("div"),
          submit = doc.createElement("button");
        label.textContent = "New brief name";
        label.htmlFor = input.id = "prompt-library-rename";
        input.className = "txt";
        input.value = item.name;
        input.maxLength = MAX_NAME;
        submit.type = "submit";
        submit.className = "btn";
        submit.textContent = "Save name";
        controls.className = "prompt-library-controls";
        controls.append(
          submit,
          button("Cancel", () => cancelReview(true)),
        );
        form.append(label, input, controls);
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          const next = input.value;
          mutate(
            () => store.rename(id, next),
            () => {
              cancelReview(true);
              announce(
                "Brief renamed. Its text and destination are unchanged.",
              );
            },
          );
        });
        review.append(form);
      } else {
        const explanation = doc.createElement("p"),
          controls = doc.createElement("div");
        explanation.textContent =
          "This removes only the saved brief in this browser. Your current draft stays open.";
        controls.className = "prompt-library-controls";
        controls.append(
          button("Delete brief", () =>
            mutate(
              () => store.remove(id),
              () => {
                cancelReview(true);
                announce(
                  "Saved brief deleted. Your current draft is unchanged.",
                );
              },
            ),
          ),
          button("Cancel", () => cancelReview(true)),
        );
        review.append(explanation, controls);
      }
      review.hidden = false;
      announce(
        "Review the saved brief action below. Your open draft is unchanged.",
      );
      (action === "rename"
        ? find("rename")
        : review.querySelector("button")
      ).focus();
    }
    function importFresh(stage) {
      if (
        destroyed ||
        pending !== stage ||
        stage.ticket !== reviewGeneration ||
        !activeWorkspace()
      )
        return {
          ok: false,
          error:
            "This import review was closed or changed. Choose the backup again before importing.",
        };
      if (!store.checkFresh().ok)
        return { ok: false, error: store.state().error };
      if (
        stage.revision !== store.revisionToken() ||
        stage.generation !== storageGeneration
      )
        return {
          ok: false,
          error:
            "Saved briefs changed after this backup was selected. Choose the backup again and review the current library.",
        };
      return { ok: true };
    }
    function showImport(stage, incoming) {
      const restore =
        review.contains(doc.activeElement) ||
        doc.activeElement === importButton;
      stage.action = "import";
      stage.raw = serializeLibrary(incoming);
      stage.incoming = incoming;
      review.replaceChildren();
      const heading = doc.createElement("h5"),
        summary = doc.createElement("p"),
        mergeSummary = doc.createElement("p"),
        replaceSummary = doc.createElement("p"),
        entries = doc.createElement("div"),
        controls = doc.createElement("div");
      heading.textContent = "Import saved briefs?";
      summary.id = "prompt-library-import-summary";
      summary.textContent =
        incoming.length +
        (incoming.length === 1 ? " incoming brief · " : " incoming briefs · ") +
        store.state().briefs.length +
        " saved now. Your open draft will stay unchanged.";
      mergeSummary.id = "prompt-library-merge-summary";
      replaceSummary.id = "prompt-library-replace-summary";
      replaceSummary.textContent =
        "Replace removes " +
        store.state().briefs.length +
        " saved briefs and saves " +
        incoming.length +
        " from this backup.";
      entries.className = "prompt-library-import-entries";
      for (const item of incoming) {
        const detail = doc.createElement("details"),
          label = doc.createElement("summary"),
          preview = doc.createElement("pre");
        label.textContent =
          item.name +
          " · " +
          runtimeLabel(item.runtime) +
          " · " +
          textLength(item.text).toLocaleString() +
          " characters";
        preview.textContent = item.text;
        preview.tabIndex = 0;
        preview.setAttribute("aria-label", item.name + " saved text");
        detail.append(label, preview);
        entries.append(detail);
      }
      const commit = (choice) =>
        mutate(
          () => {
            const fresh = importFresh(stage);
            return fresh.ok ? store.importLibrary(stage.raw, choice) : fresh;
          },
          () => {
            if (pending === stage) {
              cancelReview(true);
              announce(
                (choice === "merge" ? "Merged " : "Imported ") +
                  incoming.length +
                  (incoming.length === 1 ? " brief." : " briefs.") +
                  " Your open draft and destination are unchanged.",
              );
            }
          },
        );
      const merge = button("Merge briefs", () => commit("merge")),
        replace = button("Replace saved library", () => commit("replace"));
      try {
        const result = prepareImport(store.state().briefs, incoming, "merge");
        mergeSummary.textContent =
          "Merge adds " +
          incoming.length +
          (incoming.length === 1 ? " brief and keeps " : " briefs and keeps ") +
          store.state().briefs.length +
          (store.state().briefs.length === 1
            ? " saved brief ("
            : " saved briefs (") +
          result.briefs.length +
          " total).";
      } catch (failure) {
        mergeSummary.textContent = failure.message;
        merge.disabled = true;
      }
      merge.disabled ||= !coordinated;
      replace.disabled = !coordinated;
      controls.className = "prompt-library-controls";
      controls.append(
        merge,
        replace,
        button("Cancel", () => {
          cancelReview(true);
          announce(
            "Import cancelled. Your saved library and draft are unchanged.",
          );
        }),
      );
      review.append(
        heading,
        summary,
        entries,
        mergeSummary,
        replaceSummary,
        controls,
      );
      render();
      announce(
        "Backup ready to review. Expand a brief to read its text, then choose Merge, Replace or Cancel.",
      );
      if (restore) focusWithin(merge, replace, controls.lastChild);
    }
    async function readBackup(file) {
      if (busy) {
        announce(savingMessage);
        return;
      }
      const beforeFocus = captureFocus();
      if (!store.checkFresh().ok) {
        cancelReview();
        render();
        recoverFocus(beforeFocus);
        announce();
        return;
      }
      cancelReview();
      const stage = {
        action: "reading",
        origin: importButton,
        ticket: reviewGeneration,
        revision: store.revisionToken(),
        generation: storageGeneration,
      };
      pending = stage;
      const heading = doc.createElement("h5"),
        message = doc.createElement("p");
      heading.textContent = "Reading brief backup";
      message.textContent =
        "Preparing a review. Your saved library and draft are unchanged.";
      const cancel = button("Cancel", () => {
        cancelReview(true);
        announce(
          "Import cancelled. Your saved library and draft are unchanged.",
        );
      });
      review.append(heading, message, cancel);
      review.hidden = false;
      announce("Reading the selected backup. No saved briefs have changed.");
      if (beforeFocus.owned || doc.activeElement === doc.body)
        focusWithin(cancel);
      try {
        if (file.size > MAX_BYTES) throw new Error("size");
        const data = await file.arrayBuffer();
        if (
          pending !== stage ||
          stage.ticket !== reviewGeneration ||
          !activeWorkspace()
        )
          return;
        if (data.byteLength > MAX_BYTES) throw new Error("size");
        let incoming;
        try {
          incoming = parseLibrary(
            new TextDecoder("utf-8", { fatal: true }).decode(data),
          ).briefs;
        } catch {
          throw new Error("invalid");
        }
        const fresh = importFresh(stage);
        if (!fresh.ok) {
          heading.textContent = "Backup review changed";
          message.textContent = fresh.error;
          announce(fresh.error);
          return;
        }
        showImport(stage, incoming);
      } catch (failure) {
        if (
          pending !== stage ||
          stage.ticket !== reviewGeneration ||
          !activeWorkspace()
        )
          return;
        const error =
          failure.message === "size"
            ? "The backup is too large. Choose a brief backup no larger than 1 MB. Your saved library and draft are unchanged."
            : failure.message === "invalid"
              ? "This backup is invalid. Choose an Agent Office brief backup; your saved library and draft are unchanged."
              : "Could not read this backup. Your saved library and draft are unchanged.";
        heading.textContent = "Backup could not be reviewed";
        message.textContent = error;
        announce(error);
      }
    }
    importButton.addEventListener("click", () => {
      if (busy) {
        announce(savingMessage);
        return;
      }
      fileInput.click();
    });
    fileInput.addEventListener("change", () => {
      const file = fileInput.files[0];
      fileInput.value = "";
      if (file) void readBackup(file);
    });
    exportButton.addEventListener("click", () => {
      if (busy) {
        announce(savingMessage);
        return;
      }
      const beforeFocus = captureFocus();
      if (!store.checkFresh().ok) {
        cancelReview();
        render();
        recoverFocus(beforeFocus);
        announce();
        return;
      }
      try {
        const url = root.URL.createObjectURL(
          new root.Blob([serializeLibrary(store.state().briefs)], {
            type: "application/json;charset=utf-8",
          }),
        );
        const link = doc.createElement("a");
        link.href = url;
        link.download = "agent-office-briefs.json";
        link.click();
        root.setTimeout(() => root.URL.revokeObjectURL(url), 1000);
        announce(
          "Saved brief backup exported. Your saved library and draft are unchanged.",
        );
      } catch {
        announce(
          "The backup could not be exported. Your saved library and draft are unchanged.",
        );
      }
    });
    element
      .querySelector(".prompt-library-save-form")
      .addEventListener("submit", (event) => {
        event.preventDefault();
        const snapshot = { name: name.value, ...current() };
        mutate(
          () => store.add(snapshot),
          () => {
            cancelReview();
            announce(
              "Saved “" +
                snapshot.name.trim() +
                "” in this browser. Your current draft is unchanged.",
            );
          },
        );
      });
    search.addEventListener("input", render);
    retry.addEventListener("click", () => {
      const beforeFocus = captureFocus();
      store.read();
      cancelReview();
      render();
      recoverFocus(beforeFocus);
      announce(
        store.state().available
          ? "Saved briefs are available. Review the library before continuing."
          : "",
      );
    });
    review.addEventListener("keydown", (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        event.preventDefault();
        if (busy) {
          announce(savingMessage);
          return;
        }
        cancelReview(true);
        announce("Action cancelled. Your draft is unchanged.");
      }
    });
    function onStorage(event) {
      if (
        (event.key === key || event.key === null) &&
        event.storageArea === storage
      ) {
        const beforeFocus = captureFocus();
        storageGeneration++;
        store.read();
        cancelReview();
        render();
        recoverFocus(beforeFocus);
        announce(
          store.state().available
            ? "Saved briefs changed in another tab. Review the updated library; your current draft is unchanged."
            : "",
        );
      }
    }
    root.addEventListener("storage", onStorage);
    const visibility = new root.MutationObserver((records) => {
      if (
        !records.some(
          (record) => record.oldValue !== record.target.getAttribute("hidden"),
        )
      )
        return;
      reviewGeneration++;
      if (pending?.action === "reading" || pending?.action === "import") {
        const beforeFocus = captureFocus();
        cancelReview();
        render();
        recoverFocus(beforeFocus);
      }
    });
    for (const target of [draft, draft.closest(".sheet")])
      if (target)
        visibility.observe(target, {
          attributes: true,
          attributeFilter: ["hidden"],
          attributeOldValue: true,
        });
    store.read();
    render();
    announce();
    return {
      element,
      refresh: () => {
        const beforeFocus = captureFocus();
        store.read();
        cancelReview();
        render();
        recoverFocus(beforeFocus);
        announce();
      },
      destroy: () => {
        destroyed = true;
        reviewGeneration++;
        visibility.disconnect();
        root.removeEventListener("storage", onStorage);
        element.remove();
      },
    };
  }
  const api = {
    MAX_BRIEFS,
    MAX_TEXT,
    MAX_BYTES,
    storageKey,
    parseLibrary,
    serializeLibrary,
    prepareImport,
    searchBriefs,
    prepareLoad,
    createStore,
    install,
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  root.OfficePromptLibrary = api;
  if (typeof document !== "undefined") {
    if (document.readyState === "loading")
      document.addEventListener("DOMContentLoaded", () => install(), {
        once: true,
      });
    else install();
  }
})(typeof window === "undefined" ? globalThis : window);
