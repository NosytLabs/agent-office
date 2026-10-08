import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  ),
  sourcePath = path.join(projectRoot, "web/arcade/duck-hunt/js/upstream.js"),
  outputPath = path.join(projectRoot, "web/arcade/duck-hunt/js/game.js"),
  pinnedSha256 =
    "a503f24c1124b5aa510a79555d4c55abd4bb159a3ebf43fada1fd3795f39ed42",
  replacements = [
    ["this.position.x+=20/t", "this.position.x+=.072*t"],
    ["this.position.x+=50/t", "this.position.x+=.18*t"],
  ];

const source = await readFile(sourcePath, "utf8"),
  actualSha256 = createHash("sha256").update(source).digest("hex");

if (actualSha256 !== pinnedSha256) {
  throw new Error(
    `Refusing to patch unverified Duck Hunt bundle: expected ${pinnedSha256}, received ${actualSha256}`,
  );
}

let runtime = source;
for (const [before, after] of replacements) {
  const matches = runtime.split(before).length - 1;
  if (matches !== 1) {
    throw new Error(
      `Expected exactly one Duck Hunt timing expression ${JSON.stringify(before)}, found ${matches}`,
    );
  }
  runtime = runtime.replace(before, after);
}

await writeFile(outputPath, runtime);
const runtimeSha256 = createHash("sha256").update(runtime).digest("hex");
console.log(
  `Wrote ${path.relative(projectRoot, outputPath)} (${runtimeSha256}); applied ${replacements.length} verified timing substitutions.`,
);
