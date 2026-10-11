/**
 * Shared Tailwind preset — every app's tailwind.config imports this so the
 * brand tokens (docs/02-design/brand/brand-guide.md) are defined exactly
 * once. CommonJS on purpose: Tailwind's config loader expects it.
 */
module.exports = {
  theme: {
    extend: {
      colors: {
        primary: "#255748",
        accent: "#FF5A19",
        ink: "#000000",
        paper: "#FFFFFF",
        success: "#1E8E5A",
        warning: "#B8860B",
        danger: "#D14343",
        muted: "#6B7280",
        surface: "#F7F7F5",
      },
      fontFamily: {
        // Set by next/font/google in each app's layout.tsx (--font-inter CSS
        // variable) — was literally "Inter" here before, which Tailwind can
        // only resolve to a font actually present on the system, so every
        // screen silently fell back to system-ui the whole time. next/font
        // self-hosts the real files (no runtime Google Fonts request) and
        // sets the variable; system-ui/sans-serif stay as the fallback for
        // the instant before it loads.
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
    },
  },
};
