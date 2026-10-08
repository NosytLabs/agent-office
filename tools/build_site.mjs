#!/usr/bin/env node
/* Static product site. Only the explicit public inputs below can be published. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const marker = "site-build.json";
const format = "agent-office-product-site-v1";
const args = process.argv.slice(2);
if (args.length && !(args.length === 2 && args[0] === "--out")) {
  throw new Error(
    "Usage: node tools/build_site.mjs [--out /path/to/new-site-directory]",
  );
}
const output = path.resolve(args[1] || path.join(root, "site-dist"));
const approvedOutputs = [
  path.join(root, "site-dist"),
  path.join(root, "dist/about"),
];
if (
  !approvedOutputs.includes(output) &&
  (output === root ||
    output.startsWith(root + path.sep) ||
    root.startsWith(output + path.sep))
) {
  throw new Error(
    "Site output must be site-dist, dist/about, or a separate directory outside the source checkout.",
  );
}

// Reject symlinked files AND parents; an allowlisted name cannot redirect a read
// into a private directory or redirect output removal through an ancestor.
function rejectSymlinks(file) {
  let current = path.parse(file).root;
  for (const part of file.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      throw new Error(`Refusing symlinked site input/output: ${current}`);
    }
  }
}
rejectSymlinks(output);
if (fs.existsSync(output)) {
  const existing = path.join(output, marker);
  rejectSymlinks(existing);
  if (
    !fs.statSync(output).isDirectory() ||
    !fs.existsSync(existing) ||
    JSON.parse(fs.readFileSync(existing, "utf8")).format !== format
  ) {
    throw new Error(
      "Refusing to replace an existing directory that is not an Agent Office product-site build.",
    );
  }
}

const inputs = new Map([
  ["index.html", "site/index.html"],
  ["style.css", "site/style.css"],
  ["site.js", "site/site.js"],
  ["credits.html", "site/credits.html"],
  ["LICENSE.txt", "LICENSE"],
  ["assets/office.svg", "web/assets/office.svg"],
  [
    "assets/fonts/geist-latin-variable.woff2",
    "web/assets/fonts/geist-latin-variable.woff2",
  ],
  ["assets/fonts/OFL.txt", "web/assets/fonts/OFL.txt"],
  ["assets/icons/LICENSE.txt", "web/assets/icons/LICENSE.txt"],
  ["assets/brands/SVGL-LICENSE.txt", "web/assets/brands/SVGL-LICENSE.txt"],
  [
    "assets/sprites/PIXEL-AGENTS-LICENSE.txt",
    "web/assets/sprites/PIXEL-AGENTS-LICENSE.txt",
  ],
]);
for (const brand of ["claude", "codex", "opencode", "gemini"]) {
  inputs.set(`assets/brands/${brand}.svg`, `web/assets/brands/${brand}.svg`);
}
for (const shot of ["appearance", "usage", "settings", "aquarium"]) {
  inputs.set(`assets/screenshots/${shot}.png`, `docs/screenshots/${shot}.png`);
}

// Read every input successfully before replacing a previously generated site.
// Deliberately do not traverse runtime state, environment-configured homes,
// arbitrary docs, the public-demo seed, or optional commercial asset packs.
const copies = new Map();
for (const [destination, relative] of inputs) {
  const source = path.join(root, relative);
  rejectSymlinks(source);
  if (!fs.statSync(source).isFile())
    throw new Error(`Expected a public site file: ${relative}`);
  copies.set(destination, fs.readFileSync(source));
}
copies.set(".nojekyll", Buffer.from(""));
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const [relative, data] of copies) {
  const destination = path.join(output, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, data);
}
fs.writeFileSync(
  path.join(output, marker),
  JSON.stringify(
    {
      format,
      product_version: "0.5.0",
      runtime_data: false,
      screenshots: "synthetic examples",
      files: [...copies.keys()].sort(),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Built Agent Office product site with ${copies.size} public files in ${output}`,
);
