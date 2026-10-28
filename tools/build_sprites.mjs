/* Build compact, pixel-equivalent runtime art from the preserved source loader. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const web = resolve(root, "web");
const output = resolve(web, "assets/sprites/runtime");
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--check"))
  throw new Error("Usage: node tools/build_sprites.mjs [--check]");
const check = args.includes("--check");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname === "/") {
      res.setHeader("Content-Type", "text/html");
      res.end("<!doctype html><title>Sprite compiler</title>");
      return;
    }
    if (!pathname.startsWith("/assets/sprites/")) {
      res.writeHead(404).end();
      return;
    }
    const file = resolve(web, "." + decodeURIComponent(pathname));
    const inside = relative(resolve(web, "assets/sprites"), file);
    if (inside.startsWith(".." + sep) || inside === "..") {
      res.writeHead(403).end();
      return;
    }
    res.setHeader("Content-Type", "image/png");
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    // Match the checked-in normalization pixels on machines with different
    // graphics drivers; GPU canvas resampling can round color values differently.
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  for (const file of ["data.js", "scene.js"])
    await page.addScriptTag({
      content: await readFile(resolve(web, "js", file), "utf8"),
    });
  await page.evaluate(() => {
    window.sourceScene = Object.assign(Object.create(OfficeScene.prototype), {
      sprites: {},
      spriteFrameTops: {},
      assetErrors: [],
      loadedAssets: 0,
      canvas: document.createElement("canvas"),
    });
    sourceScene.loadSourceAssets();
  });
  await page.waitForFunction(
    () => sourceScene.loadedAssets === 23 || sourceScene.assetErrors.length,
    null,
    { timeout: 15000 },
  );
  const result = await page.evaluate(() => {
    if (sourceScene.assetErrors.length)
      throw new Error(sourceScene.assetErrors.join("; "));
    const sizes = sourceScene.runtimeSpriteSizes(),
      entries = {};
    let x = 1,
      y = 1,
      rowHeight = 0;
    for (const key of Object.keys(sizes).sort()) {
      const [width, height] = sizes[key],
        sprite = sourceScene.sprites[key];
      if (!sprite || sprite.width !== width || sprite.height !== height)
        throw new Error("Unexpected source geometry: " + key);
      if (x + width + 1 > 512) {
        x = 1;
        y += rowHeight + 2;
        rowHeight = 0;
      }
      entries[key] = [x, y, width, height];
      x += width + 2;
      rowHeight = Math.max(rowHeight, height);
    }
    const atlas = document.createElement("canvas");
    atlas.width = 512;
    atlas.height = y + rowHeight + 1;
    const context = atlas.getContext("2d");
    context.imageSmoothingEnabled = false;
    for (const [key, [x, y]] of Object.entries(entries))
      context.drawImage(sourceScene.sprites[key], x, y);
    window.compiledAtlas = atlas;
    return {
      png: atlas.toDataURL("image/png").split(",")[1],
      width: atlas.width,
      height: atlas.height,
      entries,
      frameTops: Object.fromEntries(
        Object.entries(sourceScene.spriteFrameTops).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      ),
      sources: Object.values(sourceScene.sprites)
        .filter((sprite) => sprite instanceof HTMLImageElement)
        .map((sprite) =>
          new URL(sprite.src).pathname.slice("/assets/sprites/".length),
        )
        .sort(),
    };
  });
  const sources = {};
  for (const name of result.sources) {
    const bytes = await readFile(resolve(web, "assets/sprites", name));
    sources[name] = { sha256: hash(bytes), bytes: bytes.length };
  }
  if (Object.keys(sources).length !== 23)
    throw new Error(
      "Source roster changed; review the runtime manifest version",
    );
  const png = Buffer.from(result.png, "base64");
  const stored = check ? await readFile(resolve(output, "office.png")) : null;
  const manifest = {
    version: 1,
    sourceCount: 23,
    imageSha256: hash(stored || png),
    width: result.width,
    height: result.height,
    entries: result.entries,
    frameTops: result.frameTops,
    sources,
  };
  const manifestJSON = JSON.stringify(manifest, null, 2) + "\n";
  if (check) {
    const equivalent = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = "data:image/png;base64," + base64;
      await image.decode();
      if (
        image.width !== compiledAtlas.width ||
        image.height !== compiledAtlas.height
      )
        return false;
      const c = document.createElement("canvas");
      c.width = image.width;
      c.height = image.height;
      const g = c.getContext("2d");
      g.drawImage(image, 0, 0);
      const a = g.getImageData(0, 0, c.width, c.height).data;
      const b = compiledAtlas
        .getContext("2d")
        .getImageData(0, 0, c.width, c.height).data;
      return a.every((value, index) => value === b[index]);
    }, stored.toString("base64"));
    if (
      !equivalent ||
      (await readFile(resolve(output, "manifest.json"), "utf8")) !==
        manifestJSON
    )
      throw new Error("Runtime sprites are stale; run npm run build:sprites");
    const checksums = JSON.parse(
      await readFile(
        resolve(web, "assets/sprites/asset-checksums.json"),
        "utf8",
      ),
    );
    if (checksums["runtime/office.png"] !== hash(stored))
      throw new Error("Runtime atlas checksum differs");
    console.log(
      `Verified ${Object.keys(result.entries).length} sprites against ${Object.keys(sources).length} original sheets.`,
    );
  } else {
    await mkdir(output, { recursive: true });
    await writeFile(resolve(output, "office.png"), png);
    await writeFile(resolve(output, "manifest.json"), manifestJSON);
    const checksumPath = resolve(web, "assets/sprites/asset-checksums.json");
    const checksums = JSON.parse(await readFile(checksumPath, "utf8"));
    checksums["runtime/office.png"] = hash(png);
    await writeFile(
      checksumPath,
      JSON.stringify(
        Object.fromEntries(
          Object.entries(checksums).sort(([a], [b]) => a.localeCompare(b)),
        ),
        null,
        2,
      ) + "\n",
    );
    const before = Object.values(sources).reduce(
      (total, value) => total + value.bytes,
      0,
    );
    console.log(
      JSON.stringify({
        sprites: Object.keys(result.entries).length,
        sourceBytes: before,
        nativeBytes: png.length + Buffer.byteLength(manifestJSON),
        atlasBytes: png.length,
        width: result.width,
        height: result.height,
      }),
    );
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
