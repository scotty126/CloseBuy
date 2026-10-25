"use client";

import { useEffect, useLayoutEffect, useState } from "react";

const STORAGE_KEY = "closebuy.theme";

type Theme = "light" | "dark";

/**
 * Runs before first paint (rendered inline in <head>) so a dark-mode user
 * never sees a light flash. Stored choice wins; otherwise the OS preference.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem("${STORAGE_KEY}");if(!t){t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.classList.toggle("dark",t==="dark")}catch(e){}})()`;

/**
 * The canvas uses two colour palettes (see tailwind-preset.js): A is the default, B is switched on per route by
 * `data-pal="b"` on <html>. `paletteBPattern` is a regex source matched against the path so the very first paint
 * already has the right one; `usePalette` keeps it right on client-side navigation.
 */
export function ThemeScript({ paletteBPattern }: { paletteBPattern?: string } = {}) {
  const palette = paletteBPattern
    ? `try{document.documentElement.dataset.pal=new RegExp(${JSON.stringify(paletteBPattern)}).test(location.pathname)?"b":"a"}catch(e){}`
    : "";
  return <script dangerouslySetInnerHTML={{ __html: themeInitScript + ";" + palette }} />;
}

/** Layout effect, not a plain effect, so a route change never paints a frame in the wrong palette. */
export function usePalette(isB: boolean) {
  useLayoutEffect(() => {
    document.documentElement.dataset.pal = isB ? "b" : "a";
  }, [isB]);
}

function readTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("light");

  useEffect(() => {
    setThemeState(readTheme());
  }, []);

  function setTheme(next: Theme) {
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode / blocked storage: the choice just won't persist.
    }
    setThemeState(next);
  }

  return { theme, setTheme, toggle: () => setTheme(theme === "dark" ? "light" : "dark") };
}

/** `plain` drops the rounded white button for a bare icon (the compact headers); `size` is the icon size in px. */
export function ThemeToggle({ className = "", plain = false, size = 18 }: { className?: string; plain?: boolean; size?: number }) {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className={`flex items-center justify-center text-ink transition-transform active:scale-95 ${plain ? "h-11 w-10" : "h-11 w-11 rounded-[14px] bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)]"} ${className}`}
    >
      {dark ? (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
        </svg>
      )}
    </button>
  );
}
