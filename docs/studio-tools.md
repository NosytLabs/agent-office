# Native sprite tools and animation polish

In **Customize → Studio artwork**, open **Preview & download sprites**. Filter by
character, companion, furniture or effects; search by name; then inspect a native
image, play its animation or export a native PNG/animation strip. An empty
search result disables export instead of leaving an unrelated sprite selected.

Choices and preview descriptions use appearance names and actions, such as
“Orange cat · Happy” and “Studio robot · Reading”. Search those names or the
original sprite IDs. `pet 0 happy anim` finds that companion's four happy frames;
its identity number cannot match another companion's frame number. `frame 3`
uses the displayed frame numbering, while `anim 2` retains the original source
index. Free terms and category filters still combine. Download filenames keep
their original sprite IDs.

The gallery combines 197 base Studio entries, 96 directional character frames and
96 companion directional frames, 96 companion life frames, 96 character life
frames, 96 character reaction frames, four room surfaces, eight generated prop
frames and 41 procedural animation/lighting frames, making **730 sprite choices**
when every pack is available. The count follows the loaded
artwork; an unavailable optional pack removes only its choices. The watering
families add four frames each for the succulent, fern and planter. They use the
approved artwork, fixed native dimensions and shared foot anchors. The
source-defined droplets appear
only during an existing cosmetic watering reaction. Existing source sprites and
all observer, collision and furniture placement state remain unchanged. A verified
disconnected fragment is removed from the decoded fern canvas only; the original
PNG is preserved. Static artwork, editor thumbnails and watering frames use the
same cleaned canvas.

Other four-frame families cover the server rack, coffee cart, water cooler, desk
robot, record player, terrarium and running task terminal; there is also an unlit
lamp. Server flicker is decorative, not uptime. Music and task-terminal animation
follow their existing playback/running states. Animated props fit the same
bottom-centered rectangle as static art, without nonuniform stretching.
The arcade has a quiet two-frame-per-second attract loop. The printer feeds paper
only after interaction, and opens the latest Activity view. The room action
**Read activity at printer** provides the same route by keyboard when a printer is
placed. These are cosmetic responses, not print jobs or reports of agent work.
Both four-frame strips retain their exact native dimensions: 96 × 34 for the
arcade and 96 × 24 for the printer. Their first frames match the shipped idle
sprites. Missing prop artwork retains the static sprites and existing overlays.

**Clear filters** resets both the search and category and returns focus to the
search field, including after a search with no matches.

**Play animation** is explicit, not automatic. Preview runs at four frames per
second, honors office Pause/reduced motion, and stops when the gallery or panel
closes, the tab is hidden, or the page is left. A downloaded strip contains four
adjacent native frames with no padding or resizing. Walking strips repeat the
middle walking pose to match the distance-driven cycle. Idle, sleep and happy
companion families and typing, reading, needs-input, idle, celebration and error character families export
their four native frames in source order. A character strip is 128 × 36 pixels;
a companion strip is 112 × 26 pixels.
Starting a preview brings the canvas and Stop control below the fixed panel
header. Wider panels place them side by side, including short landscape screens.
The info line distinguishes transparent sprites from opaque room textures. Late
export results never replace feedback for another selection or a closed panel.

**Retry artwork** retries the atlas in place. It does not reload the page, discard
unsaved names or task drafts, reconnect the observer, or reset panel state. Two
simultaneous retries share one attempt. Tools, labels and gallery images refresh
once after success; failure keeps the original-art fallback and a usable retry.
Keyboard focus stays reachable during loading and moves to the status when the
successful retry control disappears.

No provider requests, approvals, observer events, usage or XP are generated.
Four-direction character walking is included; project-specific rooms are separate.
See [Studio artwork](studio-art.md) for base-art provenance and limitations.

Run `npm test` and `npm run test:browser`. New regressions exercise unsaved drafts,
concurrent recovery, one tool installation, preserved accounting, search/export,
actual native PNG dimensions, preview cleanup, mobile bounds, unique watering
frames and the actual room draw call. Existing original-art assertions are kept.
