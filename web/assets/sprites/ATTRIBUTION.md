# Sprite Assets

Character and pet sheets adapted from [pixel-agents](https://github.com/pixel-agents-hq/pixel-agents) by Pablo De Lucca — MIT License.

- Character sheets: 112×96 PNG, 3 direction rows (down/up/right) × 7 frames of 16×32.
- Pet sheets: 96×96 (walk/idle rows, left = horizontal flip).

Furniture sprites in active use: BIN, COFFEE, CACTUS, LARGE_PLANT, SOFA_FRONT, DOOR, BOOKSHELF, PACKAGE (delivery visitor's parcel) — all rendered via `drawDecorImg` in `office.js` except the parcel, which `drawVisitors` draws directly. Unused sheets (PLANT, WHITEBOARD) were dropped from the preload list; wall clocks are procedural in `office.js` (CLOCK.png dropped — it read as noise at wall scale). SOFA_FRONT was redrawn in-repo (sage/walnut two-cushion).
