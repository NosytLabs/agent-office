# Adi52 Duck Hunt upstream notice

This directory contains a locally embedded adaptation of
[`Adi52/duck-hunt`](https://github.com/Adi52/duck-hunt) pinned to commit
[`a4502ff12a5f79853ed181fc93680863ddde0b4e`](https://github.com/Adi52/duck-hunt/commit/a4502ff12a5f79853ed181fc93680863ddde0b4e).
The upstream `package.json`, preserved here as `upstream-package.json`, declares
the package license as `ISC`. The upstream repository does not contain a
standalone license text at this commit.

The upstream README says that all sounds came from the original Duck Hunt game.
It does not provide separate provenance or a separate license for those audio
files, sprite sheets, game logo, or background images. This notice records that
known limitation and does not characterize those assets as independently
licensed under ISC.

Agent Office preserves the pinned production bundle as `js/upstream.js` and
generates the served `js/game.js` deterministically with
`tools/patch_duck_hunt.mjs`. The patch verifies the pinned bundle SHA-256 and
requires exactly two known source expressions before replacing the dog's
inverse-delta horizontal movement with equivalent linear delta-time movement.
The constants preserve the upstream movement at 60 frames per second while
preventing the intro from stalling on slower frames. The two source-derived
substitutions are:

- walking: `20 / deltaTime` becomes `0.072 * deltaTime`;
- jumping: `50 / deltaTime` becomes `0.18 * deltaTime`.

Agent Office also changes the embedding and lifecycle boundary:

- the upstream production JavaScript bundle is preserved byte-for-byte as
  `js/upstream.js`;
- the browser loads the derived `js/game.js` runtime described above;
- the selected upstream PNG and MP3 files are preserved byte-for-byte;
- external Google Fonts, Font Awesome, and the remote mobile-demo GIF were
  removed;
- the fixed canvas scales within a responsive local iframe;
- `lifecycle.js` starts the animation loop only after an explicit host action,
  pauses it when the host panel or page is hidden, scopes input to the sandboxed
  iframe, gates audio through the Agent Office sound preference, and shortens
  the decorative five-second loader delay;
- the iframe uses `sandbox="allow-scripts"` without same-origin access and all
  lifecycle messages carry a per-load nonce.

Upstream source and gameplay description:

- Repository: https://github.com/Adi52/duck-hunt
- Pinned source: https://github.com/Adi52/duck-hunt/tree/a4502ff12a5f79853ed181fc93680863ddde0b4e
- README sound statement: https://github.com/Adi52/duck-hunt/blob/a4502ff12a5f79853ed181fc93680863ddde0b4e/readme.md#sounds
