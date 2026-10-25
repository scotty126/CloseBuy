/**
 * Brand tokens — light-mode values. The runtime source of truth is the CSS
 * variable set in tailwind-preset.js (which also holds the dark palette);
 * these are kept in sync by hand for the rare place that needs a raw hex
 * (e.g. an SVG chart), there are only a handful of values.
 *
 * Palette is direction B of the "CloseBuy Redesign" canvas: Night ink on a
 * warm off-white, forest-green primary, orange reserved for action.
 */
export const colors = {
  primary: "#255748", // forest green — brand surfaces, headers, nav
  accent: "#FF5A19", // orange — reserved for action: CTAs, active states
  ink: "#10231C", // Night — text; text ON orange is always this, in both themes
  paper: "#FFFFFF", // card surface
  sale: "#C2410C", // discounted price

  // Functional — chosen for WCAG AA against the card surface
  success: "#1E8E5A", // delivered, payout cleared, approved
  warning: "#B8860B", // pending, awaiting acceptance
  danger: "#D14343", // cancelled, failed, rejected, disputed — plain red, never the brand orange
  muted: "#5B6B64", // secondary text, disabled
  surface: "#FAF7F3", // app background
  line: "#F0E2D8", // borders, dividers
} as const;

export type ColorToken = keyof typeof colors;
