# Responsive product screenshots

The four original PNG captures stay in [docs/screenshots](../../docs/screenshots).
These checked-in lossless WebP copies give the product site 480px, 720px and 1440px
choices without a runtime image service or an added production dependency.
The full-size copies retain the source pixels. Browser tests compare decoded
pixels and check real mobile resource selection.

`manifest.json` records the source SHA-256, encoder/options and every derivative’s
SHA-256/size. The site builder checks those records before replacing its output;
a changed source must be intentionally re-encoded. The manifest and original PNGs
are not published with the product site.

To reproduce with [libwebp’s cwebp](https://developers.google.com/speed/webp/docs/cwebp)
1.6.0, run this from the repository root for each of `appearance`, `usage`,
`settings`, `aquarium` and widths `480`, `720`, `1440`:

```sh
cwebp -lossless -z 9 -exact -metadata none -resize 480 0 \
  docs/screenshots/appearance.png -o site/screenshots/appearance-480.webp
```

Update the manifest’s source and derivative hashes/byte counts, then run
`npm run build:site`, the site build Python tests and `tests/site-images.test.cjs`.
Different encoder releases can produce different lossless bytes; review the
new hashes and decoded pixels rather than silently replacing the source PNGs.

The 720px size keeps enough pixels for the product page’s tested 2× phone displays
without downloading a 1440px image. Depending on the screenshot, it transfers
33–58% fewer bytes than the full-size derivative. Large or denser displays can
still select the full-size source.
