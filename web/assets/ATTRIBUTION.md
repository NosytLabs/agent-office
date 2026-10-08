# Font and icon credits

All interface assets are served locally. No CDN is required at runtime.

| Asset | Source | License |
|---|---|---|
| `fonts/geist-latin-variable.woff2` | [`@fontsource-variable/geist` 5.3.0](https://registry.npmjs.org/@fontsource-variable/geist/-/geist-5.3.0.tgz), unmodified `files/geist-latin-wght-normal.woff2` | [SIL Open Font License 1.1](fonts/OFL.txt) |
| `../js/icons.js`, `office.svg` | Selected SVG paths (including move, redo, and reward controls) from [`lucide-static` 1.51.0](https://registry.npmjs.org/lucide-static/-/lucide-static-1.51.0.tgz); `building-2` in a project-colored badge for the brand | [ISC and retained derivative notices](icons/LICENSE.txt) |
| `brands/claude.svg`, `brands/codex.svg`, `brands/opencode.svg`, `brands/telegram.svg` | [SVGL collection](https://github.com/pheralb/svgl/tree/main/static/library), linked from [svgl.app](https://svgl.app/directory/ai) | [SVGL MIT notice](brands/SVGL-LICENSE.txt), Pablo Hdez, 2022; the marks identify their respective products |

The font SHA-256 is `19f9c92546aa300c312235e3125af1b81394d8db9a4bc4a425cd5b641d2d54e1`.
Icon markup is bundled as static source; decorative icons are hidden from
assistive technology, with text or accessible labels on their controls.

Character, pet, and generated furniture provenance is in
[sprites/ATTRIBUTION.md](sprites/ATTRIBUTION.md). Replaced runtime-logo SVGs
and old utility sprites remain available in Git history.

## Runtime brand marks

The imported marks retain their source proportions and colors. They identify
Claude Code, Codex, OpenCode, and Telegram next to a text label. The respective
brand owners retain their trademarks; Agent Office is an independent project
and does not claim endorsement. Hermes uses its name rather than an unverified
logo. Collection licensing does not transfer trademark rights.

Exact vendored bytes are recorded in [brands/provenance.json](brands/provenance.json).
