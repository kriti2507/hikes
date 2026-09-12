# Ukiyo-e redesign of the hyakumeizan checklist

Date: 2026-09-11

Restyle the shared checklist as a woodblock-print album page: washi paper, sumi
hairlines, Prussian blue and vermilion, mincho type, and a real Hokusai print in
the header. The table stays a table.

## Scope

Presentation only. `app/page.tsx`, `app/actions.ts`, `lib/`, `db/`, and
`scripts/` are untouched. No schema change, no query change, no new dependency.

| File | Change |
| --- | --- |
| `app/globals.css` | Full rewrite |
| `app/checklist.tsx` | Header markup, seal checkbox, group-header markup |
| `app/layout.tsx` | `theme-color` on the `viewport` export |
| `app/login/page.tsx` | Markup for the print-card login |
| `public/red-fuji.jpg` | New — 1200×800, 282 KB |
| `public/black-fuji.jpg` | New — 1136×792, 222 KB |
| `README.md` | Attribution section |

## Design decisions already settled

These were chosen against rendered mockups, not in the abstract. The mockups are
kept in `.superpowers/brainstorm/` (gitignored) for reference.

1. **Layout**: title and tallies on clean washi at the left, the print occupying
   the right ~54% and feathering in from its left edge. Rejected: full-bleed
   banner behind the title (needs a cream wash that dulls the print and half-hides
   Hokusai's own cartouche), and the uncropped inset plate (quieter but less
   striking).
2. **Bottom edge**: soft fade — the print holds full strength most of the way
   down and releases in the last third, leaving a clean band of paper before the
   table. Rejected: a deep fade that dissolves by mid-header, and a version that
   fades out *behind* the first table rows.
3. **Print**: *Fine Wind, Clear Morning* (`凱風快晴`, "Red Fuji"), Hokusai c. 1830,
   by day. *Shower Below the Summit* (`山下白雨`, "Black Fuji") by night — the
   companion piece from the same series, so dark mode changes the weather rather
   than the theme.
4. **Type**: system mincho stack. No webfont.

## Palette

Defined as custom properties on `:root`, overridden in
`@media (prefers-color-scheme: dark)`, matching the existing file's structure.

| Token | Day | Night | Used for |
| --- | --- | --- | --- |
| `--washi` | `#f1e7d2` | `#14120f` | page |
| `--washi-deep` | `#e7dcc3` | `#1c1916` | cartouche fill, inputs |
| `--sumi` | `#1b1713` | `#ece2cc` | body ink |
| `--sumi-soft` | `#5c5348` | `#a89c85` | secondary text |
| `--sumi-faint` | `#6b6253` | `#8a8070` | row numbers, captions |
| `--rule` | `#cdbe9e` | `#3a332a` | hairlines |
| `--bero-ai` | `#1d3f66` | `#7fa5cc` | labels, links, hover wash |
| `--beni` | `#b03327` | `#d9573f` | seals, errors |

`--beni` doubles as the danger colour; the print's vermilion slope is the same
hue, which is why this palette holds together.

Two values moved during implementation, both for contrast (see Accessibility):
`--beni` from `#bf3a2b` to `#b03327`, and `--sumi-faint` from `#8d8270`/`#6d6456`
to the values above.

**Paper texture**: SVG `feTurbulence` fractal noise, tiled at 180px, on a
`::before` pinned to the page. No image asset.

The first attempt used two `repeating-linear-gradient`s at 94° and 2°. Rendered,
they interfere into a legible cross-hatch — the page reads as graph paper, not
washi. Turbulence is irregular the way pulped fibre is. One texture serves both
schemes via blend mode: `overlay` at 0.32 by day, and `screen` at 0.07 at night,
because `overlay` collapses toward `multiply` on a near-black ground and the
grain would otherwise disappear.

## Typography

System fonts only — nothing downloaded, nothing to fail at build time. macOS and
iOS resolve to Hiragino Mincho, Windows to Yu Mincho; both are genuine mincho
faces, so the great majority of visitors get the intended look. Linux falls back
to a generic serif, which is acceptable.

```css
--font-ja: "Hiragino Mincho ProN", "Yu Mincho", YuMincho, "Noto Serif JP",
           "Songti SC", serif;
--font-en: Georgia, "Iowan Old Style", "Times New Roman", serif;
```

`--font-ja` is the body font and carries the kanji, kana, and headings.
`--font-en` is used for the English mountain names (italic), column headings,
and the letterspaced uppercase labels — the places where a Latin serif reads
more deliberately than the JP face's Latin glyphs.

Elevations and counts use `font-variant-numeric: tabular-nums`, as they do now.

## Header

```
┌──────────────────────────────────────────────────────────────┐
│  日本百名山                                  ░░▒▒▓▓ Fuji ▓▓▒▒ │
│  THE HUNDRED FAMOUS MOUNTAINS                ░░▒▒▓▓▓▓▓▓▓▓▓▓▓▓ │
│  FUKADA KYŪYA, 1964                          ░▒▓▓▓▓▓▓▓▓▓▓▓▓▓ │
│                                              ░▒▓▓▓▓▓▓▓▓▓▓▓▓▓ │
│  ┌────┐ ┌────┐                                ░▒▓▓▓▓▓▓▓▓▓▓▓  │
│  │ 23 │ │ 31 │                                  ░░▒▒▓▓▓▓▓    │
│  │KRITI│ │YUKI│                                       ░░      │
│  └────┘ └────┘                                                │
├──────────────────────────────────────────────────────────────┤
│  北海道  HOKKAIDŌ · 9 PEAKS                                   │
```

- Fixed height ~260px on desktop, `overflow: hidden`.
- The image sits in an absolutely positioned panel, `top/right/bottom: 0`,
  `width: 54%`, with `object-fit: cover; object-position: 72% 40%` — chosen so
  Fuji's cone lands in frame.
- Both feathered edges come from a single composited mask on the `<img>`:

  ```css
  mask-image:
    linear-gradient(90deg, transparent 0%, #000 30%),
    linear-gradient(180deg, #000 58%, transparent 100%);
  mask-composite: intersect;
  ```

  with `-webkit-` equivalents (`-webkit-mask-composite: source-in`). Masking the
  image rather than painting gradient overlays on top means the paper fibre shows
  *through* the fade and the corner dissolves correctly.

- **Fallback**: wrap the mask rules in `@supports (mask-composite: intersect)`.
  Without support, the panel keeps a single left-edge gradient overlay — a
  square-cornered fade rather than a hard-edged photograph.
- No wash is laid over the print; the only thing touching it is the mask. Its
  cartouche sits in the left third and so fades with that edge — visible but
  dissolving, which is the intended effect rather than a crop through it.
- `main` runs the full window width and `.sheet` carries the 1100px measure, so
  the print genuinely bleeds off the right edge of the window. Left inside a
  1100px `main`, it stops dead at the content boundary and reads as a pasted
  rectangle on wide screens. Doing it this way rather than with negative `vw`
  margins avoids the scrollbar-width horizontal overflow that trick causes.
- The print is a CSS `background-image` swapped by media query, **not**
  `next/image`. `next/image` cannot art-direct between two sources, and
  rendering both with one hidden downloads both. A media-scoped
  `<link rel="preload">` pair in the root layout restores the preload-scanner
  discovery that a CSS background otherwise loses, and only the matching scheme's
  file is fetched.

**Tallies** become bordered seal squares: 60×60, 2px `--beni` border, 5px radius,
count in tabular numerals over the person's name in letterspaced small caps.

## Table

Stays a real `<table>` with `<thead>`, sticky header row, and sticky group rows —
the current sticky offsets are preserved.

**Seal checkboxes.** The single most characterful element, and the one with the
most ways to go wrong. A real `<input type="checkbox">` stays in the DOM and
keeps focus and keyboard behaviour:

- `appearance: none`, 25×25, centred `登` glyph via `::after`.
- Unchecked: 1px `currentColor` outline at 28% opacity, `〇`.
- Checked: `--beni` fill, `--washi` glyph.
- Rotation of ±3°, derived from `mountain.id % 5` so a given row always tilts the
  same way and the column doesn't look mechanically aligned.
- `:focus-visible` gets a 2px `--bero-ai` outline with 2px offset. Required.
- `prefers-reduced-motion: reduce` drops the press transition.

**Group headers.** Prefecture rows get a kasumi mist band — an inline SVG with
two cloud paths in `--washi-deep`, sitting above the existing bottom rule.

**Rows.** Hairline separators in `--rule`; hover wash becomes
`color-mix(in srgb, var(--bero-ai) 5%, transparent)`. The kanji/kana/English
stack, tabular elevations, and the `season`/`notes` columns keep their current
structure.

## Login

The card becomes a single small print on washi: cartouche title (double-rule
frame in `--bero-ai`), letterspaced label, and the Enter button as a vermilion
seal matching the checkboxes.

## Footer and attribution

Existing footer text stays; a credit line is added:

> Header print: Katsushika Hokusai, *Fine Wind, Clear Morning* (c. 1830) /
> *Shower Below the Summit* (c. 1830). Public domain, via Wikimedia Commons.

The README gains a short section recording the same, with the source URLs, so the
provenance survives independently of the page.

## Responsive

At `<720px` the header stacks: the print becomes a faint full-width wash *behind*
the title at 0.16 opacity (mask flipped to fade from the top) rather than a side
panel, and the tallies wrap. The `season` and `notes` columns stay hidden, as
they are today.

Hiding those two columns is not sufficient. At 375px with three people, the
desktop column widths still push the last person off-screen — a pre-existing
condition, not a regression, since the old CSS used the same 6.5rem person
columns. The table therefore switches to `table-layout: fixed` on mobile with
tightened widths (person 2.9rem, elevation 4.25rem, number 1.75rem) and a
smaller seal. `fixed` is the load-bearing part: under the default `auto`, the
declared widths are only suggestions and the table overflows anyway.

A horizontal scroll wrapper was rejected: `overflow-x: auto` forces a scroll
container on the block axis too, which traps the sticky header inside it.

## Accessibility

- Checkboxes keep native semantics, labels, and focus; the existing
  `aria-label`s (`"{person} climbed {mountain}"`) are unchanged.
- The header image is decorative — `alt=""`.
- Contrast was verified, and the `登` glyph did miss: `#f1e7d2` on `#bf3a2b` is
  4.44:1, under the 4.5 floor for text at that size. `--beni` was darkened to
  `#b03327` as the spec prescribed, giving 5.14:1. Night is 4.82:1.
  `--sumi-faint` also missed in both schemes (3.08:1 and 3.18:1) and was moved to
  4.96:1 and 4.83:1 — it carries the Fukada numbers, which are content.
- `prefers-reduced-motion` respected.
- `prefers-color-scheme` drives the day/night print swap; both must be legible.

## Non-goals

No map, no per-mountain photography, no animation beyond the seal press, no new
runtime dependency, no change to how data is added.

## Assets

Both prints were resized to ~1200px wide and recompressed (sips, quality 60),
roughly halving them. `black-fuji.jpg` was additionally cropped to 1136×792: the
Library of Congress scan includes the sheet's paper margins, and with no
horizontal crop at banner proportions the right-hand margin showed as a pale
vertical strip against the night palette.

## Verification

Done:

- `npm run typecheck` and `npm run build` clean.
- Rendered at 1440px and 375px in both colour schemes, and the checked seal state
  against the compiled stylesheet — vermilion `登`, per-row tilt, date field.

Still open:

- Keyboard-only pass: tab to a checkbox, toggle it, confirm the focus ring is
  visible and the date field appears. Needs a real interactive session.
- Confirm the mask fallback by disabling `mask-composite` support in devtools.
- Confirm the system mincho stack on Windows (Yu Mincho) and Linux.
