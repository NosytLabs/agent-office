/* Optional CPU-canvas scene audit. Requires skia-canvas; no browser/DOM claims. */
const fs = require("node:fs"),
  vm = require("node:vm"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { Canvas, Image, FontLibrary } = require(
  process.env.SCENE_CANVAS_MODULE || "skia-canvas",
);
const root = path.resolve(__dirname, "..");
FontLibrary.use(
  "Geist",
  path.join(root, "web/assets/fonts/geist-latin-variable.woff2"),
);
function canvas(w = 300, h = 150) {
  const c = new Canvas(w, h);
  c.clientWidth = w;
  c.clientHeight = h;
  c.addEventListener = () => {};
  c.dispatchEvent = () => {};
  return c;
}
class LocalImage extends Image {
  set src(s) {
    super.src = fs.readFileSync(path.join(root, "web", s));
  }
}
const model = {
  console,
  Image: LocalImage,
  document: { createElement: () => canvas(), hidden: false },
  matchMedia: () => ({ matches: false }),
  ResizeObserver: class {
    observe() {}
  },
  requestAnimationFrame: () => 0,
  devicePixelRatio: 1,
  Event: class {},
};
vm.createContext(model);
vm.runInContext(
  fs.readFileSync(path.join(root, "web/js/data.js"), "utf8") +
    fs.readFileSync(path.join(root, "web/js/scene.js"), "utf8") +
    ";globalThis.Scene=OfficeScene;globalThis.defaults=DEFAULT_SETTINGS;globalThis.sizes=PROP_SIZES;",
  model,
);
vm.runInContext(
  "globalThis.routePlans=0; const originalPath=officePath; officePath=(...args)=>{routePlans++;return originalPath(...args);};",
  model,
);
(async () => {
  fs.mkdirSync(path.join(root, "reports/scene-render"), { recursive: true });
  for (const [name, w, h, theme] of [
    ["desktop", 1200, 640, "default"],
    ["mobile", 390, 520, "amber"],
    ["midnight", 1200, 640, "midnight"],
  ]) {
    const cv = canvas(w, h),
      scene = new model.Scene(
        cv,
        () => {},
        () => {},
      );
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(scene.assetErrors.length, 0);
    assert.equal(scene.loadedAssets, 14);
    const agents = Array.from({ length: 6 }, (_, i) => ({
      id: "session-" + i,
      label: ["Build", "Review", "Research", "Docs", "Notes", "Tests"][i],
      status: i === 1 ? "waiting" : "working",
      tool: i % 2 ? "read_file" : "terminal",
      activity: i % 2 ? "reading" : "typing",
      platform: i % 2 ? "claude" : "opencode",
    }));
    scene.update([], { ...model.defaults }, null, null, "every");
    scene.update(
      agents,
      {
        ...model.defaults,
        theme,
        ambience: theme === "midnight" ? "night" : "day",
      },
      { cosmetics: ["fish_tank", "office_cat", "gitcat"] },
      null,
      "every",
    );
    model.routePlans = 0;
    for (let i = 0; i < 240; i++) {
      scene.time = i / 30;
      scene.draw(1 / 30);
      if (i === 0)
        assert.ok(
          scene.walking.length > 0 && scene.walking.length <= 2,
          "arrival planning is bounded",
        );
    }
    assert.ok(
      model.routePlans <= 2,
      "one draw never starts more than two routes",
    );
    assert.ok(
      [...scene.chars.values()].every((c) => !c.moving),
      "agents reach desk",
    );
    fs.writeFileSync(
      path.join(root, "reports/scene-render", name + ".png"),
      await cv.toBuffer("png"),
    );
  }
  const crowded = new model.Scene(
    canvas(1200, 640),
    () => {},
    () => {},
  );
  crowded.update(
    Array.from({ length: 128 }, (_, i) => ({
      id: "crowded-" + i,
      status: "idle",
    })),
    { ...model.defaults },
    null,
    null,
    "every",
  );
  model.routePlans = 0;
  crowded.draw(1 / 30);
  assert.equal(crowded.hitBoxes.length, 128, "all sessions remain tracked");
  assert.equal(
    model.routePlans,
    0,
    "crowded bootstrap never plans expensive routes",
  );
  crowded.canvas.clientWidth = 390;
  crowded.draw(1 / 30);
  assert.equal(model.routePlans, 0, "relayout never plans discarded routes");
  const sheet = canvas(640, 300),
    g = sheet.getContext("2d");
  g.fillStyle = "#171e28";
  g.fillRect(0, 0, 640, 300);
  const scene = new model.Scene(
    canvas(),
    () => {},
    () => {},
  );
  await new Promise((r) => setTimeout(r, 100));
  g.imageSmoothingEnabled = false;
  g.fillStyle = "#e7ded0";
  g.font = "16px Geist";
  for (const [i, key] of [
    "roundtable",
    "stool",
    "succulent",
    "planter",
  ].entries()) {
    const im = scene.sprites[key];
    assert.ok(im);
    g.drawImage(im, 40 + i * 150, 75, im.width * 3, im.height * 3);
    g.fillText(key, 40 + i * 150, 200);
  }
  fs.writeFileSync(
    path.join(root, "reports/scene-render/decor-preview.png"),
    await sheet.toBuffer("png"),
  );
  console.log(
    "Actual scene rendered at desktop/mobile/night; 14 assets loaded; agents seated; decor cells visible. This is CPU canvas verification, not browser DOM QA.",
  );
})();
