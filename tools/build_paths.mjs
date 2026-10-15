/* Shared filesystem boundary for the two public static builders. */
import fs from "node:fs";
import path from "node:path";

// Resolve only macOS's fixed system aliases, never user-controlled parents.
export function canonicalSystemPath(file) {
  if (process.platform === "darwin") {
    for (const [alias, target] of [
      ["/var", "/private/var"],
      ["/tmp", "/private/tmp"],
    ]) {
      if (
        (file === alias || file.startsWith(alias + path.sep)) &&
        fs.realpathSync(alias) === target
      )
        return target + file.slice(alias.length);
    }
  }
  return file;
}

// lstat also sees dangling links. Check every parent before reads or removal.
export function rejectSymlinks(file, kind) {
  let current = path.parse(file).root;
  for (const part of file.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    let entry;
    try {
      entry = fs.lstatSync(current);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (entry.isSymbolicLink())
      throw new Error(`Refusing symlinked ${kind} input/output: ${current}`);
  }
}
