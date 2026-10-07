/* Furniture editing and layout import/export. Uses the shared settings save queue. */
"use strict";
const furnitureHistory = [],
  furnitureFuture = [];
let furnitureSignature = JSON.stringify(settings.furniture),
  furnitureSaving = false;
scene.onFurnitureResolution = ({ relocated, unplaced }) => {
  const status = $("furniture-status");
  status.hidden = !relocated && !unplaced;
  status.textContent = [
    relocated
      ? `${relocated} custom prop${relocated === 1 ? " was" : "s were"} moved to free floor for this view.`
      : "",
    unplaced
      ? `Could not find free floor for ${unplaced} prop${unplaced === 1 ? "" : "s"} in this view. Use Arrange custom furniture, then Space to select and Delete to remove.`
      : "",
    relocated || unplaced ? "Your saved positions are unchanged." : "",
  ]
    .filter(Boolean)
    .join(" ");
};
scene.onFurnitureResolution(
  scene.furnitureResolution || { relocated: 0, unplaced: 0 },
);
for (const kind of Object.keys(PROP_SIZES)) {
  const b = document.createElement("button");
  b.className = "furniture-card";
  b.dataset.kind = kind;
  b.setAttribute("aria-label", PROP_NAMES[kind]);
  const preview = document.createElement("canvas");
  preview.width = 120;
  preview.height = 104;
  preview.setAttribute("aria-hidden", "true");
  const label = document.createElement("span");
  label.textContent = PROP_NAMES[kind];
  b.append(preview, label);
  b.onclick = () => {
    startFurniture(kind);
  };
  $("furniture-tools").append(b);
}
function renderFurniturePreviews() {
  for (const b of $("furniture-tools").children) {
    const sprite = scene.sprites[b.dataset.kind];
    if (!sprite) continue;
    const c = b.querySelector("canvas"),
      g = c.getContext("2d");
    g.clearRect(0, 0, c.width, c.height);
    g.imageSmoothingEnabled = false;
    const scale = Math.min(104 / sprite.width, 88 / sprite.height);
    g.drawImage(
      sprite,
      (120 - sprite.width * scale) / 2,
      (104 - sprite.height * scale) / 2,
      sprite.width * scale,
      sprite.height * scale,
    );
  }
}
$("c").addEventListener("spritesready", renderFurniturePreviews);
renderFurniturePreviews();

function syncFurnitureControls() {
  $("undo-furniture").disabled = furnitureSaving || !furnitureHistory.length;
  $("redo-furniture").disabled = furnitureSaving || !furnitureFuture.length;
  $("delete-furniture").disabled =
    furnitureSaving || scene.movingIndex === null;
  for (const id of [
    "arrange-furniture",
    "edit-furniture",
    "clear-furniture",
    "import-settings",
  ])
    $(id).disabled = furnitureSaving;
  for (const button of $("furniture-tools").children) {
    const reward = PROP_REWARDS[button.dataset.kind],
      locked = reward && !haveUnlock(reward);
    button.disabled = furnitureSaving || !!locked;
    let note = button.querySelector("small");
    if (reward && !note) {
      note = document.createElement("small");
      button.append(note);
    }
    if (note) {
      const badge = progress?.catalog?.find((item) => item.id === reward);
      note.textContent = locked
        ? badge?.hint || "Unlock through recorded activity"
        : "Unlocked";
    }
  }
  $("c").setAttribute("aria-busy", String(furnitureSaving));
  $("arrange-furniture").setAttribute(
    "aria-pressed",
    String(scene.edit === "move"),
  );
}
function startFurniture(kind) {
  if (furnitureSaving) return;
  if (PROP_REWARDS[kind] && !haveUnlock(PROP_REWARDS[kind])) return;
  scene.edit = kind;
  scene.movingIndex = null;
  scene.pointer = null;
  scene.drag = null;
  closeSheets();
  $("edit-hint").hidden = false;
  $("empty-state").hidden = true;
  $("edit-message").textContent =
    kind === "move"
      ? "Select or drag a custom prop. Space on the canvas cycles props."
      : "Place " +
        PROP_NAMES[kind].toLowerCase() +
        ". Arrows move; Enter places. Click a custom prop to remove it.";
  $("scene-hint").textContent =
    "Green outline: free space. Orange: occupied. Escape cancels.";
  syncFurnitureControls();
  $("c").focus();
  scene.draw(0);
}
function pickFurniture(index) {
  if (furnitureSaving || !settings.furniture[index]) return;
  scene.movingIndex = index;
  const b =
    scene.furnitureBounds(index) ||
    propBounds(settings.furniture[index], scene.grid);
  scene.pointer = { x: b.x + b.w / 2, y: b.y + b.h };
  $("edit-message").textContent =
    "Move " +
    PROP_NAMES[settings.furniture[index].kind].toLowerCase() +
    ". Click free floor or use arrows and Enter. Delete removes.";
  syncFurnitureControls();
  scene.draw(0);
}
scene.onPick = pickFurniture;
scene.onRemove = () => {
  if (furnitureSaving || scene.movingIndex === null) return;
  const items = settings.furniture.filter((_, i) => i !== scene.movingIndex);
  resetSelection();
  saveFurniture(items);
};
function resetSelection() {
  scene.movingIndex = null;
  scene.pointer = null;
  scene.drag = null;
  syncFurnitureControls();
}
function saveFurniture(items) {
  return persistFurniture(items);
}
async function persistFurniture(
  items,
  action = "edit",
  patch = { furniture: items },
) {
  if (furnitureSaving) return false;
  const previous = structuredClone(settings.furniture),
    expected = JSON.stringify(items);
  furnitureSaving = true;
  furnitureSignature = expected;
  resetSelection();
  const saved = await saveSettings(patch);
  const actual = JSON.stringify(settings.furniture);
  if (saved && actual === expected) {
    if (action === "undo") {
      furnitureFuture.push(previous);
      furnitureHistory.pop();
    } else if (action === "redo") {
      furnitureHistory.push(previous);
      furnitureFuture.pop();
    } else if (action === "import") {
      furnitureHistory.length = furnitureFuture.length = 0;
    } else {
      furnitureHistory.push(previous);
      if (furnitureHistory.length > 20) furnitureHistory.shift();
      furnitureFuture.length = 0;
    }
  } else if (actual !== JSON.stringify(previous)) {
    // A different tab may have replaced this room while the request was queued.
    // Index-based history is safe only while it still describes this furniture.
    furnitureHistory.length = furnitureFuture.length = 0;
  }
  furnitureSignature = actual;
  furnitureSaving = false;
  syncFurnitureControls();
  return saved;
}
// A layout imported or edited in another tab invalidates index-based selection/history.
function reconcileFurniture() {
  if (furnitureSaving) return;
  const signature = JSON.stringify(settings.furniture);
  if (signature !== furnitureSignature) {
    furnitureSignature = signature;
    furnitureHistory.length = furnitureFuture.length = 0;
    resetSelection();
  }
}
function finishFurniture() {
  scene.edit = null;
  resetSelection();
  $("edit-hint").hidden = true;
  syncEmptyState();
  $("scene-hint").textContent = "Select a desk to inspect its activity.";
  scene.draw(0);
}
$("finish-furniture").onclick = () => {
  finishFurniture();
  $("c").focus();
};
$("arrange-furniture").onclick = $("edit-furniture").onclick = () =>
  startFurniture("move");
$("catalog-furniture").onclick = () => {
  finishFurniture();
  openSheet("sheet-settings");
};
$("delete-furniture").onclick = () => {
  scene.onRemove();
  $("c").focus();
};
$("undo-furniture").onclick = () => {
  if (!furnitureHistory.length || furnitureSaving) return;
  persistFurniture(furnitureHistory.at(-1), "undo");
};
$("redo-furniture").onclick = () => {
  if (!furnitureFuture.length || furnitureSaving) return;
  persistFurniture(furnitureFuture.at(-1), "redo");
};
function placeFurniture(p) {
  if (furnitureSaving) {
    toast("Wait for the current furniture change to save.");
    return;
  }
  const items = settings.furniture || [];
  if (scene.edit === "move" && scene.movingIndex === null) {
    const at = scene.propAt(p);
    if (at >= 0) pickFurniture(at);
    else
      toast(
        "Choose a custom prop to move. Built-in decorations stay in their own area.",
      );
    return;
  }
  const moving = scene.movingIndex;
  if (moving === null) {
    const at = scene.propAt(p);
    if (at >= 0) {
      saveFurniture(items.filter((_, i) => i !== at));
      return;
    }
    if (items.length >= 24) {
      toast("The room has 24 custom props. Remove one first.");
      return;
    }
  }
  const placement = scene.placement(p);
  if (!placement?.valid) {
    toast(
      "Choose free floor space away from desks, other furniture, and walls.",
    );
    return;
  }
  const next =
    moving === null
      ? [...items, placement.item]
      : items.map((item, i) => (i === moving ? placement.item : item));
  resetSelection();
  saveFurniture(next);
  if (scene.edit === "move")
    $("edit-message").textContent =
      "Moved. Select another custom prop, or choose Done.";
}
$("clear-furniture").onclick = () => {
  if (settings.furniture.length) {
    resetSelection();
    saveFurniture([]);
  }
};
$("export-settings").onclick = () =>
  downloadBlob(
    new Blob([JSON.stringify({ version: 1, settings }, null, 2)], {
      type: "application/json",
    }),
    "agent-office-layout.json",
  );
$("import-settings").onchange = async (e) => {
  try {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 65536)
      throw new Error("Layout must be smaller than 64 KB.");
    const data = JSON.parse(await file.text());
    if (
      data.version !== 1 ||
      !data.settings ||
      typeof data.settings !== "object" ||
      Array.isArray(data.settings)
    )
      throw new Error("Choose an Agent Office layout export.");
    const imported = normalizeSettings(data.settings);
    if (Object.keys(imported).length !== Object.keys(data.settings).length)
      throw new Error("This layout contains invalid or unsupported settings.");
    if (imported.layout === "bullpen" && !haveUnlock("layout_bullpen"))
      imported.layout = "open";
    await persistFurniture(
      imported.furniture || settings.furniture,
      "import",
      imported,
    );
  } catch (err) {
    toast(err.message || "Could not import this layout.");
  }
  e.target.value = "";
};
