/* User-authored task drafts. Never sends prompts or writes observer state. */
"use strict";
(() => {
  const byId = (id) => document.getElementById(id);
  const text = byId("task-draft-text");
  const runtime = byId("task-draft-runtime");
  const remember = byId("task-draft-remember");
  const status = byId("task-draft-status");
  const copy = byId("task-draft-copy");
  const exportButton = byId("task-draft-export");
  const template = byId("task-draft-template");
  const maxText = 8192;
  const textLength = (value) => Array.from(value).length;
  const validDraft = () =>
    !!text.value.trim() && textLength(text.value) <= maxText;
  // Native maxlength counts UTF-16 units and can cut valid emoji prompts short.
  // Match Local runs instead, leaving oversized edits visible for correction.
  text.removeAttribute("maxlength");
  const key =
    "agent-office:task-draft:v1:" +
    (document.body.dataset.agentOfficePreview === "1" ? "preview" : "observer");
  const destinations = new Set(
    [...runtime.options].map((option) => option.value),
  );
  const outline =
    "Goal\nDescribe the change and who it helps.\n\nConstraints\nKeep existing permissions and preserve unrelated work.\n\nVerification\nReproduce the problem, add a regression test, run relevant tests, and report what remains unverified.";
  let retained = false;
  let wantsRetention = false;
  let storageWarning = "";
  let copyVersion = 0;

  function announce(message = "") {
    status.textContent = [
      message,
      textLength(text.value) > maxText
        ? "Draft exceeds the 8,192-character limit. Shorten it before copying, exporting or saving."
        : "",
      storageWarning,
    ]
      .filter(Boolean)
      .join(" ");
  }

  function save() {
    if (wantsRetention && textLength(text.value) > maxText) {
      storageWarning = retained
        ? "The previously saved draft is unchanged."
        : "Your open text has not been saved.";
      wantsRetention = retained;
      remember.checked = retained;
      return false;
    }
    try {
      if (wantsRetention)
        sessionStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            runtime: runtime.value,
            text: text.value,
          }),
        );
      else sessionStorage.removeItem(key);
      retained = wantsRetention;
      remember.checked = retained;
      storageWarning = "";
      return true;
    } catch {
      if (wantsRetention) {
        storageWarning = retained
          ? "Changes were not saved. The previous draft is still stored in this tab."
          : "Could not remember this draft. Your open text is unchanged.";
        wantsRetention = retained;
      } else {
        // Keep a failed opt-out pending: later edits must not save new text.
        storageWarning = retained
          ? "Could not remove the saved draft. It is still stored. Turn off Remember to retry."
          : "Draft removal could not be confirmed. Your open text is unchanged.";
      }
      remember.checked = retained;
      return false;
    }
  }
  function update() {
    const empty = !text.value.trim(),
      length = textLength(text.value),
      tooLong = length > maxText;
    copy.disabled = exportButton.disabled = empty || tooLong;
    text.setCustomValidity(
      tooLong ? "The draft limit is 8,192 characters." : "",
    );
    text.setAttribute("aria-invalid", String(tooLong));
    const name = runtime.selectedOptions[0].textContent;
    copy.textContent = "Copy for " + name;
    byId("task-draft-destination").textContent =
      "Paste into " +
      name +
      " and review the project, session and permissions there. Choosing a destination does not install or connect it.";
    byId("task-draft-count").textContent =
      length.toLocaleString() + " / 8,192 characters";
    window.dispatchEvent(
      new CustomEvent("agent-office:task-draft-change", {
        detail: { hasText: !empty, length },
      }),
    );
  }
  try {
    const draft = JSON.parse(sessionStorage.getItem(key));
    if (
      draft?.version === 1 &&
      destinations.has(draft.runtime) &&
      typeof draft.text === "string" &&
      textLength(draft.text) <= maxText
    ) {
      text.value = draft.text;
      runtime.value = draft.runtime;
      retained = wantsRetention = true;
      remember.checked = true;
    }
  } catch {
    /* A damaged/unavailable tab draft never blocks the dashboard. */
  }
  text.addEventListener("input", () => {
    copyVersion++;
    update();
    save();
    announce();
  });
  runtime.addEventListener("change", () => {
    copyVersion++;
    update();
    save();
    announce();
  });
  remember.addEventListener("change", () => {
    copyVersion++;
    wantsRetention = remember.checked;
    announce(
      save()
        ? retained
          ? "Draft kept in this browser tab, not in office history."
          : "Stored draft removed. The open draft is unchanged."
        : "",
    );
  });
  template.addEventListener("click", () => {
    const next = text.value ? text.value + "\n\n" + outline : outline;
    if (textLength(next) > maxText) {
      announce(
        "There is not enough space to append the template. Your draft is unchanged.",
      );
      return;
    }
    text.value = next;
    copyVersion++;
    update();
    save();
    text.focus();
    announce(
      "Template appended. Replace its guidance with your requirements before copying.",
    );
  });
  copy.addEventListener("click", async () => {
    if (!validDraft()) {
      update();
      announce();
      return;
    }
    const draft = text.value,
      destination = runtime.value,
      name = runtime.selectedOptions[0].textContent,
      version = ++copyVersion,
      panelCurrent = capturePanelInteraction(),
      current = () => panelCurrent() && version === copyVersion;
    try {
      await navigator.clipboard.writeText(draft);
      if (!current()) return;
      announce(
        text.value === draft
          ? "Copied for " + name + ". Nothing has been sent or executed."
          : "Copied the earlier draft. Your newer changes have not been copied.",
      );
    } catch {
      if (!current()) return;
      if (text.value !== draft || runtime.value !== destination) {
        announce("The draft changed. Copy the current draft again.");
        return;
      }
      const select = canSelectCopyFallback(copy);
      announce(
        select
          ? "Clipboard access could not be used. Copy the selected draft manually; nothing was sent."
          : "Clipboard access could not be used. Copy the draft manually; nothing was sent.",
      );
      if (select) {
        text.focus();
        text.select();
      }
    }
  });
  exportButton.addEventListener("click", () => {
    if (!validDraft()) {
      update();
      announce();
      return;
    }
    copyVersion++;
    const url = URL.createObjectURL(
      new Blob([text.value], { type: "text/plain;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "agent-office-task.txt";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce("Draft exported. No runtime action was requested.");
  });
  update();
})();
