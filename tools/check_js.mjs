import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Syntax check every shipped JS module, including newly added UI features.
for (const directory of ["web/js", "vscode", "opencode", "tools", "site"]) {
  for (const file of readdirSync(directory).filter((name) =>
    /\.(js|mjs|cjs)$/.test(name),
  )) {
    const result = spawnSync(
      process.execPath,
      ["--check", join(directory, file)],
      { stdio: "inherit" },
    );
    if (result.status !== 0) process.exit(result.status || 1);
  }
}
console.log("All shipped JavaScript syntax checks passed.");
