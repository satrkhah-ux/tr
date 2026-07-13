"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { translate, type Language, type Translator } from "@/lib/i18n";

export type ViewMode = "table" | "cards";
export type ThemeMode = "Light" | "Dark" | "System";

type TraveliunUIContextValue = {
  view: ViewMode;
  setView: (view: ViewMode) => void;
  language: Language;
  setLanguage: (language: Language) => void;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  dir: "rtl" | "ltr";
  t: Translator;
};

const TraveliunUIContext = createContext<TraveliunUIContextValue | null>(null);

const STORAGE_KEY = "traveliun-ui";

type PersistedState = { view: ViewMode; language: Language; theme: ThemeMode };

function readPersisted(): Partial<PersistedState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<PersistedState>) : {};
  } catch {
    return {};
  }
}

function applyTheme(theme: ThemeMode): void {
  if (typeof document === "undefined") return;
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  const isDark = theme === "Dark" || (theme === "System" && prefersDark);
  document.documentElement.classList.toggle("dark", isDark);
}

export function TraveliunUIProvider({ children }: { children: ReactNode }) {
  const [view, setViewState] = useState<ViewMode>("table");
  const [language, setLanguageState] = useState<Language>("ar");
  const [theme, setThemeState] = useState<ThemeMode>("System");

  // hydrate from localStorage on mount (avoids SSR/client mismatch)
  useEffect(() => {
    const persisted = readPersisted();
    if (persisted.view) setViewState(persisted.view);
    if (persisted.language) setLanguageState(persisted.language);
    if (persisted.theme) setThemeState(persisted.theme);
  }, []);

  const persist = useCallback((next: Partial<PersistedState>) => {
    if (typeof window === "undefined") return;
    const current = readPersisted();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ view, language, theme, ...current, ...next }));
  }, [view, language, theme]);

  // apply theme (+ react to system changes when in System mode)
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "System" || typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("System");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  // apply language direction to the document
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.lang = language;
    document.documentElement.dir = language === "ar" ? "rtl" : "ltr";
  }, [language]);

  const setView = useCallback((next: ViewMode) => { setViewState(next); persist({ view: next }); }, [persist]);
  const setLanguage = useCallback((next: Language) => { setLanguageState(next); persist({ language: next }); }, [persist]);
  const setTheme = useCallback((next: ThemeMode) => { setThemeState(next); persist({ theme: next }); }, [persist]);

  const dir = language === "ar" ? "rtl" : "ltr";
  const t = useCallback<Translator>((key, params) => translate(language, key, params), [language]);

  return (
    <TraveliunUIContext.Provider value={{ view, setView, language, setLanguage, theme, setTheme, dir, t }}>
      {children}
    </TraveliunUIContext.Provider>
  );
}

export function useTraveliunUI(): TraveliunUIContextValue {
  const ctx = useContext(TraveliunUIContext);
  if (!ctx) {
    // Safe fallback (e.g. client-offer page outside the provider) — Arabic, table, light.
    return {
      view: "table",
      setView: () => {},
      language: "ar",
      setLanguage: () => {},
      theme: "System",
      setTheme: () => {},
      dir: "rtl",
      t: (key, params) => translate("ar", key, params),
    };
  }
  return ctx;
}
