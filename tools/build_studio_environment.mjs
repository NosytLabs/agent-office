/* Normalize preserved character/companion/surface artwork; --check is read-only. */
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
  for (const name of [
    "room-surfaces",
    "pet-walk",
    "pet-life",
    "character-life",
    "character-reactions",
    "prop-life",
    "workplace-life",
    "lounge-life",
  ]) {
    const sourceName = `source/${name}.png`;
    const source = await fs.readFile(path.join(directory, sourceName));
    const seed =
      name === "prop-life" ||
      name === "workplace-life" ||
      name === "lounge-life"
        ? await fs.readFile(
            path.join(
              directory,
              name === "lounge-life"
                ? "source/lounge-seeds.png"
                : name === "workplace-life"
                  ? "source/workplace-seeds.png"
                  : "source/prop-seeds.png",
            ),
          )
        : null;
    const compiled = await page.evaluate(
      async ({ base64, name, seed64 }) => {
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
          animatedRegions = {},
          bounds = [],
          scales = [];
        const workplace = name === "workplace-life",
          lounge = name === "lounge-life",
          props = name === "prop-life" || workplace || lounge,
          characters = name.startsWith("character-"),
          frameWidth = characters ? 32 : 28,
          frameHeight = characters ? 36 : 26,
          actors = characters ? 6 : 8;
        atlas.width = props
          ? workplace
            ? 80
            : 96
          : name === "room-surfaces"
            ? 256
            : characters
              ? 384
              : 336;
        atlas.height = props
          ? 58
          : name === "room-surfaces"
            ? 256
            : characters
              ? 216
              : 208;
        const context = atlas.getContext("2d", { willReadFrequently: true });
        context.imageSmoothingEnabled = false;
        if (props) {
          if (image.width !== 1536 || image.height !== 1024)
            throw new Error("Unexpected prop source dimensions");
          const seedImage = new Image();
          seedImage.src = "data:image/png;base64," + seed64;
          await seedImage.decode();
          const seedWidth = workplace ? 20 : 24;
          if (seedImage.width !== seedWidth || seedImage.height !== 58)
            throw new Error("Unexpected prop seed dimensions");
          const seedCanvas = document.createElement("canvas");
          seedCanvas.width = seedWidth;
          seedCanvas.height = 58;
          const sg = seedCanvas.getContext("2d", { willReadFrequently: true });
          sg.drawImage(seedImage, 0, 0);
          (lounge
            ? ["lamp", "terrarium"]
            : workplace
              ? ["server", "coffee"]
              : ["arcade", "printer"]
          ).forEach((kind, row) => {
            const propWidth = lounge && !row ? 12 : seedWidth;
            animatedRegions[kind] = lounge
              ? row
                ? [[4, 4, 16, 17]]
                : [[3, 2, 6, 6]]
              : workplace
                ? row
                  ? [
                      [13, 7, 4, 8],
                      [2, 4, 3, 2],
                    ]
                  : [
                      [3, 4, 3, 23],
                      [13, 4, 3, 23],
                    ]
                : row
                  ? [
                      [7, 0, 10, 7],
                      [3, 9, 3, 3],
                    ]
                  : [[6, 10, 15, 10]];
            const height = lounge
                ? row
                  ? 28
                  : 30
                : workplace
                  ? row
                    ? 26
                    : 32
                  : row
                    ? 24
                    : 34,
              targetY = row ? (lounge ? 30 : workplace ? 32 : 34) : 0,
              seedData = sg.getImageData(0, targetY, propWidth, height).data,
              palette = new Map();
            let left = propWidth,
              right = -1,
              top = height,
              bottom = -1;
            for (let i = 0; i < seedData.length; i += 4)
              if (seedData[i + 3] >= 224) {
                const x = (i / 4) % propWidth,
                  y = Math.floor(i / 4 / propWidth);
                left = Math.min(left, x);
                right = Math.max(right, x);
                top = Math.min(top, y);
                bottom = Math.max(bottom, y);
                const rgb = Array.from(seedData.slice(i, i + 3));
                palette.set(rgb.join(","), rgb);
              }
            let x0 = 384,
              x1 = -1,
              y0 = 512,
              y1 = -1;
            for (let column = 0; column < 4; column++)
              for (let y = 0; y < 512; y++)
                for (let x = 0; x < 384; x++) {
                  if (
                    data[
                      ((row * 512 + y) * image.width + column * 384 + x) * 4 + 3
                    ] < 224
                  )
                    continue;
                  x0 = Math.min(x0, x);
                  x1 = Math.max(x1, x);
                  y0 = Math.min(y0, y);
                  y1 = Math.max(y1, y);
                }
            if (x1 < x0 || y1 < y0) throw new Error("Empty prop source row");
            const scale = Math.min(
              (right - left + 1) / (x1 - x0 + 1),
              (bottom - top + 1) / (y1 - y0 + 1),
            );
            scales.push(scale);
            bounds.push(
              Array.from({ length: 4 }, (_, column) => [
                column * 384 + x0,
                row * 512 + y0,
                x1 - x0 + 1,
                y1 - y0 + 1,
              ]),
            );
            for (let frame = 0; frame < 4; frame++) {
              const native = document.createElement("canvas");
              native.width = propWidth;
              native.height = height;
              const ng = native.getContext("2d", {
                willReadFrequently: true,
              });
              ng.imageSmoothingEnabled = false;
              if (frame === 0)
                ng.drawImage(
                  seedImage,
                  0,
                  targetY,
                  propWidth,
                  height,
                  0,
                  0,
                  propWidth,
                  height,
                );
              else {
                const w = Math.round((x1 - x0 + 1) * scale),
                  h = Math.round((y1 - y0 + 1) * scale);
                ng.drawImage(
                  image,
                  ...bounds[row][frame],
                  Math.round((left + right + 1 - w) / 2),
                  bottom + 1 - h,
                  w,
                  h,
                );
                const pixels = ng.getImageData(0, 0, propWidth, height),
                  colors = [...palette.values()];
                for (let i = 0; i < pixels.data.length; i += 4) {
                  if (pixels.data[i + 3] < 224) {
                    pixels.data.fill(0, i, i + 4);
                    continue;
                  }
                  let best,
                    distance = Infinity;
                  for (const rgb of colors) {
                    const d = rgb.reduce(
                      (sum, v, k) => sum + (v - pixels.data[i + k]) ** 2,
                      0,
                    );
                    if (d < distance) {
                      best = rgb;
                      distance = d;
                    }
                  }
                  pixels.data.set([...best, 255], i);
                }
                // Only the screen/paper/light can change. Keep the physical
                // cabinet and stand exactly on their shipped pixel footprint.
                const locked = new ImageData(
                  new Uint8ClampedArray(seedData),
                  propWidth,
                  height,
                );
                for (const [x, y, w, h] of animatedRegions[kind])
                  for (let dy = y; dy < y + h; dy++)
                    for (let dx = x; dx < x + w; dx++) {
                      const i = (dy * propWidth + dx) * 4;
                      // Glass and lampshade frames retain the exact seed
                      // silhouette, including transparent edge pixels.
                      if (lounge && (!seedData[i + 3] || !pixels.data[i + 3]))
                        continue;
                      if (
                        lounge &&
                        !row &&
                        Math.max(...pixels.data.subarray(i, i + 3)) < 120
                      )
                        continue;
                      locked.data.set(pixels.data.subarray(i, i + 4), i);
                    }
                ng.putImageData(locked, 0, 0);
              }
              context.drawImage(native, frame * propWidth, targetY);
              entries[`${kind}-anim-${frame}`] = {
                rect: [frame * propWidth, targetY, propWidth, height],
                anchor: [propWidth / 2, height - 1],
              };
            }
          });
        } else if (name === "room-surfaces") {
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
            throw new Error("Unexpected character/companion source dimensions");
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
          if (rows.length !== actors)
            throw new Error(`Expected ${actors} separated actor rows`);
          rows.forEach(([top, bottom], actor) => {
            const columns = ranges(
              Array.from({ length: image.width }, (_, x) => {
                for (let y = top; y <= bottom; y++)
                  if (data[(y * image.width + x) * 4 + 3] >= 160) return true;
                return false;
              }),
            );
            if (columns.length !== 12)
              throw new Error("Expected twelve separated actor columns");
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
              (characters ? 26 : 24) / Math.max(...row.map((r) => r[2])),
              (characters ? 31 : 23) / Math.max(...row.map((r) => r[3])),
            );
            scales.push(scale);
            row.forEach((region, column) => {
              const width = Math.round(region[2] * scale),
                height = Math.round(region[3] * scale);
              context.drawImage(
                image,
                ...region,
                column * frameWidth + Math.floor((frameWidth - width) / 2),
                actor * frameHeight + frameHeight - 1 - height,
                width,
                height,
              );
              const suffix =
                name === "pet-life" || characters
                  ? (characters
                      ? name === "character-reactions"
                        ? ["idle", "cheer", "error"]
                        : ["type", "read", "attention"]
                      : ["idle", "sleep", "happy"])[Math.floor(column / 4)] +
                    "-anim-" +
                    (column % 4)
                  : ["down", "up", "right", "left"][Math.floor(column / 3)] +
                    "-" +
                    ["idle", "walk-a", "walk-b"][column % 3];
              entries[`${characters ? "person" : "pet"}-${actor}-${suffix}`] = {
                rect: [
                  column * frameWidth,
                  actor * frameHeight,
                  frameWidth,
                  frameHeight,
                ],
                anchor: [frameWidth / 2, frameHeight - 1],
              };
            });
          });
        }
        if (name === "character-life") {
          // Preserve the generated source while making the native silhouette
          // fully opaque, without carrying faint source halos into the room.
          const pixels = context.getImageData(0, 0, atlas.width, atlas.height);
          for (let index = 0; index < pixels.data.length; index += 4) {
            if (pixels.data[index + 3] < 160)
              pixels.data.fill(0, index, index + 4);
            else pixels.data[index + 3] = 255;
          }
          context.putImageData(pixels, 0, 0);
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
          animatedRegions,
        };
      },
      {
        base64: source.toString("base64"),
        name,
        seed64: seed?.toString("base64"),
      },
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
      ...(name === "character-life"
        ? { alphaThreshold: 160, binaryAlpha: true }
        : {}),
      ...(seed
        ? {
            seed:
              name === "lounge-life"
                ? "source/lounge-seeds.png"
                : name === "workplace-life"
                  ? "source/workplace-seeds.png"
                  : "source/prop-seeds.png",
            seedSha256: hash(seed),
            lockedFirstFrames: true,
            alphaThreshold: 224,
            palette: "nearest seed RGB",
            animatedRegions: compiled.animatedRegions,
          }
        : {}),
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
        checksums[`studio/${name}.png`] !== hash(stored) ||
        (seed && checksums[`studio/${manifest.seed}`] !== hash(seed))
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
      if (seed) checksums[`studio/${manifest.seed}`] = hash(seed);
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
