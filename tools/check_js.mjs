import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Syntax check every shipped JS module, including newly added UI features.
function checkDirectory(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = entry.name;
    if (entry.isDirectory()) {
      if (!["node_modules", ".git"].includes(file))
        checkDirectory(join(directory, file));
      continue;
    }
    if (!/\.(js|mjs|cjs)$/.test(file)) continue;
    const result = spawnSync(
      process.execPath,
      ["--check", join(directory, file)],
      { stdio: "inherit" },
    );
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
for (const directory of [
  "web/js",
  "web/arcade",
  "vscode",
  "opencode",
  "tools",
  "site",
])
  checkDirectory(directory);
console.log("All shipped JavaScript syntax checks passed.");
