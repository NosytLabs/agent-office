# Sprite assets

## Runtime versus authoring artwork

The office loads `web/assets/sprites/runtime/manifest.json` and `runtime/office.png`
on startup. The atlas contains 47 rendered sprites from 23 preserved source
sheets: the six people, three additional characters, pets, furniture, and task
console states. The separate aquarium loader still handles original fish and
the owner's optional licensed Smallburg pack.

The native files use the same pixels, dimensions, animation frames, and grounded
character anchors as the source loader. Source artwork, generation records,
checksums, and license notices stay in the repository. Do not delete or recompress
those originals to make the runtime download smaller.

A missing, malformed, incorrectly sized, or stalled native atlas falls back to
the original source loader. Fetch and image loading each have a five-second
limit. The loader publishes the complete native set only after validation; it
does not expose a partially populated replacement set. Browser diagnostics are
available at `officeScene.spriteAssetSource` (`loading`, `native`, or `source`).

## Regenerate and verify

From the repository root:

```sh
npm ci --ignore-scripts
npx playwright install chromium
npm run build:sprites
npm run check:sprites
```

Linux machines without browser system libraries also need
`npx playwright install-deps chromium`. These are maintainer tools only: running
Agent Office still requires Python 3.10+, with no npm installation or browser
build step. Existing `CHROMIUM_PATH` configuration is supported.

The compiler uses the actual `OfficeScene.loadSourceAssets()` normalization path
in an isolated browser with GPU acceleration disabled. CPU canvas rendering
keeps source normalization independent of the local graphics driver's rounding;
the compiler does not use a second resampling implementation. It writes the PNG,
source-hash manifest, and runtime entry in `asset-checksums.json`. It does not read
local observer data or private aquarium sheets. `--check` is read-only, verifies
every source hash and rectangle, compares decoded pixels instead of PNG encoder
bytes, and checks the shipped PNG's checksum.

Run the normal Python and browser suites after changing source artwork. The
native-sprite browser test compares every compiled sprite and every character
anchor against fresh source normalization using the compiler's CPU canvas
backend. Other browser flows and the invalid-atlas fallback case retain Chrome's
default graphics backend. Missing-source tests force the fallback path, so they
continue to test genuine source failures.

## Measured scope

The initial office source sheets total 11,889,720 bytes. This revision's compact
PNG and manifest total 179,274 bytes before transport compression, about 98.5%
less sprite data. This is a startup-asset comparison, not a measurement of total
page size, frame rate, repository size, or aquarium loading. Source fallback
still loads the larger originals when needed.
