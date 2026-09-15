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
        sans: ["Inter", "system-ui", "sans-serif"],
      },
    },
  },
};
