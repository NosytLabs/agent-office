# Studio artwork

Open **Customize → Studio artwork**, beside Layout & atmosphere. Choose Studio
pixel art or Original artwork, optional autumn/winter wall decorations, and the
look of each existing companion slot. These browser preferences are separate for
the hosted demo and local observer. They do not alter another browser's settings.

## Artwork and behavior

The 512 by 323 native atlas has 168 source entries: 54 character poses, 56 companion
poses, 29 props, 13 icons and 16 effect frames. Two human palette variants add 18
canvases. Eleven additional native prop/state entries are drawn once at load time
by `addStudioDetails()` in `web/js/studio.js`, making 197 available sprite entries.
The additional artwork covers the succulent, planter, desk robot, attention beacon,
door and task terminal, including idle, running, finished, failed and disconnected
terminal states. The base task-terminal entry shares its idle-state canvas.

Movement uses distance-driven walk frames. Reading and human-input poses use
reported activity. Typing hands are drawn over the existing desktop, rather than
adding a second baked-in desk. Four cat looks, three dogs and a pocket robot use
the existing two companion slots; the second slot keeps its original unlock.
Coffee, watering and sparkle effects remain cosmetic. A newly observed completed
subagent can send a parcel to its parent; bootstrap, reconnect, removal, missing
parents and observed errors do not create successful handoffs.

Studio portraits and editor thumbnails follow the same artwork choice. Existing
cards reuse their pixels until the appearance changes; source changes cause one
portrait repaint rather than native and studio repaints in sequence. Artwork
controls do not displace the established reset/export keyboard order. Focused
notifications retain keyboard access and resume their expiry after focus leaves.

## Compatibility

The original compact atlas, source sheets, geometry, pathfinding and editor rules
remain intact. Missing or invalid studio resources fall back to the original
artwork as a complete set. No new runtime dependency or frontend build is required.
The new deterministic sprites are source-defined artwork, not new AI-generated
image sheets. The approved generated sheets remain the source for the main atlas.

Animations never submit prompts, answer approvals, call models, grant XP or change
token/cost accounting. Seasonal ornaments are decorative wall art rather than
independently placeable furniture. The handoff indicates reported completion,
not verified code quality. Full four-direction chibi art is not included; Original
artwork retains its existing directional frames. Aquarium and arcade art retain
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
