# Studio artwork

Open **Customize**, then **Studio artwork**. Choose Studio pixel art or Original
artwork, optional autumn/winter wall decorations, and the look of each existing
companion slot. These choices persist in this browser, separately for the hosted
demo and the local observer. They do not change settings on another browser.

## Included

- A native 512 by 323 atlas, transported as eight small PNG bands. Its manifest
  describes 168 source entries: 54 character poses, 56 companion poses, 29 props,
  13 icons and 16 effect frames. Two additional human palette finishes are built
  once at load time, producing 186 runtime canvases.
- Distance-driven walking, activity-selected reading and attention poses, and
  desk-level typing hands. The baked desk in the source typing picture is not
  drawn over the existing workstation.
- Four cat looks, three dog looks and a pocket robot. They use the existing two
  companion slots; the second slot retains its original unlock requirement.
- Coffee steam, watering and sparkle effects, plus a short parcel handoff from a
  newly completed subagent to its parent desk. Removal, refresh, missing parents
  and disconnected observation never create a new handoff.
- Matching editor thumbnails and roster portraits, coordinated panel colors,
  mobile controls and keyboard focus outlines.
- A notification whose timeout was held for keyboard focus now resumes its
  lifetime after focus leaves it.

## Safety and compatibility

The original compact atlas, source files, scene geometry, pathfinding and editor
placement rules remain intact. If the new manifest, one PNG band, dimensions or
supported pixel-integrity check fail, the complete presentation falls back to the
original artwork rather than publishing a half-loaded set. No extra runtime
package or frontend build is needed.

The studio is a presentation of existing observed status, not a second agent
state machine. Animations and companion interactions never submit prompts,
answer approvals, call a model, grant XP or alter token/cost accounting. A command
pose does not establish whether a remote process is actually still running.

Seasonal ornaments are wall decoration, not independently placeable furniture.
The handoff is a parcel animation, not a claim that code quality was verified.
Original directional sprites remain available through Original artwork; the new
source poses do not provide full four-direction walking art. Aquarium fish and
arcade game art retain their existing separate loaders and notices.

## Verification

Run the existing checks, which include the studio unit and browser tests:

```sh
python3 -m pytest -q
npm test
npm run check
npm run format:check
npm run test:browser
npm run check:sprites
```

The browser tests exercise real local observer fixtures with synthetic events:
new artwork, original-art fallback, preference reload, mobile overflow, reduced
motion, distinct pet walk frames, observed subagent handoffs, unchanged accounting
and notification keyboard lifetime. They do not authenticate or run agent CLIs.

The original notices remain in [asset attribution](../web/assets/ATTRIBUTION.md).
The new asset inventory and source checksums are in
[the studio asset directory](../web/assets/sprites/studio/README.md).
