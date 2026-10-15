# Native sprite tools and animation polish

In **Customize → Studio artwork**, open **Preview & download sprites** to inspect
native images and export an individual transparent PNG. The gallery includes the
197 existing Studio entries and 29 new source-defined variants. Each animation
family retains its original dimensions and anchor; source images are never
independently rescaled between frames.

The new images are four-frame variations of the server rack, coffee cart, water
cooler, desk robot, record player, terrarium and running task terminal, plus an
unlit lamp. They are generated once from the existing approved artwork when the
Studio atlas loads, not redrawn into new canvases on every animation frame.

Coffee/water/robot/terrarium loops require an existing room reaction (or existing
unlocked cosmetic). The record player follows music playback. The terminal loop
requires the existing running-state image. Server flicker is decorative and is
not an uptime or progress indicator. Pause keeps a stable frame; original-art
mode retains the original renderer.

This change also keeps the crown above the character when walking left, makes
companion labels match the chosen look, and offers **Reload artwork** after an
asset load failure. Recovery reloads the view; it does not clear saved office
settings or browser preferences. It can discard unsaved form input just like a
normal page reload.

No new observer events, model calls, approvals, usage, XP or remote permissions
are created by these presentation tools. The original atlas is unchanged. See
[Studio artwork](studio-art.md) for the underlying artwork and its limitations.

Run `npm test` and `npm run test:browser` for the added pure-model and real-observer
browser checks. The browser tests cover transformed crown positions, unique
same-sized frames, asset-failure recovery, matching labels, mobile panel bounds,
actual PNG download dimensions and unchanged accounting.
