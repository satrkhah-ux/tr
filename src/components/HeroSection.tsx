"use client";

import Link from "next/link";
import Image from "next/image";
import { useLanguage } from "@/components/LanguageProvider";

const partners = [
  {
    name: "Tribeca Festival",
    src: "https://www.okx.com/cdn/assets/imgs/236/DD7AC9432E675714.png",
  },
  {
    name: "McLaren Formula 1 Team",
    src: "https://www.okx.com/cdn/assets/imgs/2210/499A92F3657A52EC.png",
  },
  {
    name: "Manchester City",
    src: "https://www.okx.com/cdn/assets/imgs/2210/6279B178FADAFCC5.png",
  },
];

export function HeroSection() {
  const { t, isRTL } = useLanguage();

  return (
    <section
      className="relative min-h-screen flex flex-col justify-center overflow-hidden bg-black pt-16"
      dir={isRTL ? "rtl" : "ltr"}
    >
      {/* Background gradient */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-0 right-0 h-[70vh] bg-gradient-to-b from-[#0a0700] via-black to-black" />
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[900px] h-[600px] rounded-full bg-[#e2b700]/5 blur-[120px]" />
      </div>

      <div className="relative max-w-[1440px] mx-auto px-6 lg:px-12 w-full">
        <div className="grid lg:grid-cols-2 gap-12 items-center min-h-[calc(100vh-64px)] py-20">
          {/* Left: copy */}
          <div className={`flex flex-col ${isRTL ? "items-end text-right" : "items-start"}`}>
            {/* PalmX badge */}
            <div className="flex items-center gap-2 bg-[#e2b700]/10 border border-[#e2b700]/20 rounded-full px-4 py-1.5 mb-4">
              <span className="text-[#e2b700] text-sm" aria-hidden="true">🌴</span>
              <span className="text-[#e2b700] text-xs font-semibold tracking-wide uppercase">PalmX</span>
            </div>
            <h1
              className="text-4xl md:text-5xl lg:text-[3.5rem] xl:text-[4rem] font-bold leading-[1.1] tracking-tight text-white mb-6"
              style={isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {}}
            >
              {t.heroTagline}
            </h1>
            <p
              className="text-lg text-white/60 mb-8 max-w-[480px] leading-relaxed"
              style={isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {}}
            >
              {t.heroSubtitle}
            </p>

            <div className={`flex flex-wrap items-center gap-3 mb-16 ${isRTL ? "flex-row-reverse" : ""}`}>
              <Link
                href="/dashboard"
                className="px-6 py-3 bg-[#e2b700] hover:bg-[#f5ca00] text-black text-sm font-semibold rounded-xl transition-colors"
              >

                {t.heroSignup}
              </Link>
              <Link
                href="/wallet"
                className="px-6 py-3 border border-white/20 hover:border-white/40 text-white text-sm font-semibold rounded-xl transition-colors flex items-center gap-2"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M5 20h14v-2H5v2zm7-18L5.33 9h3.84v5h5.66V9h3.84L12 2z" />
                </svg>
                {t.heroDownload}
              </Link>
            </div>

            {/* Partner logos */}
            <div className={isRTL ? "text-right" : ""}>
              <p
                className="text-xs text-white/40 uppercase tracking-widest mb-4"
                style={isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {}}
              >
                {t.heroPartners}
              </p>
              <div className={`flex items-center gap-8 ${isRTL ? "flex-row-reverse" : ""}`}>
                {partners.map((p) => (
                  <Image
                    key={p.name}
                    src={p.src}
                    alt={p.name}
                    width={100}
                    height={32}
                    className="h-7 w-auto object-contain opacity-60 hover:opacity-100 transition-opacity"
                    unoptimized
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Right: decorative trading UI mockup */}
          <div className="hidden lg:flex justify-center items-center">
            <div className="relative w-full max-w-[480px]">
              {/* Main card */}
              <div className="bg-[#141414] border border-white/8 rounded-2xl p-6 shadow-2xl">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <p className="text-xs text-white/40 mb-1">BTC / USDT</p>
                    <p className="text-3xl font-bold text-white">$66,807.80</p>
                    <p className="text-sm text-[#0ecb81] mt-1">+0.47% (24h)</p>
                  </div>
                  <div className="w-12 h-12 rounded-full bg-[#f7931a]/10 flex items-center justify-center">
                    <span className="text-2xl">₿</span>
                  </div>
                </div>

                {/* Mini chart bars */}
                <div className="flex items-end gap-1 h-16 mb-6">
                  {[35, 55, 45, 70, 50, 65, 80, 60, 72, 85, 68, 90, 75, 88, 82, 95, 78, 92].map(
                    (h, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-sm"
                        style={{
                          height: `${h}%`,
                          backgroundColor:
                            i > 12 ? "rgba(14, 203, 129, 0.7)" : "rgba(255, 255, 255, 0.12)",
                        }}
                      />
                    )
                  )}
                </div>

                {/* Order book summary */}
                <div className="grid grid-cols-2 gap-3">
                  <button className="py-3 bg-[#0ecb81]/10 hover:bg-[#0ecb81]/20 text-[#0ecb81] font-semibold rounded-xl transition-colors text-sm">
                    {t.tradeBuy}
                  </button>
                  <button className="py-3 bg-[#f6465d]/10 hover:bg-[#f6465d]/20 text-[#f6465d] font-semibold rounded-xl transition-colors text-sm">
                    {t.tradeSell}
                  </button>
                </div>
              </div>

              {/* Floating stats cards */}
              <div className={`absolute -top-6 ${isRTL ? "-left-6" : "-right-6"} bg-[#1a1a1a] border border-white/8 rounded-xl p-3 shadow-xl`}>
                <p className="text-xs text-white/40">{t.tradeVolume}</p>
                <p className="text-sm font-bold text-white">$2.4B</p>
              </div>
              <div className={`absolute -bottom-6 ${isRTL ? "-right-6" : "-left-6"} bg-[#1a1a1a] border border-white/8 rounded-xl p-3 shadow-xl`}>
                <p className="text-xs text-white/40">{t.tradeActiveUsers}</p>
                <p className="text-sm font-bold text-white">70M+</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
