# VIDKIDZ sculpted icon assets

30 transparent WebP files, 192 × 192 pixels. Interface aliases resolve through
`SCULPTED_ICONS` in `public/index.html`; utility glyphs use the dimensional SVG
renderer. Educational emoji content and user-provided photos are separate from
this interface icon set.

The bell, logout and eye replacements on 24 September 2026 were generated with
the built-in imagegen tool, then resized and encoded with Sharp (quality 85).
No image API/CLI fallback was used. The other 27 assets were retained from the
preceding generation/recovery work.

Final prompt template used for these three replacements:

> One premium Pixar-like 3D animated educational app icon: SUBJECT. Soft sculpted
> chunky toy shapes, smooth glossy material, studio lighting upper left, vivid
> colors. Centered square with generous 12% margins. Truly transparent alpha
> background. No text, letters, surrounding badge or extra objects. Readable at
> 32 pixels.

Subjects:

- `bell.webp`: a golden notification bell
- `logout.webp`: an open blue door with a coral arrow pointing outward to the right
- `eye.webp`: a friendly rounded blue eye

Final project location: `public/assets/icons/pixar/`.
