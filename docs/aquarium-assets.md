# Optional local aquarium art

Agent Office includes its own original generated pixel fish. Owners of the Smallburg assets
used by **NosytLabs/little-current** can install four of those fish into their
local office. The public repository and hosted preview do not include the
Smallburg PNGs, source packs, or a downloadable copy of them.

## Import from your existing Little Current checkout

Run from the Agent Office checkout with Python 3.10 or later:

```sh
python tools/import_smallburg.py --source /path/to/little-current
```

The default destination is `$HERMES_HOME/pixel-office/assets/aquarium`, or
`~/.hermes/pixel-office/assets/aquarium` when `HERMES_HOME` is unset. To select
the same data directory as another local office instance:

```sh
python tools/import_smallburg.py \
  --source /path/to/little-current \
  --office-dir /path/to/local-office-data
```

Reload Agent Office after import. The local server exposes the installed
manifest at `/user/aquarium/manifest.json` and its four PNGs at
`/user/aquarium/<fish-id>.png`. If the optional pack is absent, the aquarium
uses the included original generated fish. Importing art does not change fish unlocks,
progress, or saved selections.

The importer reads the exact four source sheets and their license notice,
checks every SHA256, and copies the original bytes without cropping or
resizing. It publishes the complete directory after all validation and writes
succeed. Repeating an identical import leaves the files untouched. A different
existing aquarium directory is left unchanged; move it to your own backup
location before intentionally replacing it. Other backup directories are never
edited. Output inside the Agent Office or source checkout is rejected.

This is an offline importer, not a downloader. It does not establish that the
operator owns a commercial license. Use your legitimately acquired source
assets and the terms that apply to them. The included notice permits repeated
project use for the commercial license but prohibits redistribution and resale
of the assets. Keep this optional data directory out of Git, public deployments,
and downloadable source bundles. The license notice is preserved with the local
copy. These four PNGs are **Smallburg Diving** assets in Little Current's
provenance; the separate Fishing notice is not their source attribution.

## Exact source and animation contract

The supported bytes were verified against Little Current revision
`15733b26b98271b89a4dd4c928532520ba30fdbc`. A newer checkout with the same bytes
also works; changed art fails validation rather than using an unverified crop.
Source PNGs are under `Assets/Resources/Smallburg/Fish/`.

| Fish ID | Kind | Source PNG | SHA256 |
| --- | --- | --- | --- |
| `ember` | Clownfish | `clown_fish-red.png` | `efac23e9983e1c1f49cb22692a95af533711f2dd11c3626f7be302e1e959a223` |
| `mint` | Guppy | `guppy-blue.png` | `58067e766aece90bd7c0fbce7e7020af4544a156a08e2ef3fe1a4ecd74cc2e24` |
| `violet` | Neon tetra | `neon_tetra-light_blue.png` | `5e3d76f06b867402dfa45429e9babd67a83b477b869ce11c6a5e586816a83007` |
| `pearl` | Butterflyfish | `butterfly_fish-yellow_white_fin.png` | `392dbeee17c9d668d04b57e6d4565e29377af745f5abb1c83c87390ee1a453a2` |

All four original sheets are **96×64** pixels. Each uses **four 16×16** swim
frames with top-left coordinates `(16 + frame * 16, 16)` and natural facing
**right**. The renderer can mirror the frame while swimming left. The manifest
records sheet size, frame size, count, x/y origin, horizontal stride, facing,
kind, source filename, and SHA256. It also contains a closed five-file roster
covering the four images and license notice.

These crops follow `AquariumArt.Fish()` and the catalog's `frameWidth = 16`,
with facing confirmed by `AquariumTank`'s movement and x-scale convention.
Unity's automatic `.meta` slices are not an animation contract: the guppy
metadata combines each row into a large region, while the runtime explicitly
selects four cells. The second sheet row is preserved in the source PNG but
is not included in this swim animation.

The source license is `ThirdParty/Smallburg-Diving-license.txt`, SHA256
`ffab939499ade85ed5cb0099de7c44174486db34c2c7909499ddca293c580d7b`.

Source references (require access to the owner's private repository):

- [Asset provenance](https://github.com/NosytLabs/little-current/blob/15733b26b98271b89a4dd4c928532520ba30fdbc/docs/asset-provenance.json)
- [Smallburg Diving notice](https://github.com/NosytLabs/little-current/blob/15733b26b98271b89a4dd4c928532520ba30fdbc/ThirdParty/Smallburg-Diving-license.txt)
- [Fish catalog](https://github.com/NosytLabs/little-current/blob/15733b26b98271b89a4dd4c928532520ba30fdbc/Assets/Resources/Catalog.json)
- [Native runtime crops](https://github.com/NosytLabs/little-current/blob/15733b26b98271b89a4dd4c928532520ba30fdbc/Assets/Scripts/Presentation/AquariumArt.cs)
- [Facing convention](https://github.com/NosytLabs/little-current/blob/15733b26b98271b89a4dd4c928532520ba30fdbc/Assets/Scripts/Presentation/AquariumTank.cs)
