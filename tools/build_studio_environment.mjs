/* Normalize preserved companion/surface artwork; --check never writes files. */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { chromium } from "playwright";

const directory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../web/assets/sprites/studio",
);
const check = process.argv.slice(2).includes("--check");
if (process.argv.slice(2).some((x) => x !== "--check"))
  throw new Error("Usage: node tools/build_studio_environment.mjs [--check]");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ["--no-sandbox", "--disable-gpu"],
});
try {
  const page = await browser.newPage();
  const checksumPath = path.join(directory, "../asset-checksums.json");
  const checksums = JSON.parse(await fs.readFile(checksumPath, "utf8"));
  for (const name of ["room-surfaces", "pet-walk", "pet-life"]) {
    const sourceName = `source/${name}.png`;
    const source = await fs.readFile(path.join(directory, sourceName));
    const compiled = await page.evaluate(
      async ({ base64, name }) => {
        const image = new Image();
        image.src = "data:image/png;base64," + base64;
        await image.decode();
        const input = document.createElement("canvas");
        input.width = image.width;
        input.height = image.height;
        const reader = input.getContext("2d", { willReadFrequently: true });
        reader.drawImage(image, 0, 0);
        const data = reader.getImageData(0, 0, input.width, input.height).data;
        const atlas = document.createElement("canvas"),
          entries = {},
          bounds = [],
          scales = [];
        atlas.width = name === "room-surfaces" ? 256 : 336;
        atlas.height = name === "room-surfaces" ? 256 : 208;
        const context = atlas.getContext("2d", { willReadFrequently: true });
        context.imageSmoothingEnabled = false;
        if (name === "room-surfaces") {
          if (image.width !== 1254 || image.height !== 1254)
            throw new Error("Unexpected surface source dimensions");
          const names = [
            "surface-oak-floor",
            "surface-slate-floor",
            "surface-oak-wall",
            "surface-slate-wall",
          ];
          names.forEach((key, index) => {
            const region = [
              (index % 2) * 627,
              Math.floor(index / 2) * 627,
              627,
              627,
            ];
            bounds.push(region);
            const tile = document.createElement("canvas");
            tile.width = tile.height = 64;
            const g = tile.getContext("2d");
            g.imageSmoothingEnabled = false;
            g.drawImage(image, ...region, 0, 0, 64, 64);
            const x = (index % 2) * 128,
              y = Math.floor(index / 2) * 128;
            // Reflected edges make both axes exactly seamless at native resolution.
            for (let row = 0; row < 2; row++)
              for (let column = 0; column < 2; column++) {
                context.save();
                context.translate(
                  x + column * 64 + (column ? 64 : 0),
                  y + row * 64 + (row ? 64 : 0),
                );
                context.scale(column ? -1 : 1, row ? -1 : 1);
                context.drawImage(tile, 0, 0);
                context.restore();
              }
            entries[key] = { rect: [x, y, 128, 128], anchor: [0, 0] };
          });
        } else {
          if (image.width !== 1536 || image.height !== 1024)
            throw new Error("Unexpected companion source dimensions");
          const ranges = (values) => {
            const result = [];
            let start = null;
            values.forEach((value, index) => {
              if (value && start === null) start = index;
              if (!value && start !== null) {
                result.push([start, index - 1]);
                start = null;
              }
            });
            if (start !== null) result.push([start, values.length - 1]);
            return result;
          };
          const rows = ranges(
            Array.from({ length: image.height }, (_, y) => {
              for (let x = 0; x < image.width; x++)
                if (data[(y * image.width + x) * 4 + 3] >= 160) return true;
              return false;
            }),
          );
          if (rows.length !== 8)
            throw new Error("Expected eight separated companion rows");
          rows.forEach(([top, bottom], actor) => {
            const columns = ranges(
              Array.from({ length: image.width }, (_, x) => {
                for (let y = top; y <= bottom; y++)
                  if (data[(y * image.width + x) * 4 + 3] >= 160) return true;
                return false;
              }),
            );
            if (columns.length !== 12)
              throw new Error("Expected twelve separated companion columns");
            const row = columns.map(([left, right]) => {
              let y0 = bottom,
                y1 = top;
              for (let y = top; y <= bottom; y++)
                for (let x = left; x <= right; x++)
                  if (data[(y * image.width + x) * 4 + 3] >= 160) {
                    y0 = Math.min(y0, y);
                    y1 = Math.max(y1, y);
                  }
              return [left, y0, right - left + 1, y1 - y0 + 1];
            });
            bounds.push(row);
            const scale = Math.min(
              24 / Math.max(...row.map((r) => r[2])),
              23 / Math.max(...row.map((r) => r[3])),
            );
            scales.push(scale);
            row.forEach((region, column) => {
              const width = Math.round(region[2] * scale),
                height = Math.round(region[3] * scale);
              context.drawImage(
                image,
                ...region,
                column * 28 + Math.floor((28 - width) / 2),
                actor * 26 + 25 - height,
                width,
                height,
              );
              const suffix =
                name === "pet-life"
                  ? ["idle", "sleep", "happy"][Math.floor(column / 4)] +
                    "-anim-" +
                    (column % 4)
                  : ["down", "up", "right", "left"][Math.floor(column / 3)] +
                    "-" +
                    ["idle", "walk-a", "walk-b"][column % 3];
              entries[`pet-${actor}-${suffix}`] = {
                rect: [column * 28, actor * 26, 28, 26],
                anchor: [14, 25],
              };
            });
          });
        }
        return {
          png: atlas.toDataURL("image/png").split(",")[1],
          rgba: Array.from(
            context.getImageData(0, 0, atlas.width, atlas.height).data,
          ),
          width: atlas.width,
          height: atlas.height,
          sourceDimensions: [image.width, image.height],
          sourceBounds: bounds,
          rowScales: scales,
          entries,
        };
      },
      { base64: source.toString("base64"), name },
    );
    const manifest = {
      version: 1,
      image: name + ".png",
      width: compiled.width,
      height: compiled.height,
      rgbaSha256: hash(Buffer.from(compiled.rgba)),
      source: sourceName,
      sourceSha256: hash(source),
      sourceDimensions: compiled.sourceDimensions,
      sourcePreservedUnmodified: true,
      sourceBounds: compiled.sourceBounds,
      rowScales: compiled.rowScales,
      entries: compiled.entries,
    };
    const pngPath = path.join(directory, name + ".png"),
      manifestPath = path.join(directory, name + ".json");
    if (check) {
      if (
        JSON.stringify(JSON.parse(await fs.readFile(manifestPath, "utf8"))) !==
        JSON.stringify(manifest)
      )
        throw new Error(name + " manifest differs from source");
      const stored = await fs.readFile(pngPath);
      const rgba = await page.evaluate(async (base64) => {
        const i = new Image();
        i.src = "data:image/png;base64," + base64;
        await i.decode();
        const c = document.createElement("canvas");
        c.width = i.width;
        c.height = i.height;
        const g = c.getContext("2d");
        g.drawImage(i, 0, 0);
        return Array.from(g.getImageData(0, 0, c.width, c.height).data);
      }, stored.toString("base64"));
      if (hash(Buffer.from(rgba)) !== manifest.rgbaSha256)
        throw new Error(name + " pixels differ from source");
      if (
        checksums[`studio/${sourceName}`] !== hash(source) ||
        checksums[`studio/${name}.png`] !== hash(stored)
      )
        throw new Error(name + " checksum inventory differs");
    } else {
      await fs.writeFile(pngPath, Buffer.from(compiled.png, "base64"));
      await fs.writeFile(
        manifestPath,
        JSON.stringify(manifest, null, 2) + "\n",
      );
      checksums[`studio/${sourceName}`] = hash(source);
      checksums[`studio/${name}.png`] = hash(await fs.readFile(pngPath));
    }
    console.log(
      `${check ? "Verified" : "Built"} ${Object.keys(compiled.entries).length} ${name} entries from preserved artwork.`,
    );
  }
  if (!check)
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
} finally {
  await browser.close();
}
