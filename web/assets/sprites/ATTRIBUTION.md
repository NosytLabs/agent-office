# Sprite Assets

Character and pet sheets adapted from [pixel-agents](https://github.com/pixel-agents-hq/pixel-agents) by Pablo De Lucca — MIT License.

- Character sheets (`characters/char_0..5.png`): 112×96 PNG, 3 direction rows (down/up/right) × 7 frames of 16×32. Col 0 = idle, cols 1–6 = walk. No left row — mirror right.
- Pet sheets (`pets/claudio.png`, `pets/gitcat.png`): 96×96 = 6 cols × 3 rows of 16×32. Col 0 = idle, cols 1–5 = walk (col 6 does not exist).
- Furniture in use (8): BIN, COFFEE, CACTUS, LARGE_PLANT, SOFA_FRONT, DOOR, BOOKSHELF, PACKAGE. All rendered via `drawDecorImg` except PACKAGE (drawn by `drawVisitors`).
- Retired/deleted: PLANT.png, WHITEBOARD.png, CLOCK.png (procedural clock in `office.js` reads better at wall scale).
