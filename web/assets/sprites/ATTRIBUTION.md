# Sprite sources and runtime contract

## Moss engineer and Orbit courier

`characters/moss-engineer.png` and `characters/orbit-courier.png` are original
1536 × 1024 RGBA atlases generated for Agent Office on 2026-10-08 with the
built-in ImageGen tool. The raw files are preserved. Each contains seven
columns and three direction rows: down, up, and right. Walking uses columns
0–2, typing uses 3–4, and reading uses 5–6. The renderer mirrors right-facing
walks for left movement, trims each frame above alpha 32, and uses one shared
scale with a bottom-center foot anchor in the existing 16 × 32 runtime cells.

Moss engineer wears a green utility jacket and headphones; Orbit courier is a
cream and orange robot. Both are selectable per agent, using the same saved
appearance preferences and fallback behavior as the existing characters.
No third-party art was supplied to their generation. All 21 cells in each
source were checked for nonempty, contained silhouettes. Exact prompts,
source checksums, dimensions, alpha bounds, and normalization contracts are in
[generated-moss-engineer.json](generated-moss-engineer.json) and
[generated-orbit-courier.json](generated-orbit-courier.json).

## Existing character and pet assets

Retained from this repository's existing Pixel Agents adaptation. Upstream:
[Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents), Pablo De Lucca,
MIT. The upstream copyright and permission notice is preserved in
[PIXEL-AGENTS-LICENSE.txt](PIXEL-AGENTS-LICENSE.txt). Pixel Agents credits
[JIK-A-4 / Metro City](https://jik-a-4.itch.io/metrocity-free-topdown-character-pack)
for the character artwork.

- `characters/char_0.png` through `char_5.png`: 112 × 96; 16 × 32 cells; three direction rows: down, up, right. Mirror right for left.
- **Columns 0, 1, 2 are walking frames.** Walk sequence: 0, 1, 2, 1. Columns 3–4 are typing; 5–6 are reading. The previous attribution incorrectly described all six non-idle columns as walking.
- `pets/claudio.png`, `pets/gitcat.png`: 96 × 96 pet sheets. The current room uses the front idle frame, not unverified animation ranges.
- `pets/sleep_cat.png`: 24 × 16 sleeping cat.

The animation contract was checked against the upstream
[sprite mapping](https://github.com/pixel-agents-hq/pixel-agents/blob/main/webview-ui/src/office/sprites/spriteData.ts).
No new character sheets were downloaded in this audit.

## Existing furniture

`DOOR` and `FISH_TANK` PNGs are
retained project assets. Repository history records furniture redesigns in
commits `22f45f0` and `6421fcb` (the latter describes PixelLab furniture).
They are not newly sourced from the reference landing page. The original
project license remains unchanged; no independent provider-license review
was performed in this audit.

Replaced utility sprites, unused furniture, idle-pet copies, and NPC sheets were removed from the
working tree; their prior versions remain available in Git history.

## New generated atlas

`furniture/studio-atlas.png` was generated for this project on 2026-10-03
using OpenAI's built-in image-generation tool. It is an RGBA PNG, **1254 ×
1254**, arranged in four equal quadrants: sofa, server rack, low bookcase,
and monstera. It was generated from a written prompt, without copying
reference-site artwork.

The exact prompt, grid, dimensions, and processing contract are in
[generated-atlas.json](generated-atlas.json). Source bytes remain intact.
At load time, `scene.js` finds the alpha bounds above threshold 32 in each
quadrant, then resamples each object once onto its logical pixel canvas.
Source alpha, nonempty cells, loaded sprites, and browser scenes were
inspected. `asset-checksums.json` identifies the final PNG files.

Logical sizes are 40 × 28 (sofa), 20 × 32 (server), 34 × 28 (shelf), and
26 × 32 (monstera). The atlas contains decoration, not animation frames.

## Matching utility atlas

`furniture/utilities-atlas.png` was generated for this project on 2026-10-03
using OpenAI's built-in image-generation tool. The unmodified 1254 × 1254
RGBA source has four quadrants: coffee cart, water cooler, floor lamp, and
wall clock. It uses the same alpha-bound normalization as the studio atlas.
The written prompt did not include reference-site artwork.

Logical sizes are 20 × 26 (coffee), 12 × 26 (cooler), 12 × 30 (lamp), and
10 × 10 (clock). The first three are placeable; the clock decorates the wall.
See [generated-utilities.json](generated-utilities.json) for the prompt and
contract, and [asset-checksums.json](asset-checksums.json) for source hashes.
All twenty-six placeable props have previews made from the actual runtime sprite.

## Matching cafe and plant atlas

`furniture/decor-atlas.png` was generated for this project on 2026-10-03
using the built-in ImageGen tool. Its unmodified 1254 × 1254 RGBA source has
four quadrants: walnut cafe table, sage stool, cream-potted succulent, and
terracotta planter. It was generated from a written prompt without copied
reference artwork. Logical sizes: 28 × 24, 16 × 18, 12 × 16, and 32 × 18.
See [generated-decor.json](generated-decor.json) for the exact prompt and
[asset-checksums.json](asset-checksums.json) for the source checksum.
Source transparency and all four runtime-normalized cells were visually
inspected. Desktop/mobile scene evidence for this atlas was rendered in a
CPU canvas in the preceding audit. The 2026-10-07 browser pass also verifies
placement, persistence, removal, and populated catalog previews for these props.

## Workshop atlas

`furniture/workshop-atlas.png` was generated for this project on 2026-10-07
using OpenAI's built-in image-generation tool. The original **1254 × 1254
RGBA PNG** is preserved without offline image edits. Its four equal quadrants
are a planning board, printer cabinet, supply cart, and coat rack. The written
prompt uses the existing room's navy, walnut, cream, and sage palette; no
reference-site artwork was supplied to generation.

| Runtime key | Furniture | Logical size |
| --- | --- | --- |
| `whiteboard` | Planning board | 34 × 32 |
| `printer` | Printer cabinet | 24 × 24 |
| `cart` | Supply cart | 28 × 25 |
| `coatrack` | Coat rack | 16 × 34 |

The loader uses the same alpha-bound trimming and nearest-neighbor resampling
as the other atlases. Faint alpha=1 source speckles stay outside the trim
bounds; all four visible objects fit fully within their cells. The source
image and normalized in-browser sprites were visually inspected. All four
props are available in Customize, retain their saved positions after reload,
and use the existing collision, move, undo/redo, and responsive placement code.

The exact prompt, source dimensions, conservative alpha bounds, and source
hash are in [generated-workshop.json](generated-workshop.json). The complete
runtime inventory is recorded in [asset-checksums.json](asset-checksums.json).

## Earned furniture, jukebox, and public aquarium

The four objects in `furniture/rewards-atlas.png` are original generated art:
an arcade cabinet (24 × 34), record player (28 × 22), desk robot (18 × 28),
and terrarium (24 × 28). Their placement controls unlock from recorded work.
Screen, eye/arm, record-player, and firefly motion is drawn by the scene and
obeys the office pause control. The original atlas is preserved; see
[generated-rewards.json](generated-rewards.json) for the exact prompt,
source-reference disclosure, dimensions, alpha bounds, and checksum.

`furniture/jukebox.png` is a separate original generated 1024 × 1536 RGBA
sprite, normalized to 24 × 36. The jukebox and record player open one shared
music panel. Its three original melodies are synthesized locally in
`web/js/jukebox.js`; no third-party recordings are distributed. See
[generated-jukebox.json](generated-jukebox.json).

`aquarium/original-fish.png` is an original generated 1254 × 1254 RGBA atlas
containing a goldfish, guppy, betta, and angelfish. The unmodified source is
sampled through explicit regions in [aquarium/manifest.json](aquarium/manifest.json)
so that the betta's fins are not clipped by equal-quadrant assumptions. These
are still sprites; swimming, turns, food chasing, and bubbles are animated
in code. See [generated-aquarium.json](generated-aquarium.json).

The optional Smallburg art from the owner's Little Current checkout is
**not distributed here**. Its notice prohibits redistributing asset files.
The [local importer](../../../docs/aquarium-assets.md) preserves original
bytes and the accompanying license outside this source tree. Its native
four-frame animation has been tested separately. Public screenshots and
the hosted demo use only the original generated fish.

## Studio assistant and workstation finishes

`characters/studio-assistant.png` is an original **1536 × 1024 RGBA**
animation atlas generated on 2026-10-08 with the built-in ImageGen tool.
It contains 21 poses in seven columns and three rows: down, up, and right;
the renderer mirrors right-facing frames for left movement. Columns use the
existing idle/walk, typing, and reading contract. The source bytes remain
unchanged. At load time, the renderer trims each frame at alpha > 32, uses
one shared scale for all poses, and anchors their feet at the bottom center
of a 16 × 32 cell. This removes the raw sheet's uneven transparent padding
without stretching individual poses. Delegated sessions use this character
by default; the People setting selects the existing character sheets.

`furniture/workstations-atlas.png` is an original **1254 × 1254 RGBA**
atlas generated on the same date. Its four quadrants contain walnut and
slate desk slabs (40 × 14 logical pixels), a focus booth (30 × 38), and a
filing cabinet (22 × 26). The slabs replace the desktop surface while keeping
the existing monitor, character, chair, and leg layering. The two placeable
objects use the shared furniture collision and responsive layout rules.

No third-party image was supplied for either atlas. A targeted ImageGen edit
kept the booth fully inside its source quadrant; the corrected PNG is
preserved without offline raster edits. Exact prompts, dimensions, hashes,
per-cell alpha bounds, and normalization contracts are recorded in
[generated-studio-assistant.json](generated-studio-assistant.json) and
[generated-workstations.json](generated-workstations.json).

## Task terminal, status beacon, pet bed, and fern

`furniture/signals-atlas.png` is an original **1254 × 1254 RGBA** atlas
generated on 2026-10-08 with the built-in ImageGen tool. It contains four
complete objects in equal quadrants. No third-party image was supplied, and
the generated PNG bytes are preserved unchanged. The runtime trims each cell
at alpha > 32 and samples it onto its logical canvas with nearest-neighbor
scaling.

| Runtime key | Furniture | Logical size | Interaction |
| --- | --- | --- | --- |
| `taskterminal` | Task terminal | 24 × 34 | Opens the existing Reported tasks view |
| `statusbeacon` | Status beacon | 12 × 28 | Opens Session activity; amber means an observed waiting session while connected |
| `petbed` | Pet bed | 26 × 16 | Provides a reachable resting target and opens pet settings |
| `fern` | Office fern | 26 × 28 | Decoration |

The terminal cursor is ambient motion. The beacon does not invent work or
infer that a quiet session needs permission. Scene pause freezes their small
animation overlays. Placement uses the shared collision and responsive layout
rules; pet routing admits the bed surface while retaining other obstacles.
The exact prompt, source checksum, alpha bounds, and normalization contract
are recorded in [generated-signals.json](generated-signals.json).

## Local task console states

`furniture/task-console-atlas.png` is an original **1254 × 1254 RGBA**
state atlas generated on 2026-10-08 with OpenAI's built-in image-generation
tool. Its equal quadrants contain the same standing retro task console in
idle, running, finished, and disconnected states. The generated PNG is
preserved without raster edits and no third-party artwork was supplied.
At runtime each cell is trimmed at alpha > 32 and normalized once to the
existing task terminal's 24 × 34 logical canvas. The original
`signals-atlas.png` terminal remains the deterministic artwork fallback if the
four-state image cannot load. Local-run routing still follows the reported
capability state. When local execution is disabled, observer-only offices use
the original art and continue to open Reported tasks. “Finished” records only
that the newest completed local process exited successfully; it does not imply
that the resulting work was reviewed or verified. Failed exits keep the neutral
console with a steady error lamp, while cancelled and interrupted exits return
to idle. The source states are steady sprites. A running process gets a small
two-frame activity lamp that obeys Pause and reduced motion; there is no
celebration or perpetual success effect.
See [generated-task-console.json](generated-task-console.json) for the exact
prompt, source bounds, state semantics, normalization contract, and checksum.
