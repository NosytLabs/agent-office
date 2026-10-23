/* Shared filesystem and public-URL boundaries for the static builders. */
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

// A configured production address, never an inferred branch-preview hostname.
export function publicSiteBase() {
  const raw =
    process.env.AGENT_OFFICE_SITE_URL ??
    "https://agent-office-preview-seven.vercel.app/about/";
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      "AGENT_OFFICE_SITE_URL must be an absolute HTTPS directory URL.",
    );
  }
  if (
    /[\s?#]/.test(raw) ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "AGENT_OFFICE_SITE_URL must use HTTPS without credentials, whitespace, query or fragment.",
    );
  }
  url.pathname = url.pathname.replace(/\/+$/, "") + "/";
  return url.href;
}

export function publicRobots(siteBase) {
  // Allow crawling so crawlers can see the demo's noindex meta directive.
  return `User-agent: *\nAllow: /\nSitemap: ${siteBase}sitemap.xml\n`;
}
