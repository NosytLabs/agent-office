# Studio sprite artwork

Native sprites adapted from the repository owner's approved AI-generated character,
pet, furniture and notification sheets. The source filenames and SHA-256 checksums
are recorded in `studio.json`; source artwork is preserved in the accompanying
conversation artifact rather than substituted for any upstream original.

The eight PNG tiles compose a 512 by 323 atlas. Tiles 0–6 are 512 by 40 and tile 7
is 512 by 43. The manifest gives each frame's rectangle and bottom-center anchor.
The assembled decoded RGBA pixels have a recorded SHA-256 integrity value.

There are 168 stored entries: 54 character poses, 56 companion poses, 29 props
(including six seasonal wall decorations), 13 status icons and 16 newly drawn
four-frame effect tiles. Typing is rendered with separate desk-level hand motion;
the supplied baked-desk pose is not placed over an existing workstation.

These images are not a copy of Habblaud's procedural art. Existing upstream art,
font, game and runtime-brand notices remain unchanged. Seasonal art is decorative;
visual reactions never create observer events, approvals, XP or token usage.

## Directional walking supplement

`directional.png` contains 72 newly generated, native 32 × 36 walking frames for
the six existing character identities: down, up, right and left, each with three
poses. The runtime creates 24 additional rose/moss palette variants using the
existing tint recipe. Portraits and activity poses keep the base artwork.

The built-in image-generation output is preserved unchanged at
`source/directional-walk.png` (1672 × 941 RGBA). Its exact prompt and tool/reference
details are in `source/directional-walk.json`. `directional.json` records the
source SHA-256, actual crop bounds, one scale per identity, native rectangles,
foot anchors and decoded atlas SHA-256. The source and compiled PNG also appear
in the complete repository asset-checksum inventory.

`node tools/build_studio_directional.mjs --check` reproduces the source fitting
without changing files. Generation uses original artwork references; no external
game or runtime logo artwork was introduced.

## Companion and room supplements

`pet-walk.png` / `pet-walk.json` contain 96 native 28×26 companion frames, with
bottom-center anchor (14,25). `room-surfaces.png` / `room-surfaces.json` contain
four 128×128 seamless oak/slate floor and plaster-wall tiles. Original generated
images and complete built-in imagegen prompts are preserved in `source/`.
`tools/build_studio_environment.mjs --check` reproduces native pixels, bounds,
shared identity scales and checksums without writing. No upstream art was copied.
