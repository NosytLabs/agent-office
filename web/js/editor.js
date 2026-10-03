/* Furniture editing and layout import/export. Uses the shared settings save queue. */
"use strict";
const furnitureHistory = [],
  furnitureFuture = [];
let furnitureSignature = JSON.stringify(settings.furniture);
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
  $("undo-furniture").disabled = !furnitureHistory.length;
  $("redo-furniture").disabled = !furnitureFuture.length;
  $("delete-furniture").disabled = scene.movingIndex === null;
  $("arrange-furniture").setAttribute(
    "aria-pressed",
    String(scene.edit === "move"),
  );
}
function startFurniture(kind) {
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
  if (!settings.furniture[index]) return;
  scene.movingIndex = index;
  const b = propBounds(settings.furniture[index], scene.grid);
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
  if (scene.movingIndex === null) return;
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
  furnitureHistory.push(structuredClone(settings.furniture));
  if (furnitureHistory.length > 20) furnitureHistory.shift();
  furnitureFuture.length = 0;
  return persistFurniture(items);
}
function persistFurniture(items) {
  furnitureSignature = JSON.stringify(items);
  const saved = updateSetting("furniture", items);
  syncFurnitureControls();
  return saved;
}
// A layout imported or edited in another tab invalidates index-based selection/history.
function reconcileFurniture() {
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
  $("empty-state").hidden = scene.list().length > 0;
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
  if (!furnitureHistory.length) return;
  furnitureFuture.push(structuredClone(settings.furniture));
  resetSelection();
  persistFurniture(furnitureHistory.pop());
};
$("redo-furniture").onclick = () => {
  if (!furnitureFuture.length) return;
  furnitureHistory.push(structuredClone(settings.furniture));
  resetSelection();
  persistFurniture(furnitureFuture.pop());
};
function placeFurniture(p) {
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
    await saveSettings(imported);
    furnitureHistory.length = furnitureFuture.length = 0;
    furnitureSignature = JSON.stringify(settings.furniture);
    resetSelection();
  } catch (err) {
    toast(err.message || "Could not import this layout.");
  }
  e.target.value = "";
};
