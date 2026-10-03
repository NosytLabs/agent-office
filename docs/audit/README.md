# Agent Office audit — 2026-10-03

Base: `35cf7fb`. The app was cloned, run locally, and exercised in a real
Chromium browser. Screenshots use synthetic events in a separate temporary
workspace. They do not show a live LLM session.

## Fixed findings

| Finding | Cause and correction |
|---|---|
| Settings ignored after reload | Frontend used `key in array` instead of a settings-key check. Shared typed settings normalization now applies server values. |
| Delayed polls undo saved settings | Polls now capture a settings revision; writes invalidate requests started before or during the save. |
| Focused settings show stale selection | Settings and layout controls persist, synchronize their pressed state in place, and retain keyboard focus. |
| Search loses focus after one character | Roster and event inputs were rebuilt during input/poll callbacks. Inputs are now persistent DOM nodes. |
| Event text executes as HTML | Agent details were concatenated into raw markup. All event-derived text is escaped. A browser regression demonstrated the old injection. |
| Glitching walk cycles | Six columns were assumed to be walk frames. Upstream mapping confirms three walk, two typing, and two reading columns. |
| Giant agents, tiny props, clipped mobile desks | Sprite scale, grid scale, and viewport fitting disagreed. World geometry, sprite sizing, and text scale are now separate. |
| Imported props clip outside the room | Rendering and removal now share bounds clamped to the current floor, including after mobile reflow. |
| Settings/API corruption | Non-object JSON and invalid types were accepted. Values are validated; HTTP failures return JSON status codes. |
| Corrupt log interrupts the office | Scalar JSON, invalid event names, and nonnumeric timestamps entered the fold. Invalid records are skipped, and activity rendering has a defensive fallback. |
| Same-timestamp events lose XP | Progress only tracked a timestamp. A boundary multiset now counts newly appended events at that timestamp without replay. |
| Theme achievement never advances standalone | Relative import failed outside plugin loading. Both standalone and package imports work. |
| Incorrect achievement thresholds | Fish unlocked at 15 rather than 25 browsing calls; plants unlocked with no session; earned time badges displayed 0%. Corrected and tested. |
| Removed features still advertised | Retired area/paint achievements, no-op cosmetics, unused sprites, and old settings were removed. Earned history and XP are retained. |
| VS Code page has missing assets | Installer copied the web template without CSS/JS. It now installs the iframe wrapper and helper module; the configured port is used. |
| Paths with spaces break Claude hook | Installer built an unquoted shell command. It now quotes executable and script paths. |
| Demo contaminates real progress | Demo now always runs in a temporary workspace and advertises its synthetic mode on port 8114. |
| CI only configured for manual runs | One bounded CI job is configured for PRs/main code changes with read-only permissions, pinned actions, and three-day screenshot retention. The workflow remains manually disabled in GitHub; see the limitation below. |

## Added and reorganized

The scene is separated from application state and panel rendering. New UI
includes an observed-task overview, accessible modal focus management,
visible activity/help controls, a searchable event stream, settings
export/import, seven placeable generated props with previews, collision checks, keyboard placement, and undo, zoom/drag/fit, pause,
reduced-motion support, and scene downloads. Achievements have earned and
up-next filters. The frontend remains vanilla JavaScript with no build step.

## Readability and decor follow-up

The second pass replaces tiny interface text with a local Geist variable font,
unifies navigation under Lucide icons, and gives agent labels their own
screen-resolution backgrounds. Mobile navigation wraps and keeps camera
controls reachable by scrolling. Matching coffee cart, cooler, lamp, and
clock art replaces four old utility images. Furniture cards show runtime
sprites, and new placements reject desks, walls, and existing objects.
Entering the editor now immediately refreshes canvas geometry, fixing a
first-click offset caused by the toolbar resize. Unused runtime logo SVGs
were removed; their earlier versions remain in history. Dense mobile rooms
use compact nameplates so approval indicators stay visible.

## Editor and reward follow-up

Furniture editing now has its own module, with click/drag and keyboard moves,
explicit removal, undo/redo, and cancellation that leaves the original saved
prop intact. Layout changes from another tab invalidate stale selections and
history. Tests cover move/reload/mobile removal and pointer cancellation.
Save responses also invalidate stale selections immediately, and secondary
pointers cannot redirect or cancel a primary drag. All 126 character frames
are checked for visible pixels in Chromium.
The two interactive cats now keep separate click targets; hiding decorations
clears both. The unlocked aquarium participates in placement collision checks.
Achievements expose XP and real room rewards, with persistent search and a
room-reward filter. Sprite checksums cover the complete runtime PNG inventory.

## Reference research

- [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents): studied its README, character state machine, and sprite mapping. Adopted the activity-linked animation and shared frontend principles; used the correct atlas columns. This project already bundled adapted character/pet assets.
- [Harish Kotra's AgentOffice](https://github.com/harishkotra/agent-office): reviewed its task-board, focus, layout-editor, and activity-log concepts. Implemented observer-compatible task grouping and furniture placement. Its inference/tool-execution engine was not imported.
- [thepixeloffice.ai](https://thepixeloffice.ai/): inspected the landing page with Firecrawl for visual direction. Marketing claims were not treated as evidence of functioning integrations; no site artwork was copied.
- [VS Code remote-extension guidance](https://code.visualstudio.com/api/advanced-topics/remote-extensions): queried through Context7; used `asExternalUri` for the iframe and matched its CSP origin.
- [MDN Canvas guidance](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas): queried through Context7 for DPR-aware rendering and measured text.
- [GitHub's Ubuntu 24.04 image](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md): verified maintained Chrome availability for CI.

## Validation

- Python suite: **46 passing tests**.
- Node suites: OpenCode bridge event writes, VS Code URL/iframe behavior, and sprite-frame selection.
- Browser suite: **26 passing cases** against an actual Python HTTP server with an isolated data directory. Covers saved settings, delayed poll responses, focused controls, malformed event names, search focus, unsafe-text rendering, assets, mobile bounds, activity/task inspection, layout import/export, all seven furniture objects and removal after reflow, every menu on desktop/mobile, zoom, pause, snapshot downloads, achievements, malformed requests, invalid imports, disconnection/recovery, keyboard placement, occupied-space feedback, undo, local font loading, non-overlapping readable labels and crowded-mobile approval alerts, and confirmed reset. The screenshot case writes evidence when `OFFICE_SCREENSHOTS` is set, as it is in CI.
- JavaScript syntax, formatter check, and `git diff --check` passed.
- Visual review: desktop, 390px mobile, settings, achievements, and midnight palette. Additional bounds checks cover 320px, 768px, and 1440px widths.

The current Playwright browser CDN returned invalid archives in this
workspace. Local browser verification used an installed Chromium 134 via
`CHROMIUM_PATH`, driven by Playwright 1.63.0. CI uses the runner's maintained
Google Chrome. Real third-party CLI sessions and a VS Code extension host
were not launched. Custom props use normalized positions and may need
repositioning after major layout changes. This is a local observer, not an
autonomous agent execution platform.

GitHub reports the CI workflow as `disabled_manually`, last updated on
2026-09-20. This audit has local passing evidence; no GitHub Actions success
is claimed. The connected GitHub app does not expose workflow enable/dispatch
or branch deletion, so re-enabling CI and removing the merged review branch
require a separate supported GitHub operation.

## Screenshots

| Before | After |
|---|---|
| ![Old desktop](before-desktop.png) | ![New studio](desktop-studio.png) |
| ![Old mobile](before-mobile.png) | ![New mobile](mobile-studio.png) |

![Midnight studio](midnight-studio.png)
![Achievements](achievements.png)
![Mobile settings](mobile-settings.png)
![All seven custom furniture objects placed on the floor](furniture-placement.png)

![Move a selected prop with preview and undo/redo controls](furniture-editor.png)
![Searchable room rewards](room-rewards.png)
# Guided setup follow-up · 2026-10-03

Added runtime-specific setup guidance, empty-room entry point, live/demo verification text, and a needs-input inspector shortcut. The Claude installer now reports malformed hook buckets without replacing existing configuration.

Local validation: 50 Python tests and 12 Node tests passed. Syntax and formatting are checked separately. The new browser case is present but **not validated**: this execution session denies Chromium's process-singleton socket (`Operation not permitted`); escalation is disabled. No new screenshot or browser-pass claim is made for this follow-up. Prior screenshot evidence below belongs to the previously merged passes.

Reference README comparison:

| Reference | Useful direction | Reuse decision |
| --- | --- | --- |
| [Pixel Agents](https://github.com/pixel-agents-hq/pixel-agents) | Runtime hooks, approval cues, editable rooms | Existing attributed character assets retained; no new art imported |
| [Sahni Agents Office](https://github.com/ajsahni/agents-office) | First-five-minutes instructions and explicit connection states | No code or assets copied; noncommercial plus additional rebundling restrictions |
| [AgentSystemLabs](https://github.com/AgentSystemLabs/agent-office) | Guided initial setup and visible waiting-agent navigation | Independent observer-compatible implementation; terminal execution remains outside this app |
| [Agent Virtual Office](https://github.com/KbWen/agent-virtual-office) | Truthful current status and empty-state wording | Independent guidance; no fabricated activity or copied art |
| [Star Office UI](https://github.com/ringhyacinth/Star-Office-UI) | Setup verification and stale-session clarity | No art imported: README distinguishes MIT code from noncommercial art |
