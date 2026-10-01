# Coworkany logo and icon — v2

Generated with the built-in image_gen tool. Approved transparent PNG masters, now used by the website and desktop app.

- `icon.png`: application icon, angular C plus forward chevron, black rounded tile.
- `logo.png`: matching horizontal lockup with the lowercase `coworkany` wordmark; intended for light backgrounds.
- Palette brief: gold `#FFD000`, near-black `#111111`, matching WORKBENCH_THEME.light. Raster rendering may include antialiasing and color variation; these are not vector masters.

## Icon prompt

Use case: logo-brand. Refine this Coworkany app-icon draft into a much simpler precise FLAT SOFTWARE BRAND MARK. Preserve the black rounded square and golden-yellow palette, transparent outer canvas. REPLACE the looping circle glyph entirely: the current circle plus arrow is too close to a male gender sign. New glyph: a single bold geometric angular C-shaped path, open on the RIGHT, built from three broad diagonal/straight segments with small rounded corners, combined with one equally broad short forward/upward chevron entering the open right side. Two cooperating strokes, suggesting C + forward progress, optically one balanced compact unit. Think a beautifully crafted interlocking bracket and forward arrow, NOT a circle, NOT infinity, NOT a gender symbol, NOT a rising chart, NOT chain links, NOT the Google Drive triangle. The mark must have no circular closed loops. Use strong negative space, broad strokes, few corners, a calm original silhouette readable as a desktop app at 24px. Keep the mark within the central 60% of the square, centered. Opaque solid #FFD000 mark and opaque solid #111111 tile ONLY. Absolutely flat mechanically clean vector-like edges; remove all texture, subtle gradients, lighting, shadows, grain, bevel. One icon only on a square canvas, no text no variations. Everything outside the black rounded tile is alpha transparent.

## Logo prompt

Use case: logo-brand. Create the final horizontal logo lockup for the personal AI agent brand Coworkany. The attached finished app icon is the exact identity reference. Produce one wide standalone transparent PNG logo, approximately 1800 x 600 canvas, not a mockup and not a presentation board. On the left, reproduce the reference icon faithfully at approximately 290px square: near-black #111111 rounded-square tile and the same golden-yellow #FFD000 broad angular open-C with forward chevron mark. Do NOT redesign, rotate, mirror or reinterpret its shape. On the right, set the exact lowercase word 'coworkany' in near-black #111111, spelled c-o-w-o-r-k-a-n-y, one word. Expertly kerned contemporary geometric/humanist sans-serif, bold medium-heavy weight with open counters, slightly friendly rounded character but mature and professional, comparable in spirit to Helvetica Now / Circular without copying another company's logo. Single-storey 'a' welcome, no ultra-condensed letters, no italics. The wordmark capital-height should be about 135px to balance the icon. About 60px optical gap between icon and wordmark, both vertically centered, generous but not excessive transparent margins, full lockup fits on one line. Flat clean digital identity artwork, absolutely no texture, grain, gradients, shadows, 3D, bevel, lighting or fabricated checkerboard background. True alpha transparency everywhere outside the black icon and black wordmark; do not add a background slab behind the wordmark. Do not add any tagline, underline, extra icon, border, label, watermark, or additional variants. The only text is 'coworkany'.


## Production exports

Run `node scripts/generate-brand-assets.mjs` from the repository root to export the approved masters for both apps. The legacy Python entry point delegates to this command. Exporting only trims transparent margins, resizes, and packages the artwork; it does not redraw the logo or change its colors.

- Website: `/brand/coworkany-logo.png`, `/brand/coworkany-icon.png`, Next.js `app/icon.png` and `app/apple-icon.png`.
- Desktop: `apps/desktop/public/brand/` (startup logo and sidebar/window icon).
- Native bundles: `apps/desktop/src-tauri/icons/coworkany-icon.{png,ico,icns}`. Windows ICO includes 16–256 px variants; macOS ICNS contains the 1024 px source.
- Old procedural artwork and unused dark/SVG variants were removed to prevent stale exports.
