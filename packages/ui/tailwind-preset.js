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
      keyframes: {
        // A quantity changing is otherwise a silent text swap — this gives
        // it a small tactile "received" pulse. Re-triggered by remounting
        // the element on a `key={quantity}` change (animation-fill-mode
        // alone doesn't replay on a value change, only on a fresh mount).
        bump: {
          "0%": { transform: "scale(1.3)" },
          "100%": { transform: "scale(1)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        bump: "bump 0.2s ease-out",
        "fade-in": "fade-in 0.15s ease-out",
      },
    },
  },
};
