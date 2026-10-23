#!/usr/bin/env node
/* Static product site. Only the explicit public inputs below can be published. */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  canonicalSystemPath,
  rejectSymlinks,
  publicSiteBase,
  publicRobots,
} from "./build_paths.mjs";
const root = canonicalSystemPath(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
);
const siteBase = publicSiteBase();
const marker = "site-build.json";
const format = "agent-office-product-site-v1";
const args = process.argv.slice(2);
if (args.length && !(args.length === 2 && args[0] === "--out")) {
  throw new Error(
    "Usage: node tools/build_site.mjs [--out /path/to/new-site-directory]",
  );
}
const output = canonicalSystemPath(
  path.resolve(args[1] || path.join(root, "site-dist")),
);
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

rejectSymlinks(output, "site");
if (fs.existsSync(output)) {
  const existing = path.join(output, marker);
  rejectSymlinks(existing, "site");
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
  ["assets/social-preview.png", "docs/screenshots/appearance.png"],
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
// Lossless responsive copies are checked in; publishing needs only Node.
// Refuse stale/missing derivatives before replacing a previous build.
function readInput(relative) {
  const source = path.join(root, relative);
  rejectSymlinks(source, "site");
  if (!fs.statSync(source).isFile())
    throw new Error(`Expected a public site file: ${relative}`);
  return fs.readFileSync(source);
}
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex"),
  images = JSON.parse(readInput("site/screenshots/manifest.json")),
  expectedImages = new Map();
if (images.version !== 1 || JSON.stringify(images.widths) !== "[480,720,1440]")
  throw new Error("Invalid responsive screenshot manifest");
for (const shot of ["appearance", "usage", "settings", "aquarium"]) {
  const record = images.images?.[shot];
  if (
    record?.sourceSha256 !== digest(readInput(`docs/screenshots/${shot}.png`))
  )
    throw new Error(`Stale responsive screenshot source: ${shot}`);
  for (const width of images.widths) {
    const relative = `site/screenshots/${shot}-${width}.webp`;
    inputs.set(`assets/screenshots/${shot}-${width}.webp`, relative);
    expectedImages.set(relative, record.variants?.[width]);
  }
}

// Read every input successfully before replacing a previously generated site.
// Deliberately do not traverse runtime state, environment-configured homes,
// arbitrary docs, the public-demo seed, or optional commercial asset packs.
const copies = new Map();
for (const [destination, relative] of inputs) {
  const bytes = readInput(relative);
  if (expectedImages.has(relative)) {
    const expected = expectedImages.get(relative);
    if (expected?.sha256 !== digest(bytes) || expected.bytes !== bytes.length)
      throw new Error(`Stale or invalid responsive screenshot: ${relative}`);
  }
  copies.set(destination, bytes);
}
// Only product documents belong in search, not fictional sessions in the demo.
const escape = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
const canonicalPages = [];
for (const page of ["index.html", "credits.html"]) {
  let html = copies.get(page).toString("utf8");
  const canonical = new URL(page === "index.html" ? "" : page, siteBase).href;
  const image = new URL("assets/social-preview.png", siteBase).href;
  const title = html
    .match(/<title>([^<]+)<\/title>/)?.[1]
    ?.replaceAll("&amp;", "&");
  const description = html.match(/name="description"\s+content="([^"]+)"/)?.[1];
  if (
    !title ||
    !description ||
    html.split("</head>").length !== 2 ||
    /rel="canonical"|property="og:url"/.test(html)
  ) {
    throw new Error(`Expected one unambiguous metadata template: ${page}`);
  }
  const metadata = [
    ["property", "og:url", canonical],
    ["property", "og:site_name", "Agent Office"],
    ["property", "og:image", image],
    ["property", "og:image:type", "image/png"],
    ["property", "og:image:width", "1440"],
    ["property", "og:image:height", "1000"],
    [
      "property",
      "og:image:alt",
      "Agent Office dashboard with synthetic example sessions",
    ],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", title],
    ["name", "twitter:description", description],
    ["name", "twitter:image", image],
    [
      "name",
      "twitter:image:alt",
      "Agent Office dashboard with synthetic example sessions",
    ],
  ];
  if (page === "credits.html")
    metadata.push(
      ["property", "og:title", title],
      ["property", "og:description", description],
      ["property", "og:type", "website"],
    );
  const tags = metadata
    .map(
      ([attribute, key, value]) =>
        `    <meta ${attribute}="${key}" content="${escape(value)}" />`,
    )
    .join("\n");
  html = html.replace(
    "</head>",
    `<link rel="canonical" href="${escape(canonical)}" />\n${tags}\n  </head>`,
  );
  copies.set(page, Buffer.from(html));
  canonicalPages.push(canonical);
}
copies.set(
  "sitemap.xml",
  Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      canonicalPages
        .map((url) => `  <url><loc>${escape(url)}</loc></url>`)
        .join("\n") +
      "\n</urlset>\n",
  ),
);
copies.set("robots.txt", Buffer.from(publicRobots(siteBase)));
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
