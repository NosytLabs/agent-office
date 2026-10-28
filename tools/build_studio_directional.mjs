/* Fit preserved generated walk art into the existing 32x36 character contract. */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.join(root, "web/assets/sprites/studio");
const sourceName = "source/directional-walk.png";
const source = await fs.readFile(path.join(directory, sourceName));
const check = process.argv.slice(2).includes("--check");
if (process.argv.slice(2).some((argument) => argument !== "--check"))
  throw new Error("Usage: node tools/build_studio_directional.mjs [--check]");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
// The generated sheet is preserved as delivered. These reviewed transparent
// gutters separate its actual twelve columns and six rows; no guessed grid.
const columns = [
  [24, 119],
  [146, 239],
  [271, 365],
  [401, 495],
  [527, 618],
  [656, 746],
  [784, 879],
  [909, 1005],
  [1037, 1134],
  [1165, 1263],
  [1293, 1389],
  [1416, 1511],
];
const rows = [
  [55, 187],
  [201, 336],
  [355, 487],
  [510, 647],
  [665, 806],
  [832, 962],
];
const directions = ["down", "up", "right", "left"];
const poses = ["idle", "walk-a", "walk-b"];
const server = createServer((request, response) => {
  response.setHeader(
    "Content-Type",
    request.url === "/source.png" ? "image/png" : "text/html",
  );
  response.end(
    request.url === "/source.png"
      ? source
      : "<!doctype html><title>Directional sprite compiler</title>",
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const compiled = await page.evaluate(
    async ({ columns, rows }) => {
      const image = new Image();
      image.src = "/source.png";
      await image.decode();
      if (image.width !== 1536 || image.height !== 1024)
        throw new Error("Unexpected generated source dimensions");
      const input = document.createElement("canvas");
      input.width = image.width;
      input.height = image.height;
      const reader = input.getContext("2d", { willReadFrequently: true });
      reader.drawImage(image, 0, 0);
      const pixels = reader.getImageData(0, 0, input.width, input.height).data;
      const bounds = rows.map(([top, bottom]) =>
        columns.map(([left, right]) => {
          let x0 = right,
            x1 = left,
            y0 = bottom,
            y1 = top;
          for (let y = top; y <= bottom; y++)
            for (let x = left; x <= right; x++)
              if (pixels[(y * input.width + x) * 4 + 3] >= 160) {
                x0 = Math.min(x0, x);
                x1 = Math.max(x1, x);
                y0 = Math.min(y0, y);
                y1 = Math.max(y1, y);
              }
          if (x1 <= x0 || y1 <= y0)
            throw new Error("Empty generated character cell");
          return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
        }),
      );
      const atlas = document.createElement("canvas");
      atlas.width = 384;
      atlas.height = 216;
      const context = atlas.getContext("2d", { willReadFrequently: true });
      context.imageSmoothingEnabled = false;
      const scales = bounds.map((row) =>
        Math.min(
          26 / Math.max(...row.map((r) => r[2])),
          31 / Math.max(...row.map((r) => r[3])),
        ),
      );
      bounds.forEach((row, actor) =>
        row.forEach((region, column) => {
          const width = Math.round(region[2] * scales[actor]);
          const height = Math.round(region[3] * scales[actor]);
          context.drawImage(
            image,
            ...region,
            column * 32 + Math.floor((32 - width) / 2),
            actor * 36 + 35 - height,
            width,
            height,
          );
        }),
      );
      const rgba = context.getImageData(0, 0, atlas.width, atlas.height).data;
      const digest = await crypto.subtle.digest("SHA-256", rgba);
      return {
        png: atlas.toDataURL("image/png").split(",")[1],
        rgbaSha256: [...new Uint8Array(digest)]
          .map((v) => v.toString(16).padStart(2, "0"))
          .join(""),
        bounds,
        scales,
      };
    },
    { columns, rows },
  );
  const entries = {};
  for (let actor = 0; actor < 6; actor++)
    for (const [direction, name] of directions.entries())
      for (const [pose, label] of poses.entries())
        entries[`person-${actor}-${name}-${label}`] = {
          rect: [(direction * 3 + pose) * 32, actor * 36, 32, 36],
          anchor: [16, 35],
        };
  const manifest = {
    version: 1,
    image: "directional.png",
    width: 384,
    height: 216,
    rgbaSha256: compiled.rgbaSha256,
    source: sourceName,
    sourceSha256: hash(source),
    sourceDimensions: [1536, 1024],
    sourcePreservedUnmodified: true,
    sourceBounds: compiled.bounds,
    rowScales: compiled.scales,
    entries,
  };
  const manifestPath = path.join(directory, "directional.json");
  const pngPath = path.join(directory, "directional.png");
  if (check) {
    const stored = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    if (JSON.stringify(stored) !== JSON.stringify(manifest))
      throw new Error("Directional manifest differs from preserved source");
    const png = await fs.readFile(pngPath);
    const rgbaHash = await page.evaluate(async (base64) => {
      const image = new Image();
      image.src = "data:image/png;base64," + base64;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      return [
        ...new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            context.getImageData(0, 0, canvas.width, canvas.height).data,
          ),
        ),
      ]
        .map((v) => v.toString(16).padStart(2, "0"))
        .join("");
    }, png.toString("base64"));
    if (rgbaHash !== manifest.rgbaSha256)
      throw new Error("Directional pixels differ from preserved source");
  } else {
    await fs.writeFile(pngPath, Buffer.from(compiled.png, "base64"));
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    const checksumPath = path.join(directory, "../asset-checksums.json");
    const checksums = JSON.parse(await fs.readFile(checksumPath, "utf8"));
    checksums[`studio/${sourceName}`] = hash(source);
    checksums["studio/directional.png"] = hash(await fs.readFile(pngPath));
    await fs.writeFile(
      checksumPath,
      JSON.stringify(
        Object.fromEntries(
          Object.entries(checksums).sort(([a], [b]) => a.localeCompare(b)),
        ),
        null,
        2,
      ) + "\n",
    );
  }
  console.log(
    `${check ? "Verified" : "Built"} 72 directional frames for six identities; source artwork preserved.`,
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
