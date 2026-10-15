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

## Public package versus repository sources

`npm run build:preview` publishes runtime web files and the synthetic demo seed.
It keeps the compact Classic atlas, all 23 source sheets required by its fallback,
the public aquarium, compiled Studio tiles/manifests, character and companion
supplements, room surfaces, fonts, notices, and the playable arcade files.
Generation inputs remain available in the repository:

- `web/assets/sprites/studio/source/`: unchanged generated images and prompts;
- `web/assets/sprites/generated-*.json`: original generation/normalization records;
- `web/assets/sprites/asset-checksums.json`: the complete authoring checksum inventory;
- `web/arcade/duck-hunt/js/upstream.js`: the unchanged input to the verified timing patch.

The public package excludes those authoring inputs. Its copied attribution links
point to their repository locations; source notices stay untouched. Compiled
manifests retain their source hashes and fitting metadata. Brand and arcade
provenance, license text, and attribution notices remain public.

Both static builders use `tools/build_paths.mjs` to reject symlinked inputs,
output directories, parent directories, and build markers before replacing a
previous build. Normal macOS `/var` and `/tmp` system aliases remain supported;
other links cannot redirect publication reads or output replacement. Every input
is collected successfully before the old generated directory is removed.

The character activity supplement publishes `studio/character-life.png` and its
manifest: 72 native 32×36 typing, reading, and attention frames. The runtime adds
24 palette variants. Its original image and prompt JSON stay in `studio/source/`.
A missing or invalid activity supplement leaves the other Studio packs available;
Retry artwork restores it without reloading the page or its unsent drafts.

A same-input comparison on 15 October 2026, including the character activity
supplement, omitted 25 authoring files. The packaged build shrank from 146 files
and 25,052,300 bytes to 121 files and 15,376,620 bytes: about 9.7 MB (38.6%) before
compression. Both builds used one source snapshot; the control disabled only the
authoring-file exclusion. This measures packaged files, not initial browser
traffic, frame rate, or repository size. The larger Classic source sheets remain
available when the compact atlas cannot load.

Focused publication checks are:

```sh
python -m pytest -q tests/test_public_assets.py tests/test_preview_build.py
CHROMIUM_PATH=/absolute/path/to/chrome node --test tests/public-assets-browser.test.cjs
```

The browser check serves the actual generated demo on an isolated local static
server. It exercises compiled Studio supplements and PNG export, then forces a
missing compact manifest and verifies that all 23 Classic source sheets load.
It also boots the packaged Duck Hunt iframe from its derived game bundle without
publishing the preserved authoring bundle. Character-pack manifest, image, and
pixel-integrity failures exercise partial fallback and retry while preserving
unsent room/task drafts, the current document, and synthetic accounting.

## Maintainer tool inventory

Each tool below supports a current compiler, build, validation, or maintenance workflow.

| Tool | Supported purpose | Current consumer or verification |
| --- | --- | --- |
| `build_sprites.mjs` | Compile/check the Classic atlas through the real source loader. | `build:sprites`, CI `check:sprites`, and `tests/native-sprites.test.cjs`. |
| `build_studio_directional.mjs`, `build_studio_environment.mjs` | Compile/check Studio character, companion, and room supplements from retained originals. | `build:studio-sprites` and CI `check:sprites`; supplement model/browser tests check runtime use. |
| `build_preview.mjs`, `build_site.mjs` | Produce the synthetic demo and allowlisted product website. | CI `build:preview`, Pages workflow, and the generated-package browser tests. |
| `build_paths.mjs` | Share path validation between both static builders. | Imported by both builders; `tests/test_preview_build.py` and `tests/test_site_build.py` exercise redirected inputs/output and macOS aliases. |
| `generate_preview_fixture.py` | Rebuild the fictional preview seed through an isolated real event store. | `tests/test_preview_build.py` compares its output with the checked-in fixture; `docs/preview.md` documents regeneration. |
| `patch_duck_hunt.mjs` | Verify the pinned upstream bundle and regenerate the served game with two reviewed timing substitutions. | `tests/arcade.test.cjs` verifies exact source hash and derived bytes; the sandbox loads `js/game.js`. |
| `check_js.mjs`, `check_repository.py` | Check shipped JavaScript syntax and tracked repository/documentation hygiene. | CI `npm run check` and the Repository hygiene workflow. |
| `maintain.py` | Report local storage or explicitly compact retained SQLite observations. | `docs/architecture.md` and `tests/test_storage_maintenance.py`. |
| `import_smallburg.py` | Import the optional owner-licensed aquarium artwork into local storage. | `docs/aquarium-assets.md` and `tests/test_smallburg_import.py`. |

Keep these source and maintenance contracts when tidying the repository. A file
that is excluded from publication can still be required for fallback, attribution,
reproduction, or an explicitly supported local operation.
