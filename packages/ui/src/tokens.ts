/**
 * Brand tokens — pixel-sampled from the source logo artwork.
 * Source of truth: docs/02-design/brand/brand-guide.md — keep in sync by hand,
 * there are only a handful of values.
 */
export const colors = {
  primary: "#255748", // forest green — brand surfaces, headers, nav
  accent: "#FF5A19", // orange — reserved for action: CTAs, active states, price
  ink: "#000000",
  paper: "#FFFFFF",

  // Functional — not in the source art, chosen for WCAG AA against white
  success: "#1E8E5A", // delivered, payout cleared, approved
  warning: "#B8860B", // pending, awaiting acceptance
  danger: "#D14343", // cancelled, failed, rejected, disputed — plain red, never the brand orange
  muted: "#6B7280", // secondary text, disabled
  surface: "#F7F7F5", // app background, off-white
} as const;

export type ColorToken = keyof typeof colors;
