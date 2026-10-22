# Studio artwork

Open **Customize → Studio artwork**, beside Layout & atmosphere. Choose Studio
pixel art or Original artwork, warm oak / blue slate / original room finish,
optional autumn/winter wall decorations, and the
look of each existing companion slot. These browser preferences are separate for
the hosted demo and local observer. They do not alter another browser's settings.

## Artwork and behavior

Workstations are physical scenery, including in an empty or filtered office.
**Desks per row** sets the desktop column count; narrow floors use two. New
sessions fill those stations without recentering established desks. Empty desks
have no agent, status label, selectable session, activity, or XP. Both vacant and
occupied desks reserve space for furniture placement and walking routes. The
connection card sits below the canvas so room objects remain reachable.

The 512 by 323 native atlas has 168 source entries: 54 character poses, 56 companion
poses, 29 props, 13 icons and 16 effect frames. Two human palette variants add 18
canvases. Eleven additional native prop/state entries are drawn once at load time
by `addStudioDetails()` in `web/js/studio.js`, making 197 available sprite entries.
The supplementary directional atlas adds 72 generated walking frames for the six
base identities and 24 matching palette variants, stored separately from the base
set. Each character look has front, back, left and right views with three walking
poses. Frames retain the existing 32 × 36 canvas and bottom-center anchor. Walking
uses distance traveled and freezes on Pause/reduced motion; activity portraits
and the original base poses remain available.
The additional artwork covers the succulent, planter, desk robot, attention beacon,
door and task terminal, including idle, running, finished, failed and disconnected
terminal states. The base task-terminal entry shares its idle-state canvas.

Movement uses distance-driven walk frames. Reading and human-input poses use
reported activity. A 72-frame character activity sheet adds four-frame typing, reading
and attention loops for the six base identities; two palette variants add another
24 frames. These 32 × 36 poses keep their bottom-center anchor and run only while
stationary. Typing runs at four frames per second, reading and attention at two.
Pause and reduced motion hold frame zero. A separate 72-frame reaction sheet
(96 with palette variants) adds occasional idle blinks, gentle completion waves
and calm error gestures. These use the existing reported poses: they do not infer
successful work or repair a reported failure. Shell work retains its waiting pose.
Typing hands are drawn over the existing desktop, rather than
adding a second baked-in desk. Four cat looks, three dogs and a pocket robot use
the existing two companion slots; the second slot keeps its original unlock.
Coffee, watering and sparkle effects remain cosmetic.
The optional eight-frame lounge pack adds a warm lampshade pulse and terrarium
leaf/glass variations. Frame zero is the original seed; all frames keep its exact
alpha silhouette and native anchor. Lights off uses the existing dim lamp and
Pause/reduced motion holds frame zero. Terrarium motion keeps its existing
interaction/unlock rules. The new frames appear in the searchable gallery and
strip export; Retry artwork restores this pack independently of other artwork.
Artwork manifests are reread on load/retry. Image URLs include the manifest's
pixel digest so an updated atlas cannot be paired with a previously cached PNG.
Integrity checks remain enabled. Loading errors are available in the status
tooltip for reporting a failed pack.
Studio and gallery styles load with the initial document, before artwork can
publish interactive controls. Delayed art cannot expose an unstyled preview or
change the short-screen layout after playback has scrolled into view.
Studio's animated prop families and task-terminal states own their detail layer
and do not receive the Original renderer's extra eyes, lights or reaction pixels.
Room-light overlays and the beacon's observed-input signal remain available.
If running-state terminal artwork is unavailable, the fallback retains its
activity lamp.
If the optional arcade animation pack is unavailable, the Studio cabinet retains
its static screen and marquee without Original-mode effects painting over them.
Completed and ended characters share Original's observed-age fade, including
when the artwork choice changes.
Watering keeps Studio plant pots on their original anchor. Status marks are
centered over the seated character; a completion carrying a reported failure
shows a warning instead of a success check.
The attention beacon opens the next observed agent needing input, just like the
Needs input control. **Customize → Room interactions → Inspect attention beacon**
provides the same keyboard action when a beacon is placed. An empty or disconnected
office gives feedback instead of opening unrelated activity.
A newly observed completed subagent can send a parcel to its parent; bootstrap,
reconnect, removal, missing parents and observed errors do not create successful handoffs.

Studio portraits and editor thumbnails follow the same artwork choice.
Clicking a pet bed opens Customize at the first companion name field, with
keyboard focus and both its label and input below the fixed panel header.
Existing cards reuse their pixels until the appearance changes; source changes cause one
portrait repaint rather than native and studio repaints in sequence. Artwork
controls do not displace the established reset/export keyboard order. Focused
notifications retain keyboard access and resume their expiry after focus leaves.

The companion supplement adds 96 original frames: eight looks, four headings and
three walk poses at 28 × 26 pixels, anchored at (14,25). Heading follows actual
travel. A second 96-frame sheet adds calm blink/ear motion, sleeping/breathing and
happy tail/wave loops to all eight looks. Idle blinking is occasional, sleeping
motion is slow, and happy reactions use the existing affection state. Pause and
reduced motion use still poses; these loops do not alter pet movement or rewards.
The earned sofa sleeper uses the same chosen look. Four 128 × 128 room
surfaces provide oak/slate floors and matching plaster walls. A cached repeat
pattern preserves geometry, room lighting and object interactions. Original theme
remains selectable. The searchable gallery contains 730 entries in total.
An eight-frame prop supplement adds a quiet arcade attract loop and a printer
paper-feed reaction. The printer opens latest Activity by pointer or the
keyboard-accessible room action. These animations create no work events. Both
families start with their exact shipped idle sprite and freeze on Pause or
reduced motion. Their optional pack falls back and retries independently.

## Compatibility

The original compact atlas, source sheets, geometry, pathfinding and editor rules
remain intact. Missing or invalid studio resources fall back to the original
artwork as a complete set. No new runtime dependency or frontend build is required.
The supplementary walking sheet was created with the built-in image-generation
tool using the existing Studio strips as style and identity references. Its
unmodified source, full prompt, source checksum and reviewed crop bounds are in
`web/assets/sprites/studio/source/` and `directional.json`. The compiler fits each
identity with one shared scale and nearest-neighbor sampling. Run
`node tools/build_studio_directional.mjs --check` to reproduce all 72 native frames;
this is also part of `npm run check:sprites`. The environment compiler
`node tools/build_studio_environment.mjs --check` also reproduces all 192 companion
walking/life frames, 72 character activity frames, 72 character reaction frames
eight prop frames and four seamless surface tiles from their preserved source and full
prompts. The surface compiler reflects reviewed tiles to match opposite edges.

If any supplementary sheet is unavailable or fails validation, the base artwork
remains usable and **Retry artwork** restores optional artwork in place without
discarding drafts. Directional frames also appear in the searchable sprite gallery
and export as native PNGs or four-frame strips. Supplementary packs load
concurrently and recover independently; diagnostics identify an unavailable pack.
Their small manifests finish before the larger image downloads begin, preventing
image transfers from starving a queued manifest on a cold connection.
Their larger images allow up to 30 seconds for a slow transfer while the original
scene remains usable. Small base tiles and manifest requests have 15-second
limits. A failed or stalled supplement still falls back and offers Retry artwork.

Animations never submit prompts, answer approvals, call models, grant XP or change
token/cost accounting. Seasonal ornaments are decorative wall art rather than
independently placeable furniture. The handoff indicates reported completion,
not verified code quality. Characters and companions include four-direction walking. Original artwork retains its existing
directional frames. Aquarium and arcade art retain
their separate loaders and notices. Project-specific rooms and autonomous agent
coffee trips are not implemented by this presentation layer.

## Verification

Run the existing checks:

```sh
python3 -m pytest -q
npm test
npm run check
npm run format:check
npm run test:browser
npm run check:sprites
npm run build:preview
```

The browser command first runs the compatibility suite in Original artwork mode
using `tests/classic-artwork-preload.cjs`. This keeps its original pixel-identity,
source-failure and directional-animation assertions meaningful. It then runs the
Studio suite separately, without that preload. No existing assertions are removed.

The Studio browser tests cover preferences, mobile bounds, fallback, reduced
motion, new-event handoffs, unchanged accounting and focused notification lifetime.
They additionally verify all eleven generated detail entries, five distinct
terminal state images, single-repaint portrait caching, and inspector appearance
changes against the actual Studio pixels. Fixtures use synthetic events through
real local observer servers; no agent CLIs are authenticated or launched.

Existing notices: [asset attribution](../web/assets/ATTRIBUTION.md).
Atlas inventory: [studio assets](../web/assets/sprites/studio/README.md).
