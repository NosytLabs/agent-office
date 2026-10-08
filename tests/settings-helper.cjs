/* Setup writes use the same conditional-save contract as an office view. */
async function postSettings(request, url, options = {}) {
  const current = await request.get(url);
  const etag = current.headers().etag;
  if (!current.ok() || !etag)
    throw new Error("Settings setup requires a readable revision");
  return request.post(url, {
    ...options,
    headers: { ...options.headers, ...(etag ? { "If-Match": etag } : {}) },
  });
}

async function fetchSettings(url, options = {}) {
  const current = await fetch(url);
  const etag = current.headers.get("etag");
  if (!current.ok || !etag)
    throw new Error("Settings setup requires a readable revision");
  return fetch(url, {
    ...options,
    headers: { ...options.headers, ...(etag ? { "If-Match": etag } : {}) },
  });
}

module.exports = { postSettings, fetchSettings };
