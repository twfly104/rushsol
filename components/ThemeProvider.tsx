"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Theme = "dark" | "day";

interface ThemeCtx {
  theme: Theme;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

/**
 * Light/dark theme controller.
 *
 * Strategy: a class on the <html> element (".day") flips the CSS variable
 * tokens defined in globals.css. The choice is persisted to localStorage
 * and applied before first paint via an inline script in layout.tsx to
 * avoid a flash of wrong theme.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const stored = (typeof window !== "undefined" && localStorage.getItem("rush-theme")) as Theme | null;
    if (stored === "day" || stored === "dark") setTheme(stored);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("day", theme === "day");
    try { localStorage.setItem("rush-theme", theme); } catch {}
  }, [theme]);

  const toggle = () => setTheme((t) => (t === "dark" ? "day" : "dark"));

  return <Ctx.Provider value={{ theme, toggle }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTheme must be inside ThemeProvider");
  return ctx;
}
