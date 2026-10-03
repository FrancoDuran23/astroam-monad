---
version: anydesign-1
name: Kero-stack
source: https://kerostack.vercel.app
captured_at: 2026-10-02
description: |
  Warm paper ground, near-black ink and one hot orange. The page is a working
  instrument: dot-matrix drawings, measurement guides on its own type, and 3D card
  reels driven by one index variable. Motion is slow-out and physical.
colors:
  ground: "#F2F1ED"
  surface: "#FFFFFF"
  sunk: "#F6F5F2"
  ink: "#111111"
  ink-2: "#57564F"
  ink-3: "#8C8A83"
  rule: "#11111117"
  accent: "#F2541B"
  accent-ink: "#B8400F"
  accent-soft: "#FDE6DC"
  dot: "#111111"
  dot-hot: "#F2541B"
  dark-card: "#151515"
typography:
  display: { fontFamily: "Instrument Sans, system-ui, sans-serif", fontSize: 115px, fontWeight: 500, letterSpacing: -0.04em, lineHeight: 1 }
  section-title: { fontFamily: "Instrument Sans, system-ui, sans-serif", fontSize: 40px, fontWeight: 500, letterSpacing: -0.02em }
  step-number: { fontFamily: "Instrument Sans, system-ui, sans-serif", fontSize: 80px, fontWeight: 500, letterSpacing: -0.05em, lineHeight: 1 }
  body: { fontFamily: "Instrument Sans, system-ui, sans-serif", fontSize: 17px, fontWeight: 400, lineHeight: 1.6 }
  caption-mono: { fontFamily: "IBM Plex Mono, ui-monospace, monospace", fontSize: 14px, fontWeight: 500 }
spacing:
  base: 4px
  scale: [8, 12, 16, 22, 28, 32, 56]
  gutter: 32px
rounded:
  tag: 4px
  card: 16px
  story-card: 28px
  pill: 999px
shadows:
  base: "0 1px 0 #1111110a, 0 12px 32px -12px #1111112e"
  story-card: "0 30px 70px -40px #11111173, 0 0 0 1px #1111110f"
motion:
  ease: "cubic-bezier(.23, 1, .32, 1)"
  ease-io: "cubic-bezier(.77, 0, .175, 1)"
  card-move: 620ms
  pill-move: 420ms
  press: 160ms
components:
  pill: { backgroundColor: "{colors.surface}", textColor: "{colors.ink}", rounded: "{rounded.pill}", padding: 0 16px, height: 44px }
  reel-card: { width: "min(400px, 39vh)", height: "1.34 x width", rounded: "{rounded.story-card}" }
  stepper: { backgroundColor: "{colors.ink}", textColor: "{colors.surface}", rounded: "{rounded.pill}" }
  measure-guide: { borderColor: "{colors.accent}", textColor: "{colors.accent-ink}", rounded: "{rounded.tag}" }
  taste-card: { backgroundColor: "{colors.dark-card}", textColor: "#D9D7D0", rounded: "{rounded.card}" }
---

# Design Analysis: Kero-stack

> Analysis generated with the `anydesign` skill. Date: 2026-10-02. Emphasis: reconstruction (motion and signature components) for reuse in AstroAm.

## Source

URL https://kerostack.vercel.app. CSS custom properties digest (`extract_css_vars.py`) plus targeted greps of the one stylesheet, and 11 desktop frames at 1440x900 captured over CDP (Playwright for Python is not installed, so computed styles were not dumped; type sizes are read from the stylesheet and frames ⚠️). Mobile not captured.

## TL;DR

A design-method site that proves its claims on itself: headlines carry their own measurement guides, illustrations are dot matrices with one hot orange dot cluster, and every carousel is a 3D reel computed from `--i` (card index) and `--k` (current index). For AstroAm the reusable idea is the reel math and the dot-matrix drawing, recolored for space.

## 1. Visual identity

### 1.1 Surface description

- Personality: precise, crafted, playful, editorial. ✅
- Mood: a design studio's bench; warm paper with tools on it. ✅
- Stylistic references: Teenage Engineering dot displays, Linear-era motion, Swiss editorial type. ⚠️
- Information density: low per screen, one idea per section. ✅
- Implicit positioning: a craft tool for designers who direct AI agents. ✅

### 1.2 Brand voice / Atmosphere

Measurement over opinion. The site believes its reader distrusts generated design, so every claim is shown as an instrument reading: pixel guides on its own headline, contrast ratios as tags, dot drawings that look like plotter output. Warm paper and one orange keep it human; the orange marks the measured thing, nothing else.

### 1.3 The "ONE brand thing"

- The thing: dot-matrix drawings in `{colors.dot}` (#111111) with a cluster of `{colors.dot-hot}` (#F2541B) dots marking the subject.
- Why: it reads as "measured, plotted", which is the product's thesis.
- Restraint: everything around it is flat ground, ink and one sans.
- Where: hero card icons, giant background lettering, principle cards, mascot. Never on buttons or body text.

## 2. Design System (tokens)

### 2.1 Colors

Ground `{colors.ground}` (#F2F1ED), cards `{colors.surface}` (#FFFFFF) and `{colors.sunk}` (#F6F5F2), ink `{colors.ink}` (#111111) with `{colors.ink-2}` (#57564F) and `{colors.ink-3}` (#8C8A83), hairline `{colors.rule}` (#11111117). One accent `{colors.accent}` (#F2541B) with `{colors.accent-ink}` (#B8400F) for text and `{colors.accent-soft}` (#FDE6DC) for halos. The principles section inverts to `{colors.dark-card}` (#151515). ✅

### 2.2 Typography

Instrument Sans for everything readable, IBM Plex Mono for commands and tags, Newsreader declared but not seen in frames. Display at `{typography.display}` (115px, 500, tight tracking); step numbers at `{typography.step-number}` (clamp 48 to 80px, -0.05em); body `{typography.body}` (17px / 1.6). ✅ for families, ⚠️ for sizes.

### 2.3 Spacing

4px base; observed 8, 12, 16, 22, 28, 32, 56; gutter `{spacing.gutter}` (32px desktop, 16px mobile). ✅

### 2.4 Radii

Tiered: tags `{rounded.tag}` (4px), cards `{rounded.card}` (16px), story cards `{rounded.story-card}` (28px), pills `{rounded.pill}` (999px). ✅

### 2.5 Elevation system

One light from above: `{shadows.base}` for pills and panels, `{shadows.story-card}` (long soft drop plus a 1px hairline) for floating cards. ✅

### 2.6 Borders

Borders are inset box-shadow hairlines (`inset 0 0 0 1px` rule color), dashed lines only for measurement guides and scope rows. ✅

### 2.7 Accessibility quick-check

See `design-a11y.md`. Ink on ground 16.71:1; ink-2 6.52:1; ink-3 3.06:1 and accent 3.07:1 pass only for large text; white on accent 3.47:1 (large only), which is why accent text uses `{colors.accent-ink}`. Pills keep 44px height; reduced motion disables label transitions. ✅

## 3. Components Inventory

### 3.1 Generic components

#### pill
44px rounded pill, white with an inset hairline, 14px/500 text; scales to 0.97 on press over 160ms; hover darkens the hairline only on hover-capable devices. ✅

#### stepper
Row of step labels with an ink pill (`.story-pill`) that slides under the active one (transform and width, 420ms `{motion.ease}`); person steps use a burnt orange pill. ✅

### 3.2 Signature components

#### reel-card
Cards on a 3D reel. Container: `perspective: 1600px`, horizontal mask fading 10% at both edges. Each card gets `--i`; the reel sets `--k`. `--d = i - k`, `--a = |d|`, `--s = clamp(-1, d, 1)`. Transform: `translate(-50%,-50%) translateX(d * cw * 1.02) translateZ(a * -170px) rotateY(s * -40deg)` with `transform-origin` on the inner edge; `opacity = 1 - clamp(0, a - 1.8, 1)`. Hero deck variant: `perspective: 1400px`, cards flip (`rotateY(180deg)`, 640ms) and are draggable. ✅

#### measure-guide
Dashed accent lines (vertical and horizontal) around a headline word with small tags (`#57px`, `cap 0.72em`, `baseline`) on ground-colored chips; they fade in after 600ms when the block enters view, and the selection box moves with `clip-path` over 1.1s `{motion.ease-io}`. ✅

#### taste-card
Dark card on `{colors.dark-card}`: an isometric dot-matrix drawing (dots `#D9D7D0`, hot dots accent), a `01 / 18` counter, a title and a one-line rule. Hover lifts with transform over 260ms. ✅

Also observed: giant halftone lettering behind the hero (dots sampled from text, with a hot zone), story cards that stack upward (`--enter`, `--cover`), confetti from a CSS-var angle. ✅

## 4. Layout & Composition

### 4.1 Grid & containers

Full-bleed sections, 32px gutters, content left-aligned with large headlines; principles grid 3 columns at desktop. ✅

### 4.2 Composition patterns

Each section is one instrument: a reel, a measured headline, a grid of plotted drawings. Controls (pills, arrows, stepper) sit under the instrument, never over it. ✅

### 4.3 Responsive behavior

Card width follows the viewport height (`min(400px, 39vh)`), so reels fit short screens. Gutter drops to 16px on mobile. ⚠️ (mobile not captured)

### 4.4 Image behavior

No photos; every picture is drawn (canvas dot matrices, 36 canvases on the page) or a product screenshot inside a frame. ✅

## 5. Reconstruction Notes

- Drive every reel from two CSS variables; React only sets `--k` (and `--i` per card), CSS does the 3D math, transitions do the motion.
- Draw dot matrices on canvas: rasterize the subject to a small offscreen canvas, sample a grid, draw one dot per lit cell, color a chosen region hot; animate by easing dot radius or offset, not by redrawing shapes.
- Keep one easing (`{motion.ease}`) for movement and `{motion.ease-io}` only for reveals.
- Under reduced motion, cards jump to place and guides show without fading.

## 6. Do's and Don'ts

### Do

- Mark the measured or active thing with the accent, and only that.
- Use dot drawings instead of icons or photos for concepts.
- Let the reel math live in CSS variables.

### Don't

- Don't put the accent on body text (3.07:1).
- Don't stack effects on one element: a card either tilts in the reel or flips, not both at once.
- Don't add borders where spacing already separates.

## 7. Open Questions

- ❓ The curved "method, running" cards bend like paper; that warp is canvas or WebGL, not reproduced from CSS here.
- ❓ Mobile layout of the reels was not captured.

## 8. Companion files

- `design-a11y.md`: contrast table for the observed pairs.
- `design-tokens.json`: generated from this frontmatter.
