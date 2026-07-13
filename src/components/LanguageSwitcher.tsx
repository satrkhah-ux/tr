"use client";

import { useLanguage } from "@/components/LanguageProvider";

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale } = useLanguage();

  return (
    <div className="flex items-center gap-1 bg-white/8 rounded-lg p-0.5">
      <button
        onClick={() => setLocale("en")}
        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
          locale === "en"
            ? "bg-[#e2b700] text-black"
            : "text-white/50 hover:text-white"
        }`}
        aria-label="Switch to English"
      >
        EN
      </button>
      <button
        onClick={() => setLocale("ar")}
        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
          locale === "ar"
            ? "bg-[#e2b700] text-black"
            : "text-white/50 hover:text-white"
        }`}
        aria-label="التبديل إلى العربية"
      >
        AR
      </button>
    </div>
  );
}
