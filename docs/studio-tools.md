# Native sprite tools and animation polish

In **Customize → Studio artwork**, open **Preview & download sprites**. Filter by
character, companion, furniture or effects; search by name; then inspect a native
image, play its animation or export a transparent PNG/animation strip. An empty
search result disables export instead of leaving an unrelated sprite selected.

The gallery combines 197 Studio entries with 41 generated animation/lighting
frames, making **238 sprite choices**. The new watering families add four frames
each for the succulent, fern and planter. They use the approved artwork, fixed
native dimensions and shared foot anchors. The source-defined droplets appear
only during an existing cosmetic watering reaction. Existing source sprites and
all observer, collision and furniture placement state remain unchanged.

Other four-frame families cover the server rack, coffee cart, water cooler, desk
robot, record player, terrarium and running task terminal; there is also an unlit
lamp. Server flicker is decorative, not uptime. Music and task-terminal animation
follow their existing playback/running states. Animated props fit the same
bottom-centered rectangle as static art, without nonuniform stretching.

**Play animation** is explicit, not automatic. Preview runs at four frames per
second, honors office Pause/reduced motion, and stops when the gallery or panel
closes, the tab is hidden, or the page is left. A downloaded strip contains four
adjacent native frames with no padding or resizing. Character/companion strips
repeat the middle walking pose to match the existing distance-driven cycle.

**Retry artwork** retries the atlas in place. It does not reload the page, discard
unsaved names or task drafts, reconnect the observer, or reset panel state. Two
simultaneous retries share one attempt. Tools, labels and gallery images refresh
once after success; failure keeps the original-art fallback and a usable retry.
Keyboard focus stays reachable during loading and moves to the status when the
successful retry control disappears.

No provider requests, approvals, observer events, usage or XP are generated.
Full four-direction chibi source art and project-specific rooms are not included.
See [Studio artwork](studio-art.md) for base-art provenance and limitations.

Run `npm test` and `npm run test:browser`. New regressions exercise unsaved drafts,
concurrent recovery, one tool installation, preserved accounting, search/export,
actual native PNG dimensions, preview cleanup, mobile bounds, unique watering
frames and the actual room draw call. Existing original-art assertions are kept.
