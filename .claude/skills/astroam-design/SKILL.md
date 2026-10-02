---
name: astroam-design
description: AstroAm's design system. Load before touching any screen, component or token of frontend/ (landing, mission wizard, deposit, eSIM, trip dashboard, modals), before choosing color, type, spacing, icons, motion, focus or states, before adding a carousel, dot-matrix drawing or measurement guide, and before calling a screen finished. It overrules the code; when a screen disagrees, fix the screen.
---

# AstroAm design

Source of truth for `frontend/`. Values come from the running code (`tailwind.config.js`, `src/styles/globals.css`, components). The motion and signature pieces adopted from kerostack.vercel.app are documented in `docs/design/reference-kerostack/design.md`; this file says how they are used here.

## 1. What the product is on screen

- **Landing** (`/`): desktop and phone, a traveler deciding whether to trust pay-per-MB data in USDC. One long page.
- **Mission app** (`/mission/new`, `/mission/esim`, `/mission/active`): phone first, used before and during a trip, often one-handed, sometimes on bad connections.
- **Demo / hackathon judges**: the same screens on a laptop; payments may be simulated and say so.

## 2. The brand

- The **ship** (`assets/ship-night.png`, the A with a violet orbit and a gold star) and the **moving starfield** behind every screen (`components/StarfieldBackground.tsx`). They appear on every surface; nothing covers the starfield with an opaque full-width fill.
- **Dot-matrix drawings** (from the reference): concepts are plotted as dots in `textprimary` with a cluster of **gold hot dots** (`starlight` #FDDA24) on the subject. Gold is the star of the logo; it marks what is measured or active and nothing else. Used for: hero lettering, concept cards, how-it-works art. Never on buttons, body text or numbers that must be read.

## 3. Color

Roles (Tailwind names kept from the Stellar era):

| Role | Token | Value |
|:--|:--|:--|
| Ground | `bglight` | #070814 |
| Card (glass over stars) | `cardbg` + `.glass` | rgba(18,19,44,.72) + blur 10px |
| Sunk panel | `warmneutral` | #0C0D22 |
| Hairline | `cardborder` | #272A55 |
| Field / control border | `#6B6E9E` | 3.97:1 on sunk, WCAG 1.4.11 |
| Text | `textprimary` / `textsecondary` | #F3F1FF / #A6A3C9 (8.26:1) |
| Primary action | `primaryviolet` | #6A45FF, hover #5B36F0 (white text 5.37:1) |
| Violet text on dark | `#B9A6FF` | never `primaryviolet` as text |
| Accent cyan | `tealbrand` | #2FD0DD |
| Hot / measured | `starlight` | #FDDA24 |
| Success / error | `online` / `alerta` | #3DDC97 / #FF6B7A; destructive button fill #C8323F |

Rules: text never sits on `primaryviolet` lighter than #6A45FF (white drops below 4.5). QR codes keep a white plate so cameras read them.

## 4. Type and numbers

- Display: Space Grotesk 700, uppercase for section titles, tight tracking. Body: Inter. Labels and codes: Space Mono, uppercase, wide tracking.
- Balances, prices and MB use Space Grotesk (every digit distinct); never the dot-matrix or a pixel face.
- Running text 45 to 75 characters per line. Minimum readable text 12px for mono labels (deliberate style), 14px for anything a person must read to act.

## 5. Space, shape and depth

- Spacing from the Tailwind 4px scale; 6, 10 and 14px are legacy and should not be added.
- Radii: pills 999px, controls 12px (`rounded-xl`), cards 16 to 24px, hero panels 24px, story cards 28px. Inner radius = outer minus inset, except pills and chips, which stay fully round inside any card (kero-audit lists them as nested-radius warnings; they are accepted).
- Depth is **glow, not drop shadow**: `shadow-[0_0_Npx_rgba(123,92,255,a)]` around primary actions and the active card, growing with importance. One light: violet from the element itself.

## 6. Images, icons and marks

- Icons: Material Symbols Outlined only, sized to the text beside them (16 to 24px).
- Concept pictures are dot-matrix canvases (`components/dots/`), not stock icons or photos.
- Logos: `logo-night.png` in headers, `logo-footer-night.png` in the footer.
- Where the adopted pieces live: `components/reel/Reel.tsx` (hero reel of seven concept cards, looping; how-it-works story reel of four numbered cards, controlled by the stepper), `components/dots/` (DotIcon, DotLettering), `components/MeasuredSection.tsx` (the measured headline). Reuse them; do not build a second carousel.

## 7. Navigation

- Landing: fixed header with one primary action (START MISSION). On phones the badge hides and the action shortens to START.
- App: sticky header (back, logo, status badge); bottom nav on phones (Mission, eSIM, Activity). The wizard keeps Back / Continue in a sticky bar.

## 8. Motion

- Curves: `ease-out-quint` `cubic-bezier(.23,1,.32,1)` for anything that moves; `cubic-bezier(.77,0,.175,1)` only for reveals.
- **Reels** (adopted): 3D card carousels driven by two CSS variables, `--i` per card and `--k` on the reel; CSS computes `translateX(d * w)`, `translateZ(|d| * -170px)`, `rotateY(sign(d) * -40deg)`, opacity fades past 1.8 cards. Card moves take 620ms. Arrows, drag/swipe and arrow keys move `--k`; autoplay pauses on hover, focus and when off screen.
- **Stepper pill**: the active pill slides under the current step in 420ms.
- **Measurement guides**: dashed lines and tags fade in 600ms after the block enters view.
- Starfield and dot drawings animate continuously but softly; press feedback is `scale(.97)` over 160ms.
- Reduced motion: no autoplay, reels jump, guides show at once, starfield and dots draw one still frame.

## 9. Focus, keyboard and touch

- Every control 44px on touch. Focus: violet glow ring on buttons and cards; text fields show their caret.
- Reels are keyboard reachable: the reel has `role="group"` with a label, arrows are real buttons, Left/Right move it.
- `touch-action: manipulation` on controls; reels use `touch-action: pan-y` so vertical scroll still works.

## 10. States

- Server offline: banner with Retry, never a blank screen. Simulated payments: gold SIMULATED chip wherever money moves.
- Activity: empty state with a dot icon and one line; rows show VOUCHER SIGNED / DEPOSITED / NOT COVERED.
- Wallet deposit: each step (connect, approve, deposit, confirming) is the button label while it runs.

## 11. Writing

- English, neutral register. Say what goes in and what comes out (USDC in, data out, the rest back). Prices in USDC/MB, balances in USDC with 2 decimals.
- Never mention Stellar, Soroban or CosmoPay; the chain is Monad.

## 12. Automatic rejection

- The first Monad redesign (flat dark, pixel astronaut, WebGPU signal shader): rejected; the Stellar-era layout with the ship stays.
- Phone mockups with a weird antenna or a dynamic island over content: rejected in the demo video.
- Light theme for the app: replaced by dark because the starfield needs it.

## 13. Project traps

- `pkill -f vite` kills the agent's own shell; stop the dev server by its port's PID.
- Vite does not reload `tailwind.config.js`; restart the dev server after token changes before measuring.
- Headless Chromium on Linux paints WebGPU black; the starfield is Canvas 2D on purpose.
- The logo and ship PNGs are dark ink; only the `*-night.png` versions are visible on the ground.
- Canvases inside reel cards are 3D-transformed: size them with `clientWidth/Height`, never `getBoundingClientRect`, or the drawing squashes.
- Anything placed from a measured position (guide tags) is clamped to its container, or phones get a horizontal scroll; reels clip with `overflow-x: clip`.
- Canvas text needs `weight size family` in that order (`700 64px "Space Grotesk"`); a weight after the size silently falls back.
- `review-animations` (Emil Kowalski) can only be run by the person (`/review-animations`); ask them before delivering new motion.

## 14. Open decisions

- Whether to switch display type to Instrument Sans like the reference (not decided; Space Grotesk stays).
- Whether the bent-paper warp of the reference's story cards is worth a WebGL pass.

## 15. Before saying it is done

- Does kero-audit pass on `/` and `/mission/new` at 390x844 and 1440x900, and on the in-flow screens?
- Is gold only on what is measured or active?
- Does every moving thing stop under reduced motion?
- Can a reel be used with only a keyboard and with only a thumb?
