#!/usr/bin/env node
/* Dependency-free, static-only public demo build. Does not read runtime data. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
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
const marker = "preview-build.json";
const format = "agent-office-static-preview-v1";
const args = process.argv.slice(2);
if (args.length && !(args.length === 2 && args[0] === "--out")) {
  throw new Error(
    "Usage: node tools/build_preview.mjs [--out /path/to/new-preview-directory]",
  );
}
const output = canonicalSystemPath(
  path.resolve(args[1] || path.join(root, "dist")),
);
if (
  output !== path.join(root, "dist") &&
  (output === root ||
    output.startsWith(root + path.sep) ||
    root.startsWith(output + path.sep))
) {
  throw new Error(
    "Preview output must be dist or a separate directory outside the source checkout.",
  );
}
rejectSymlinks(output, "preview");
if (fs.existsSync(output)) {
  const existing = path.join(output, marker);
  rejectSymlinks(existing, "preview");
  if (
    !fs.statSync(output).isDirectory() ||
    !fs.existsSync(existing) ||
    JSON.parse(fs.readFileSync(existing, "utf8")).format !== format
  ) {
    throw new Error(
      "Refusing to replace an existing directory that is not an Agent Office preview build.",
    );
  }
}

// These owner-only source sheets must never appear in public output, even if
// accidentally renamed into web/assets. The generated public fallback is separate.
const privateHashes = new Set([
  "efac23e9983e1c1f49cb22692a95af533711f2dd11c3626f7be302e1e959a223",
  "58067e766aece90bd7c0fbce7e7020af4544a156a08e2ef3fe1a4ecd74cc2e24",
  "5e3d76f06b867402dfa45429e9babd67a83b477b869ce11c6a5e586816a83007",
  "392dbeee17c9d668d04b57e6d4565e29377af745f5abb1c83c87390ee1a453a2",
]);
const allowed = new Set([
  ".js",
  ".css",
  ".svg",
  ".png",
  ".woff2",
  ".json",
  ".txt",
  ".md",
  ".html",
  ".mp3",
]);
// These are reproducibility inputs, never requested by the browser. Classic
// source PNGs remain public because the runtime uses them when its atlas fails.
function authoringInput(relative) {
  return (
    relative === "assets/sprites/studio/source" ||
    relative.startsWith("assets/sprites/studio/source/") ||
    /^assets\/sprites\/generated-[^/]+\.json$/.test(relative) ||
    relative === "assets/sprites/asset-checksums.json" ||
    relative === "arcade/duck-hunt/js/upstream.js"
  );
}
const copies = new Map();
function collect(relative) {
  const source = path.join(root, "web", relative);
  rejectSymlinks(source, "preview");
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const name = path.join(relative, entry.name),
      publicName = name.split(path.sep).join("/");
    if (entry.isSymbolicLink())
      throw new Error(`Refusing a symlink in public web assets: ${name}`);
    if (authoringInput(publicName)) continue;
    if (entry.isDirectory()) {
      if (/^(user|inbox|node_modules|reports|smallburg)$/i.test(entry.name)) {
        throw new Error(
          `Private or development directory in web assets: ${name}`,
        );
      }
      collect(name);
    } else if (entry.isFile()) {
      if (
        !allowed.has(path.extname(name).toLowerCase()) &&
        !/^(LICENSE|NOTICE)$/i.test(entry.name)
      )
        continue;
      const data = fs.readFileSync(path.join(root, "web", name));
      const digest = createHash("sha256").update(data).digest("hex");
      if (privateHashes.has(digest) || /smallburg/i.test(entry.name)) {
        throw new Error(`Licensed local-only art cannot be published: ${name}`);
      }
      copies.set(publicName, data);
    }
  }
}
for (const directory of ["assets", "css", "js", "arcade"]) collect(directory);

// Keep attribution usable when its generation records stay in the checkout.
// Only publication copies change; source notices and original bytes stay intact.
const repositoryWeb =
  "https://github.com/NosytLabs/agent-office/blob/main/web/";
for (const [relative, data] of copies) {
  if (!relative.endsWith(".md")) continue;
  let notice = data
    .toString("utf8")
    .replace(/\]\(([^)\s]+)\)/g, (link, target) => {
      if (/^(?:[a-z]+:|#|\/)/i.test(target)) return link;
      const resolved = path.posix.normalize(
        path.posix.join(path.posix.dirname(relative), target),
      );
      return authoringInput(resolved) ? `](${repositoryWeb}${resolved})` : link;
    });
  if (relative === "assets/sprites/studio/README.md")
    notice +=
      "\nSupplement authoring files stay in the [repository source directory](https://github.com/NosytLabs/agent-office/tree/main/web/assets/sprites/studio/source). This public build includes their compiled runtime images and manifests.\n";
  if (relative === "arcade/duck-hunt/UPSTREAM-NOTICE.md")
    notice += `\nThe unchanged [authoring bundle](${repositoryWeb}arcade/duck-hunt/js/upstream.js) stays in the repository for patch verification. This public build serves only the derived \`js/game.js\` bundle.\n`;
  copies.set(relative, Buffer.from(notice));
}

const seedPath = path.join(root, "tools/fixtures/preview.json");
rejectSymlinks(seedPath, "preview");
const seed = JSON.parse(fs.readFileSync(seedPath, "utf8"));
if (
  seed.version !== 1 ||
  seed.synthetic !== true ||
  seed.state?.mode !== "demo" ||
  seed.empty_state?.mode !== "demo" ||
  !seed.history.every((row) => row.synthetic === true)
) {
  throw new Error(
    "Expected the reviewed synthetic preview fixture, never a live state export.",
  );
}
copies.set(
  "js/preview-seed.js",
  Buffer.from(
    `/* Public synthetic demo; never runtime observations. */\nwindow.__AGENT_OFFICE_PREVIEW_SEED__ = ${JSON.stringify(seed).replaceAll("<", "\\u003c")};\n`,
  ),
);
const templatePath = path.join(root, "web/template.html");
rejectSymlinks(templatePath, "preview");
let html = fs.readFileSync(templatePath, "utf8");
function replaceOnce(needle, replacement) {
  if (html.split(needle).length !== 2)
    throw new Error(`Preview template marker changed: ${needle}`);
  html = html.replace(needle, replacement);
}
html = html.replace(
  /<title>[^<]*<\/title>/,
  "<title>Agent Office — Interactive demo</title>",
);
function previewMeta(attribute, key, value) {
  const pattern = new RegExp(
    `<meta\\s+${attribute}="${key}"\\s+content="[^"]*"\\s*\\/>`,
    "g",
  );
  const matches = html.match(pattern);
  if (matches?.length !== 1)
    throw new Error(`Expected one preview metadata field: ${key}`);
  html = html.replace(
    pattern,
    `<meta ${attribute}="${key}" content="${value}" />`,
  );
}
previewMeta(
  "name",
  "description",
  "Explore Agent Office with fictional agents, sample activity and synthetic token usage. Run the local observer to monitor your own sessions.",
);
replaceOnce(
  "</head>",
  '  <meta name="robots" content="noindex, follow" />\n  </head>',
);
previewMeta("property", "og:title", "Agent Office — Interactive demo");
previewMeta(
  "property",
  "og:description",
  "Interactive demo with fictional activity and usage. No local agent data is connected.",
);
replaceOnce(
  '<span class="edition">LOCAL WORKSPACE</span>',
  '<span class="edition">INTERACTIVE DEMO</span>',
);
replaceOnce("Local · Observer only", "Static demo · No observer connected");
replaceOnce("<body>", '<body data-agent-office-preview="1">');
replaceOnce(
  '<div id="wrap">',
  `<div id="wrap">
      <aside id="preview-notice" aria-label="Demo information">
        <details id="preview-info">
          <summary>Interactive demo · Fictional data</summary>
          <p>All agents, activity, XP and usage here are fictional. Preferences stay in this browser. Run Agent Office locally to observe your own sessions.</p>
          <button class="btn" id="preview-restore" type="button">Restore sample</button>
        </details>
        <a class="btn" id="preview-run-locally" href="${siteBase.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}#get-started" target="_blank" rel="noopener noreferrer">Run locally ↗</a>
      </aside>`,
);
replaceOnce(
  '<div id="usagebox"></div>',
  '<p class="preview-usage-note">Synthetic demo usage · illustrative token counts and costs, not real charges.</p>\n      <div id="usagebox"></div>',
);
replaceOnce(
  '<script src="js/office.js"></script>',
  '<script src="js/preview-seed.js"></script>\n    <script src="js/preview.js"></script>\n    <script src="js/office.js"></script>',
);
replaceOnce(
  "</head>",
  `<style>
      #preview-notice{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:start;gap:12px;border:1px solid #786745;border-radius:14px;background:#302b25;padding:12px 16px;margin:0 0 18px;color:#f6e6c8}
      #preview-info{min-width:0}#preview-info summary{font-size:14px;font-weight:700;cursor:pointer;min-height:44px;display:list-item;padding:7px 2px;line-height:1.4}#preview-info summary:focus-visible{outline:2px solid #f6e6c8;outline-offset:2px}
      body[data-agent-office-preview]:not(.offline) #connection-dot{background:var(--gold)}
      #preview-info p{font-size:13px;line-height:1.5;margin:4px 0 10px;max-width:760px}#preview-restore{margin-bottom:4px}#preview-run-locally{white-space:nowrap;text-decoration:none;align-self:start} .preview-usage-note{font-size:13px;color:#e6c58b;line-height:1.5}
      /* Native details puts its non-summary content in an anonymous wrapper.
         Flex/grid on details cannot lay out p and button as separate grid items.
         Keep the description and Restore control inline at desktop widths. */
      @media(min-width:681px){#preview-notice{padding:8px 12px;align-items:center}#preview-info[open]{display:block}#preview-info[open] summary{min-height:28px;padding:1px 2px;margin-bottom:3px}#preview-info[open] p{display:inline;margin:0;max-width:none;line-height:1.3}#preview-info[open] #preview-restore{display:inline-flex;margin:0 0 0 12px;padding:6px 10px;min-height:34px}}
      @media(max-width:680px){#preview-notice{gap:6px;padding:7px 10px;margin-bottom:10px}#preview-info summary{font-size:12px;min-height:44px;padding:7px 1px}#preview-run-locally{font-size:12px;padding:7px 9px;min-height:44px}#preview-info p{font-size:12px}}
    </style>\n  </head>`,
);
copies.set("index.html", Buffer.from(html));
copies.set("robots.txt", Buffer.from(publicRobots(siteBase)));

// Collect and validate everything before replacing a previous generated build.
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
      synthetic: true,
      backend: false,
      files: [...copies.keys()].sort(),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Built Agent Office 0.5.0 static demo with ${copies.size} public files in ${output}`,
);
console.log(
  `Node ${process.version}; no Python runtime, local office data or private aquarium artwork included.`,
);
