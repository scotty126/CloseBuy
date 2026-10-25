/**
 * Shared Tailwind preset — every app's tailwind.config imports this so the
 * brand tokens are defined exactly once. CommonJS on purpose: Tailwind's
 * config loader expects it.
 *
 * Colours are CSS variables (space-separated RGB channels, so `bg-accent/20`
 * style opacity modifiers keep working) with a light set on :root and a dark
 * set on `.dark`. Palette comes from the "CloseBuy Redesign" canvas, direction
 * B (brand orange): Night #10231C ink on a warm off-white, forest-green
 * primary, orange reserved for action.
 */
const plugin = require("tailwindcss/plugin");

// Two palettes, both from the "CloseBuy Redesign" canvas, because the canvas itself uses two:
//  A (default) — the compact, mono-labelled screens: Home, Shop, Bag, Notifications, auth, legal and every staff app.
//  B (data-pal="b" on <html>) — the chunkier screens: Search, Product, Checkout, Tracking, Orders, Account, Onboarding, Location.
// They differ in ink, greys, borders, tinted wells and the product-tile colours, so each screen asks for its own.
const lightA = {
  "--c-surface": "250 247 243", // #FAF7F3
  "--c-card": "255 255 255",
  "--c-raised": "243 236 229", // #F3ECE5
  "--c-line": "234 225 216", // #EAE1D8
  "--c-ink": "14 31 25", // #0E1F19
  "--c-muted": "95 107 102", // #5F6B66
  "--c-primary": "37 87 72", // #255748
  "--c-accent": "255 90 25", // #FF5A19
  "--c-sale": "194 65 12", // #C2410C
  "--c-success": "30 142 90",
  "--c-warning": "184 134 11",
  "--c-danger": "209 67 67",
  "--c-side": "245 240 234", // #F5F0EA staff sidebar
  "--c-nav": "255 255 255",
  "--c-tile0": "253 231 219",
  "--c-tile1": "226 238 232",
  "--c-tile2": "251 241 214",
  "--c-tile3": "230 234 246",
  "--c-tile4": "246 230 236",
  "--c-tile5": "233 241 222",
};
const darkA = {
  "--c-surface": "10 23 19", // #0A1713
  "--c-card": "15 34 28", // #0F221C
  "--c-raised": "21 44 36", // #152C24
  "--c-line": "31 58 48", // #1F3A30
  "--c-ink": "243 238 233", // #F3EEE9
  "--c-muted": "147 166 157", // #93A69D
  "--c-primary": "24 63 51", // #183F33 (the dark hero green)
  "--c-accent": "255 90 25",
  "--c-sale": "255 122 69", // #FF7A45
  "--c-success": "61 190 133",
  "--c-warning": "224 176 64",
  "--c-danger": "240 112 112",
  "--c-side": "15 34 28",
  "--c-nav": "15 34 28",
  "--c-tile0": "244 201 180",
  "--c-tile1": "191 220 206",
  "--c-tile2": "242 223 163",
  "--c-tile3": "201 211 238",
  "--c-tile4": "234 198 212",
  "--c-tile5": "205 226 182",
};
const lightB = {
  "--c-raised": "252 237 227", // #FCEDE3
  "--c-line": "240 226 216", // #F0E2D8
  "--c-ink": "16 35 28", // #10231C
  "--c-muted": "91 107 100", // #5B6B64
  "--c-tile0": "255 227 211",
  "--c-tile1": "220 235 228",
  "--c-tile2": "255 240 201",
  "--c-tile3": "227 232 247",
  "--c-tile4": "247 225 234",
  "--c-tile5": "230 240 216",
};
const darkB = {
  "--c-surface": "15 36 29", // #0F241D
  "--c-card": "22 49 40", // #163128
  "--c-raised": "31 61 50", // #1F3D32
  "--c-line": "36 70 58", // #24463A
  "--c-ink": "255 244 236", // #FFF4EC
  "--c-muted": "169 189 180", // #A9BDB4
  "--c-primary": "44 102 82", // #2C6652
  "--c-tile0": "255 212 190",
  "--c-tile1": "201 227 215",
  "--c-tile2": "255 231 168",
  "--c-tile3": "210 219 245",
  "--c-tile4": "244 207 221",
  "--c-tile5": "214 232 193",
};

const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

module.exports = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: v("primary"),
        accent: v("accent"),
        ink: v("ink"),
        // Fixed Night — text that sits on orange (or any brand fill) must
        // not flip with the theme the way `ink` does.
        night: "#10231C",
        paper: v("card"),
        card: v("card"),
        raised: v("raised"),
        line: v("line"),
        sale: v("sale"),
        success: v("success"),
        warning: v("warning"),
        danger: v("danger"),
        muted: v("muted"),
        surface: v("surface"),
        side: v("side"),
        nav: v("nav"),
        tile0: v("tile0"),
        tile1: v("tile1"),
        tile2: v("tile2"),
        tile3: v("tile3"),
        tile4: v("tile4"),
        tile5: v("tile5"),
      },
      // The canvas never sets a line-height except where it says so (headings), i.e. it uses the browser default
      // ("normal"). Tailwind's named sizes bundle a line-height, so pin them all to normal.
      fontSize: {
        xs: ["12px", "normal"],
        sm: ["14px", "normal"],
        base: ["16px", "normal"],
        lg: ["18px", "normal"],
        xl: ["20px", "normal"],
        "2xl": ["24px", "normal"],
        "3xl": ["30px", "normal"],
        "4xl": ["36px", "normal"],
      },
      fontFamily: {
        // Set by next/font/google in each app's layout.tsx (--font-geist /
        // --font-geist-mono CSS variables). next/font self-hosts the files, so
        // there is no runtime Google Fonts request.
        sans: ["var(--font-geist)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
        // The "CloseBuy" wordmark is Montserrat 800 in the canvas, everywhere it appears as text.
        display: ["var(--font-montserrat)", "var(--font-geist)", "system-ui", "sans-serif"],
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
  plugins: [
    plugin(({ addBase }) => {
      addBase({
        html: { lineHeight: "normal" },
        ":root": lightA,
        ".dark": { ...darkA, colorScheme: "dark" },
        // Palette B: only the values that differ. Specificity order matters — dark B must beat dark A.
        ':root[data-pal="b"]': lightB,
        '.dark[data-pal="b"]': { ...darkB, colorScheme: "dark" },
        // Native form controls default to white/black in the browser, which is
        // wrong on the dark palette. Utilities (bg-transparent, bg-card …) still win.
        "input, select, textarea": {
          backgroundColor: "rgb(var(--c-card))",
          color: "rgb(var(--c-ink))",
        },
      });
    }),
  ],
};
