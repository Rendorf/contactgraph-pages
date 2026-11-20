"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Minus, Monitor, Moon, Palette, Zap } from "lucide-react";
import { ThemeProvider as NextThemeProvider, useTheme } from "next-themes";

export const APPEARANCE_THEMES = ["warm", "dark", "cyberpunk", "minimal", "system"] as const;
export type AppearanceTheme = (typeof APPEARANCE_THEMES)[number];

const appearanceLabels: Record<AppearanceTheme, string> = {
  warm: "Warm",
  dark: "Dark",
  cyberpunk: "Cyberpunk",
  minimal: "Minimal",
  system: "System",
};

const themeColors: Record<Exclude<AppearanceTheme, "system"> | "light", string> = {
  warm: "#f5f3ed",
  light: "#f5f3ed",
  dark: "#101716",
  cyberpunk: "#070914",
  minimal: "#f8f8f6",
};

type DesignPreviewContextValue = { enabled: boolean; setEnabled: (enabled: boolean) => void; mounted: boolean };
const DesignPreviewContext = createContext<DesignPreviewContextValue>({ enabled: true, setEnabled: () => undefined, mounted: false });
const legacyStorageKey = "contactgraph.design.legacy.enabled.v1";

function ThemeChrome() {
  const { theme, resolvedTheme } = useTheme();
  useEffect(() => {
    const effective = theme === "system" ? resolvedTheme : theme;
    const color = themeColors[(effective && effective in themeColors ? effective : "warm") as keyof typeof themeColors];
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = color;
    document.documentElement.style.colorScheme = effective === "dark" || effective === "cyberpunk" ? "dark" : "light";
  }, [resolvedTheme, theme]);
  return null;
}

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [previewEnabled, setPreviewEnabledState] = useState(true);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    try { setPreviewEnabledState(window.localStorage.getItem(legacyStorageKey) !== "true"); }
    catch { setPreviewEnabledState(true); }
    setMounted(true);
  }, []);
  const setEnabled = (enabled: boolean) => {
    setPreviewEnabledState(enabled);
    try { window.localStorage.setItem(legacyStorageKey, String(!enabled)); } catch { /* Presentation preference remains in memory. */ }
  };
  const preview = useMemo(() => ({ enabled: previewEnabled, setEnabled, mounted }), [mounted, previewEnabled]);
  return <NextThemeProvider attribute="data-theme" defaultTheme="warm" enableSystem storageKey="contactgraph.appearance.theme.v1" themes={[...APPEARANCE_THEMES.filter(theme => theme !== "system")]}>
    <DesignPreviewContext.Provider value={preview}><ThemeChrome />{children}</DesignPreviewContext.Provider>
  </NextThemeProvider>;
}

export function useDesignPreview() { return useContext(DesignPreviewContext); }

const themeIcons: Record<AppearanceTheme, typeof Palette> = {
  warm: Palette,
  dark: Moon,
  cyberpunk: Zap,
  minimal: Minus,
  system: Monitor,
};

export function AppearancePicker({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const selected = APPEARANCE_THEMES.includes(theme as AppearanceTheme) ? theme as AppearanceTheme : "warm";
  return <div className={`appearance-picker ${compact ? "compact" : ""}`} role="group" aria-label="Color regime">
    {APPEARANCE_THEMES.map((value) => {
      const Icon = themeIcons[value];
      const active = mounted && selected === value;
      return <button key={value} type="button" className={active ? "active" : ""} aria-pressed={active} onClick={() => setTheme(value)}>
        <span className={`appearance-swatch ${value}`}><Icon aria-hidden="true" /></span><span>{appearanceLabels[value]}</span>
      </button>;
    })}
  </div>;
}

export function AppearanceSettings() {
  const { enabled, setEnabled, mounted } = useDesignPreview();
  return <section className="settings-card appearance-settings-card">
    <header><div className="settings-icon"><Palette /></div><div><h2>Appearance</h2><p>Choose how ContactGraph looks on this device.</p></div></header>
    <div className="settings-card-body">
      <AppearancePicker />
      <p className="appearance-help">System uses Warm for a light operating-system preference and Dark for a dark preference. Cyberpunk changes color and typography only.</p>
      <label className="appearance-preview-toggle"><span><strong>Temporary legacy interface</strong><small>Return to the previous navigation on this device during the transition period.</small></span><input type="checkbox" checked={mounted && !enabled} disabled={!mounted} onChange={(event) => setEnabled(!event.target.checked)} /></label>
    </div>
  </section>;
}
