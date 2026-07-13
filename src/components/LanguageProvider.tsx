"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { Locale } from "@/lib/palmx-i18n";
import { translations } from "@/lib/palmx-i18n";

interface LanguageContextType {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: typeof translations.en;
  isRTL: boolean;
}

const LanguageContext = createContext<LanguageContextType>({
  locale: "en",
  setLocale: () => {},
  t: translations.en,
  isRTL: false,
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  // NOTE: this legacy PalmX provider intentionally does NOT touch
  // document.documentElement.dir/lang. The Traveliun UI provider is the single
  // authority over document direction/language; two writers would fight over it.
  const setLocale = (l: Locale) => {
    setLocaleState(l);
    localStorage.setItem("palmx-locale", l);
  };

  useEffect(() => {
    const saved = localStorage.getItem("palmx-locale") as Locale | null;
    if (saved === "ar" || saved === "en") {
      setLocaleState(saved);
    }
  }, []);

  return (
    <LanguageContext.Provider
      value={{
        locale,
        setLocale,
        t: translations[locale] as typeof translations.en,
        isRTL: locale === "ar",
      }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
