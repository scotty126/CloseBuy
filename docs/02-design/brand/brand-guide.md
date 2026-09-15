# CloseBuy — Brand Guide

- **Status:** Draft
- **Date:** 2026-09-15
- **Stage:** 02 — Design

## Naming — resolved

An earlier draft of this project used the working name "NearBuy" for a short stretch, which didn't match the supplied wordmark artwork. That's settled now: **CloseBuy is the confirmed product name**, matching the logo files exactly as supplied. No wordmark regeneration needed — the assets below are final as-is.

## Assets on file

All under `docs/02-design/brand/`, sourced from the original uploads.

| File | Contents | Use |
|---|---|---|
| `logo-primary-light.png` | Icon + horizontal wordmark + tagline, dark marks | On light/white backgrounds |
| `logo-primary-dark.png` | Same lockup, light marks | On dark backgrounds |
| `logo-stacked-light.png` | Icon + two-line wordmark ("Close" / "Buy") + tagline, dark marks | Narrow or near-square placements, light backgrounds |
| `logo-stacked-dark.png` | Same, light marks | Narrow placements, dark backgrounds |
| `icon-light.png` | Bag mark alone, for light/transparent backgrounds | Favicons, app icons, avatars |
| `icon-dark.png` | Bag mark alone, for dark/transparent backgrounds | Dark-mode favicons and app icons |

Tagline as supplied: *"Daily needs, delivered fast."* — reads as a fit for the product regardless of which name wins; carries over unchanged.

## Colour palette

Sampled directly from the icon artwork (pixel-exact, not eyeballed):

| Token | Hex | RGB | Role |
|---|---|---|---|
| `--color-primary` | `#255748` | 37, 87, 72 | Forest green — bag fill, primary brand surface |
| `--color-accent` | `#FF5A19` | 255, 90, 25 | Orange — strap/smile accent, CTAs, highlights, price badges |
| `--color-ink` | `#000000` | 0, 0, 0 | Wordmark on light, body text default |
| `--color-paper` | `#FFFFFF` | 255, 255, 255 | Wordmark on dark, light-mode background |

Two tokens only, deliberately: green for brand surfaces and trust-signal chrome (headers, nav, vendor/status badges), orange reserved for **action** — buttons, active states, price emphasis, notification dots. Mixing them freely dilutes the "orange = do something" signal DoorDash relies on for its own red.

Functional colours (not in the source art, needed for UI states — chosen to sit comfortably with the two brand colours and pass WCAG AA against white):

| Token | Hex | Role |
|---|---|---|
| `--color-success` | `#1E8E5A` | Delivered, payout cleared, approved |
| `--color-warning` | `#B8860B` | Pending, awaiting acceptance |
| `--color-danger` | `#D14343` | Cancelled, failed, rejected, disputed |
| `--color-muted` | `#6B7280` | Secondary text, disabled state |
| `--color-surface` | `#F7F7F5` | App background (off-white, not pure white — matches the artifact-design baseline this stack already follows) |

`--color-danger` is deliberately a plain red, not the brand orange, so a cancelled/failed state is never visually confused with a call-to-action.

## Typography

The wordmark uses a rounded, confident sans (bold weight for "Close", the same weight in orange for "Buy", a lighter italic for the tagline). No specific typeface is identified from the raster alone. Recommendation: **Inter** or **Manrope** for product UI — both are free, have excellent Latin coverage, render well at small sizes on low-end Android (NFR-10), and are available as an exact-version pin from `cdnjs` if any part of this ever needs a web artifact. The wordmark itself stays as a logo asset (image), not live text — logos are never re-set in a body font.

## Logo usage rules

- Minimum clear space around the primary lockup: the height of the bag icon, on all sides.
- Never stretch, recolour, or rotate the bag icon — its silhouette (the slight forward lean, per `icon-light.png`/`icon-dark.png`) is the recognisable asset.
- Use the **stacked** lockup only where width is genuinely constrained (e.g. a square app-store icon slot needing a wordmark too); default to the **primary** horizontal lockup everywhere else, including all four app headers.
- The standalone icon (`icon-light`/`icon-dark`) is what becomes the favicon, the PWA home-screen icon, and the notification icon — it needs to read correctly at 48×48px, which the current mark does comfortably given its simple two-tone silhouette.

## How this maps onto the four surfaces

- **Customer app** — primary lockup in the header on light background; icon as PWA home-screen icon; orange reserved for "Add to cart", "Place order", active nav item, and price text.
- **Vendor / Admin dashboards** — more neutral, data-dense UI; green used sparingly (active nav, primary buttons), functional colours carry most of the weight (order-state badges, alerts).
- **Rider app** — high contrast, outdoor/glare-readable: green header bar, white content area, orange only on the primary action per screen ("Accept job", "Confirm pickup", "Confirm delivery") so there is never ambiguity about which button matters on a phone glanced at mid-delivery.
