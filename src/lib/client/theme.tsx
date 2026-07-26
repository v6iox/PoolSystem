"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type ThemeMode = "dark" | "light" | "auto";

export interface ThemePreset {
  id: string;
  name: string;
  h: number;
  s: number;
  l: number;
}

export const THEME_PRESETS: ThemePreset[] = [
  { id: "moonpool", name: "Moonpool", h: 187, s: 78, l: 62 },
  { id: "lagoon", name: "Lagoon", h: 168, s: 72, l: 55 },
  { id: "abyssal", name: "Abyssal", h: 215, s: 85, l: 64 },
  { id: "ember", name: "Ember Swim", h: 16, s: 88, l: 62 },
  { id: "biolume", name: "Biolumines", h: 140, s: 70, l: 58 },
  { id: "orchid", name: "Night Orchid", h: 300, s: 60, l: 68 },
];

export interface ThemeSettings {
  mode: ThemeMode;
  oled: boolean;
  presetId: string;
  /** Custom accent overrides the preset when set. */
  customAccent: { h: number; s: number; l: number } | null;
  ambientMotion: boolean;
}

const DEFAULT_THEME: ThemeSettings = {
  mode: "dark",
  oled: false,
  presetId: "moonpool",
  customAccent: null,
  ambientMotion: true,
};

interface ThemeContextValue {
  theme: ThemeSettings;
  setTheme: (patch: Partial<ThemeSettings>) => void;
  resolvedMode: "dark" | "light";
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "moonpool-theme";

function readStored(): ThemeSettings {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_THEME;
    return { ...DEFAULT_THEME, ...(JSON.parse(raw) as Partial<ThemeSettings>) };
  } catch {
    return DEFAULT_THEME;
  }
}

function apply(theme: ThemeSettings, fade: boolean): "dark" | "light" {
  const root = document.documentElement;
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved: "dark" | "light" = theme.mode === "auto" ? (systemDark ? "dark" : "light") : theme.mode;
  if (fade) {
    root.setAttribute("data-theme-fade", "true");
    window.setTimeout(() => root.removeAttribute("data-theme-fade"), 500);
  }
  root.setAttribute("data-mode", resolved);
  root.setAttribute("data-oled", theme.oled ? "true" : "false");
  const preset = THEME_PRESETS.find((p) => p.id === theme.presetId) ?? THEME_PRESETS[0]!;
  const accent = theme.customAccent ?? preset;
  root.style.setProperty("--accent-h", String(accent.h));
  root.style.setProperty("--accent-s", `${accent.s}%`);
  root.style.setProperty("--accent-l", `${accent.l}%`);
  return resolved;
}

export function ThemeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [theme, setThemeState] = useState<ThemeSettings>(readStored);
  const [resolvedMode, setResolvedMode] = useState<"dark" | "light">("dark");

  useEffect(() => {
    setResolvedMode(apply(theme, false));
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (): void => setResolvedMode(apply(readStored(), true));
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setTheme = useCallback((patch: Partial<ThemeSettings>): void => {
    setThemeState((prev) => {
      const next = { ...prev, ...patch };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setResolvedMode(apply(next, true));
      const path = window.location.pathname;
      if (path.startsWith("/login") || path.startsWith("/setup") || path.startsWith("/offline")) return next;
      // Persist per-user on the server too (fire and forget).
      void fetch("/api/settings/prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: next }),
      }).catch(() => undefined);
      return next;
    });
  }, []);

  // Adopt server-side prefs once (e.g. new browser, existing account).
  useEffect(() => {
    // Pre-auth pages have no session — skip the fetch instead of logging a 401.
    const path = window.location.pathname;
    if (path.startsWith("/login") || path.startsWith("/setup") || path.startsWith("/offline")) return;
    void fetch("/api/settings/prefs")
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { prefs?: { theme?: Partial<ThemeSettings> } } | null) => {
        if (json?.prefs?.theme && !window.localStorage.getItem(STORAGE_KEY)) {
          const next = { ...DEFAULT_THEME, ...json.prefs.theme };
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          setThemeState(next);
          setResolvedMode(apply(next, true));
        }
      })
      .catch(() => undefined);
  }, []);

  const value = useMemo(() => ({ theme, setTheme, resolvedMode }), [theme, setTheme, resolvedMode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme outside ThemeProvider");
  return ctx;
}

/** Inline script string that applies stored theme before hydration (no flash). */
export const THEME_INIT_SCRIPT = `(function(){try{var t=JSON.parse(localStorage.getItem("${STORAGE_KEY}")||"{}");var m=t.mode||"dark";if(m==="auto"){m=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}var r=document.documentElement;r.setAttribute("data-mode",m);r.setAttribute("data-oled",t.oled?"true":"false");var presets={moonpool:[187,78,62],lagoon:[168,72,55],abyssal:[215,85,64],ember:[16,88,62],biolume:[140,70,58],orchid:[300,60,68]};var a=t.customAccent?[t.customAccent.h,t.customAccent.s,t.customAccent.l]:(presets[t.presetId]||presets.moonpool);r.style.setProperty("--accent-h",a[0]);r.style.setProperty("--accent-s",a[1]+"%");r.style.setProperty("--accent-l",a[2]+"%")}catch(e){}})()`;
