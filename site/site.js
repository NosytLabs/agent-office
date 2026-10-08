/* Progressive enhancement; no tracking, network requests, or browser storage. */
"use strict";

for (const group of document.querySelectorAll("[data-tab-group]")) {
  const list = group.querySelector("[data-tab-list]");
  const tabs = [...group.querySelectorAll("[data-tab-button]")];
  const panels = tabs.map((tab) =>
    document.getElementById(tab.dataset.tabButton),
  );
  if (!list || !tabs.length || panels.some((panel) => !panel)) continue;
  list.setAttribute("role", "tablist");
  tabs.forEach((tab, index) => {
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", panels[index].id);
    panels[index].setAttribute("role", "tabpanel");
    panels[index].setAttribute("aria-labelledby", tab.id);
    panels[index].tabIndex = 0;
  });
  function activate(index) {
    tabs.forEach((tab, i) => {
      tab.setAttribute("aria-selected", String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      panels[i].hidden = i !== index;
    });
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activate(index));
    // Manual activation: arrows move focus; Enter/Space use native button click.
    // Image loading therefore never forces a selection while reading tab labels.
    tab.addEventListener("keydown", (event) => {
      const target =
        event.key === "ArrowRight"
          ? (index + 1) % tabs.length
          : event.key === "ArrowLeft"
            ? (index + tabs.length - 1) % tabs.length
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? tabs.length - 1
                : null;
      if (target === null) return;
      event.preventDefault();
      tabs[target].focus({ preventScroll: true });
    });
  });
  activate(0);
}

const menu = document.querySelector(".menu-toggle");
const nav = document.getElementById("site-nav");
if (menu && nav) {
  let focusedNavigation = null;
  function closeMenu(restoreFocus = false) {
    nav.classList.remove("open");
    menu.setAttribute("aria-expanded", "false");
    if (restoreFocus) menu.focus({ preventScroll: true });
  }
  menu.addEventListener("click", () => {
    const open = menu.getAttribute("aria-expanded") !== "true";
    menu.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("open", open);
  });
  nav.addEventListener("click", (event) => {
    const link = event.target.closest("a");
    if (!link) return;
    const wasOpen = menu.getAttribute("aria-expanded") === "true";
    closeMenu();
    // Do not strand keyboard focus on a link that just became hidden.
    const href = link.getAttribute("href");
    if (wasOpen && href?.startsWith("#")) {
      const section = document.getElementById(href.slice(1));
      if (section) {
        section.tabIndex = -1;
        section.focus({ preventScroll: true });
      }
    }
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      menu.getAttribute("aria-expanded") === "true"
    ) {
      closeMenu(true);
    }
  });
  document.addEventListener("focusin", (event) => {
    const withinNavigation =
      menu.contains(event.target) || nav.contains(event.target);
    focusedNavigation = withinNavigation ? event.target : null;
    if (menu.getAttribute("aria-expanded") === "true" && !withinNavigation) {
      closeMenu();
    }
  });
  document.addEventListener("focusout", (event) => {
    // A responsive display:none can blur a control before the media event.
    // Keep that target only until it can move to its visible counterpart.
    if (
      focusedNavigation === event.target &&
      event.target.getClientRects().length
    ) {
      focusedNavigation = null;
    }
  });
  window
    .matchMedia("(min-width: 651px)")
    .addEventListener("change", (event) => {
      // Keep focus reachable when either side of the disclosure becomes hidden.
      const focused = focusedNavigation || document.activeElement;
      const focusDesktopLink = event.matches && menu.contains(focused);
      const restoreFocus = !event.matches && nav.contains(focused);
      closeMenu(restoreFocus);
      if (focusDesktopLink)
        nav.querySelector("a[href]")?.focus({ preventScroll: true });
    });
}

const status = document.getElementById("copy-status");
for (const button of document.querySelectorAll("[data-copy-target]")) {
  button.addEventListener("click", async () => {
    const command = document.getElementById(button.dataset.copyTarget);
    if (!command || !status || button.disabled) return;
    button.disabled = true;
    status.textContent = "";
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(command.textContent.trim());
      status.textContent = "Copied. Paste the command when you are ready.";
    } catch {
      const range = document.createRange();
      range.selectNodeContents(command);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      command.focus({ preventScroll: true });
      status.textContent =
        "Clipboard access is unavailable. The command is selected so you can copy it manually.";
    } finally {
      button.disabled = false;
    }
  });
}
document.documentElement.classList.add("js");
