#!/usr/bin/env node
/* Dependency-free, static-only public demo build. Does not read runtime data. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const marker = "preview-build.json";
const format = "agent-office-static-preview-v1";
const args = process.argv.slice(2);
if (args.length && !(args.length === 2 && args[0] === "--out")) {
  throw new Error(
    "Usage: node tools/build_preview.mjs [--out /path/to/new-preview-directory]",
  );
}
const output = path.resolve(args[1] || path.join(root, "dist"));
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
if (fs.existsSync(output)) {
  if (
    fs.lstatSync(output).isSymbolicLink() ||
    !fs.existsSync(path.join(output, marker)) ||
    JSON.parse(fs.readFileSync(path.join(output, marker), "utf8")).format !==
      format
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
const copies = new Map();
function collect(relative) {
  const source = path.join(root, "web", relative);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const name = path.join(relative, entry.name);
    if (entry.isSymbolicLink())
      throw new Error(`Refusing a symlink in public web assets: ${name}`);
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
      copies.set(name.split(path.sep).join("/"), data);
    }
  }
}
for (const directory of ["assets", "css", "js", "arcade"]) collect(directory);

const seed = JSON.parse(
  fs.readFileSync(path.join(root, "tools/fixtures/preview.json"), "utf8"),
);
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
let html = fs.readFileSync(path.join(root, "web/template.html"), "utf8");
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
        <div><strong>Interactive demo</strong><p>All agents, activity, XP and usage here are fictional. Preferences stay in this browser. Run Agent Office locally to observe your own sessions.</p></div>
        <div class="preview-actions"><button class="btn" id="preview-restore">Restore sample</button><a class="btn" href="https://github.com/NosytLabs/agent-office#start-locally" target="_blank" rel="noopener noreferrer">Run locally ↗</a></div>
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
      #preview-notice{display:flex;align-items:center;gap:16px;justify-content:space-between;border:1px solid #786745;border-radius:14px;background:#302b25;padding:14px 18px;margin:0 0 18px;color:#f6e6c8}
      #preview-notice strong{font-size:14px}#preview-notice p{font-size:13px;line-height:1.5;margin:4px 0 0;max-width:760px}.preview-actions{display:flex;flex-shrink:0;gap:8px}.preview-actions a{text-decoration:none}.preview-usage-note{font-size:13px;color:#e6c58b;line-height:1.5}
      @media(max-width:680px){#preview-notice{align-items:flex-start;flex-direction:column;padding:12px;margin-bottom:12px}.preview-actions{flex-wrap:wrap}}
    </style>\n  </head>`,
);
copies.set("index.html", Buffer.from(html));

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
