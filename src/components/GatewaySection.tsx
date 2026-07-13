"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Bot, TrendingUp, Users } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

export function GatewaySection() {
  const [activeTab, setActiveTab] = useState("trade");
  const { t, isRTL } = useLanguage();

  const tabs = [
    { id: "trade", label: t.gatewayTrade, icon: <TrendingUp className="w-5 h-5" />, desc: t.gatewayTradeDesc, features: ["300+ cryptocurrencies", "Low trading fees", "Advanced charting", "Real-time order book"], cta: t.startTrading, href: "/trade" },
    { id: "bots",  label: t.gatewayBots,  icon: <Bot className="w-5 h-5" />,        desc: t.gatewayBotsDesc,  features: ["DCA bot", "Grid bot", "Futures grid", "Arbitrage bot"],                           cta: t.exploreBots, href: "/trade" },
    { id: "earn",  label: t.gatewayEarn,  icon: <span className="text-base">💰</span>, desc: t.gatewayEarnDesc, features: ["Savings accounts", "Staking", "Structured products", "ETH staking"],             cta: t.startEarning, href: "/dashboard" },
    { id: "copy",  label: t.gatewayCopy,  icon: <Users className="w-5 h-5" />,       desc: t.gatewayCopyDesc, features: ["Top trader leaderboard", "Auto-copy trades", "Risk management", "Live tracking"],  cta: t.copyTopTraders, href: "/trade" },
  ];

  const current = tabs.find((t) => t.id === activeTab)!;

  const mockData: Record<string, { col1: string; col2: string; col3: string; pos?: boolean }[]> = {
    trade: [
      { col1: "BTC/USDT", col2: "$66,807", col3: "+0.47%", pos: true },
      { col1: "ETH/USDT", col2: "$2,037",  col3: "+1.81%", pos: true },
      { col1: "SOL/USDT", col2: "$83.36",  col3: "+1.91%", pos: true },
    ],
    bots: [
      { col1: "DCA bot",      col2: "+12.3%", col3: "Active" },
      { col1: "Grid bot",     col2: "+8.7%",  col3: "Active" },
      { col1: "Futures grid", col2: "+5.1%",  col3: "Paused" },
    ],
    earn: [
      { col1: "ETH",  col2: "4.5% APY", col3: "Staking" },
      { col1: "USDT", col2: "8.2% APY", col3: "Savings" },
      { col1: "BTC",  col2: "6.0% APY", col3: "Structured" },
    ],
    copy: [
      { col1: "CryptoWolf",  col2: "+142%", col3: "12.4K" },
      { col1: "TradeMaster", col2: "+98%",  col3: "8.7K" },
      { col1: "BullRunner",  col2: "+87%",  col3: "6.2K" },
    ],
  };

  return (
    <section className="py-24 bg-black" dir={isRTL ? "rtl" : "ltr"}>
      <div className="max-w-[1440px] mx-auto px-6 lg:px-12">
        <div className="text-center mb-12">
          <h2
            className="text-3xl md:text-4xl lg:text-[2.75rem] font-bold text-white mb-4"
            style={isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {}}
          >
            {t.gatewayHeading}
          </h2>
        </div>

        <div className="flex flex-wrap justify-center gap-2 mb-12">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                activeTab === tab.id
                  ? "bg-[#e2b700] text-black"
                  : "bg-[#141414] text-white/60 hover:text-white hover:bg-[#1e1e1e] border border-white/8"
              }`}
              style={isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {}}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        <div className="bg-[#141414] border border-white/8 rounded-2xl overflow-hidden">
          <div className="grid lg:grid-cols-2">
            <div className={`p-10 lg:p-14 flex flex-col justify-center ${isRTL ? "text-right" : ""}`}>
              <p className="text-white/40 text-xs uppercase tracking-widest mb-3">{current.label}</p>
              <h3
                className="text-2xl md:text-3xl font-bold text-white mb-4"
                style={isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {}}
              >
                {current.desc}
              </h3>
              <ul className="space-y-3 mb-8">
                {current.features.map((f) => (
                  <li key={f} className={`flex items-center gap-3 text-sm text-white/60 ${isRTL ? "flex-row-reverse" : ""}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-[#e2b700] flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href={current.href}
                className={`inline-flex items-center gap-2 px-6 py-3 bg-[#e2b700] hover:bg-[#f5ca00] text-black text-sm font-semibold rounded-xl transition-colors w-fit ${isRTL ? "flex-row-reverse" : ""}`}
              >
                {current.cta}
                <ArrowRight className={`w-4 h-4 ${isRTL ? "rotate-180" : ""}`} />
              </Link>
            </div>

            <div className="bg-[#0d0d0d] p-10 lg:p-14 flex items-center justify-center border-l border-white/8">
              <div className="w-full max-w-sm space-y-3">
                {mockData[activeTab].map((row, i) => (
                  <div
                    key={i}
                    className={`flex justify-between items-center bg-[#141414] rounded-xl px-4 py-3 text-sm ${isRTL ? "flex-row-reverse" : ""}`}
                  >
                    <span className="font-medium text-white">{row.col1}</span>
                    <span className="text-[#0ecb81] font-semibold">{row.col2}</span>
                    <span className="text-xs text-white/40">{row.col3}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

