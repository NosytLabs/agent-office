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

## Companion life loops

`pet-life.png` / `pet-life.json` add 96 native 28×26 frames: eight existing looks,
three four-frame families (idle, sleep, happy), anchored at (14,25). Their complete
original source and built-in imagegen prompt are preserved in `source/pet-life.*`.
The environment compiler reproduces the reviewed alpha crops, per-look shared
scale, native pixels and checksums. Runtime loops are cosmetic and stop with Pause.

`character-life.png` / `character-life.json` add 72 native 32×36 frames: six
base identities, with four typing, four reading and four attention poses each.
The runtime creates 24 matching rose/moss palette variants. Each identity uses
one shared scale and anchor (16,35), with a transparent margin and grounded feet.
The unmodified 1536×1024 built-in imagegen source and complete prompt are retained
in `source/character-life.*`; the manifest records the reviewed crops and decoded
pixel checksum. The environment compiler reproduces this pack with the other
supplements. Stationary reported activity selects these loops; walking and the
existing error/completion/shell poses retain their separate artwork.

## Character reaction loops

`character-reactions.png` / `character-reactions.json` add 72 native 32×36 idle,
celebration and error frames for the same six identities. The runtime adds 24
rose/moss palette variants. The original 1536×1024 built-in image-generation edit
and its complete prompt are preserved unchanged in `source/character-reactions.*`.
The existing character-life sheet served as the identity and style reference.
The shared environment compiler records one scale per identity, reviewed alpha
bounds, foot anchors, source hash and decoded pixel hash. This optional supplement
has independent fallback/retry; the static poses are retained for that purpose.
