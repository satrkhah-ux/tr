"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, TrendingUp, TrendingDown } from "lucide-react";
import { PalmXNavbar } from "@/components/PalmXNavbar";
import { OkxFooter } from "@/components/OkxFooter";
import { useLanguage } from "@/components/LanguageProvider";
import { usePalmXStore } from "@/lib/store";

export default function MarketsPage() {
  const { t, isRTL } = useLanguage();
  const { assets } = usePalmXStore();
  const [search, setSearch] = useState("");
  const rtlFont = isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {};

  const activeCoins = assets.filter((a) => a.status === "active");

  const filtered = useMemo(
    () =>
      activeCoins.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.symbol.toLowerCase().includes(search.toLowerCase())
      ),
    [activeCoins, search]
  );

  return (
    <div className="min-h-screen bg-black text-white flex flex-col" dir={isRTL ? "rtl" : "ltr"}>
      <PalmXNavbar />

      <main className="flex-1 pt-24 pb-20">
        <div className="max-w-[1200px] mx-auto px-6 lg:px-12">
          {/* Header */}
          <div className="mb-10">
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-3" style={rtlFont}>
              {t.marketsHeading}
            </h1>
            <p className="text-white/50 text-sm" style={rtlFont}>{t.marketsSubtitle}</p>
          </div>

          {/* Search */}
          <div className="relative mb-6 max-w-sm">
            <Search className={`absolute ${isRTL ? "right-3" : "left-3"} top-1/2 -translate-y-1/2 w-4 h-4 text-white/30`} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.marketsSearchPlaceholder}
              className={`w-full bg-white/5 border border-white/10 rounded-xl py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#e2b700]/50 ${isRTL ? "pr-10 pl-4" : "pl-10 pr-4"}`}
              style={rtlFont}
            />
          </div>

          {/* Table */}
          <div className="bg-[#0a0a0a] border border-white/8 rounded-2xl overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[1.5rem_1fr_1fr_5rem] sm:grid-cols-[2rem_1fr_1fr_1fr_6rem] md:grid-cols-[2rem_1fr_1fr_1fr_1fr_7rem] gap-2 sm:gap-4 px-4 sm:px-5 py-3 border-b border-white/8 text-xs font-semibold text-white/30 uppercase tracking-wider">
              <span>#</span>
              <span style={rtlFont}>{t.marketsColName}</span>
              <span className="text-right" style={rtlFont}>{t.marketsColPrice}</span>
              <span className="hidden sm:block text-right" style={rtlFont}>{t.marketsCol24h}</span>
              <span className="hidden md:block text-right" style={rtlFont}>{t.marketsColVolume}</span>
              <span className="text-right" style={rtlFont}>{t.marketsColAction}</span>
            </div>

            {/* Rows */}
            {filtered.map((coin) => (
              <div
                key={coin.symbol}
                className="grid grid-cols-[1.5rem_1fr_1fr_5rem] sm:grid-cols-[2rem_1fr_1fr_1fr_6rem] md:grid-cols-[2rem_1fr_1fr_1fr_1fr_7rem] gap-2 sm:gap-4 items-center px-4 sm:px-5 py-3 sm:py-4 border-b border-white/5 hover:bg-white/3 transition-colors last:border-0"
              >
                <span className="text-xs text-white/30 font-mono">{coin.rank}</span>

                {/* Name + icon */}
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs text-white flex-shrink-0"
                    style={{ background: coin.color }}
                  >
                    {coin.symbol.slice(0, 2)}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{coin.name}</div>
                    <div className="text-xs text-white/40">{coin.symbol}</div>
                  </div>
                </div>

                {/* Price */}
                <div className="text-right font-mono text-sm text-white">{coin.price}</div>

                {/* 24h change */}
                <div
                  className={`hidden sm:flex text-right text-sm font-medium items-center justify-end gap-1 ${
                    coin.positive ? "text-[#0ecb81]" : "text-[#f6465d]"
                  }`}
                >
                  {coin.positive ? (
                    <TrendingUp className="w-3 h-3 flex-shrink-0" />
                  ) : (
                    <TrendingDown className="w-3 h-3 flex-shrink-0" />
                  )}
                  {coin.change}
                </div>

                {/* Volume */}
                <div className="hidden md:block text-right text-sm text-white/50 font-mono">
                  {coin.volume}
                </div>

                {/* Trade button */}
                <div className="text-right">
                  <Link
                    href={`/trade`}
                    className="inline-block px-4 py-1.5 text-xs font-semibold bg-[#e2b700]/10 hover:bg-[#e2b700]/20 text-[#e2b700] rounded-lg transition-colors border border-[#e2b700]/20"
                    style={rtlFont}
                  >
                    {t.marketsBtnTrade}
                  </Link>
                </div>
              </div>
            ))}

            {filtered.length === 0 && (
              <div className="py-16 text-center text-white/30 text-sm" style={rtlFont}>
                No results found for "{search}"
              </div>
            )}
          </div>
        </div>
      </main>

      <OkxFooter />
    </div>
  );
}
