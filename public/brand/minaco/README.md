# Minaco Brand Assets

Finalized direction: two warm starlights for a quiet, intellectual, gentle AI cofounder.

The two-star relationship is standardized across the asset set:

- Companion star scale: `45.3%` of the primary star.
- Companion star offset: upper-right of the primary star, scaled from the same master geometry.

## Core SVG Files

- `minaco-mark.svg` - transparent two-starlight mark.
- `minaco-app-icon.svg` - rounded-square app icon on warm black.
- `minaco-logo-horizontal-on-dark.svg` - mark + wordmark, for dark backgrounds.
- `minaco-logo-horizontal-on-light.svg` - mark + wordmark, for light backgrounds.
- `minaco-logo-stacked-on-dark.svg` - stacked lockup for dark backgrounds.
- `minaco-wordmark-on-dark.svg` - wordmark only, warm ivory.
- `minaco-wordmark-on-light.svg` - wordmark only, soft ink.
- `minaco-mark-mono.svg` - single-color mark.
- `minaco-favicon.svg` - simplified square favicon source.

## PNG Exports

PNG files are in `png/` and were generated from the SVG sources with `sharp`.

`minaco-two-star-concept.png` is a concept reference only. Use the SVG files and the `png/` exports for production, because those files use the standardized two-star geometry.

Common web icon exports are included:

- `png/minaco-favicon-32.png`
- `png/minaco-favicon-64.png`
- `png/minaco-apple-touch-icon-180.png`

## Palette

- Warm black: `#100E0C`
- Warm ivory: `#FFF7EA`
- Honey gold: `#F4B64A`
- Muted coral: `#E86F61`
- Clay: `#C9845A`

## Notes

The wordmark uses a high-contrast serif stack:
`Georgia, Times New Roman, serif`.

For final production identity work, convert the wordmark text to outlines in a vector editor after choosing the exact brand typeface.

## Search and browser icons

`minaco-search-favicon.svg` is the dedicated web icon master. It preserves the existing star shapes and colors, enlarges the pair by 10%, and centers the combined bounds inside a circular crop. The background fills the complete square without a nested rounded tile.

Run `node scripts/export-search-favicons.mjs` from the repository root to regenerate all favicon PNG sizes, `/favicon.ico`, Next.js `icon.png`, and web touch icons. Shared declarations live in `src/lib/brand-icons.ts`. Keep the canonical favicon URL stable so crawlers can refresh it.

The original `minaco-favicon.svg` is retained for existing in-page brand marks. Desktop app icon masters and wordmarks are unchanged.
