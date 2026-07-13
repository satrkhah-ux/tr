"use client";

import Link from "next/link";
import { TrendingUp, TrendingDown } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

const cryptos = [
  { symbol: "BTC", name: "Bitcoin",   price: "$66,807.80", change: "+0.47%", positive: true,  href: "/price/bitcoin-btc",   color: "#f7931a", initial: "₿" },
  { symbol: "ETH", name: "Ethereum",  price: "$2,037.03",  change: "+1.81%", positive: true,  href: "/price/ethereum-eth",  color: "#627eea", initial: "Ξ" },
  { symbol: "USDT",name: "Tether",    price: "$0.99918",   change: "+0.00%", positive: true,  href: "/price/tether-usdt",   color: "#26a17b", initial: "₮" },
  { symbol: "XRP", name: "XRP",       price: "$1.3292",    change: "+0.44%", positive: true,  href: "/price/xrp-xrp",       color: "#00aae4", initial: "✕" },
  { symbol: "SOL", name: "Solana",    price: "$83.3600",   change: "+1.91%", positive: true,  href: "/price/solana-sol",    color: "#9945ff", initial: "◎" },
  { symbol: "LTC", name: "Litecoin",  price: "$53.3800",   change: "-0.39%", positive: false, href: "/price/litecoin-ltc",  color: "#bfbbbb", initial: "Ł" },
];

export function PortfolioSection() {
  const { t, isRTL } = useLanguage();

  return (
    <section className="py-24 bg-[#080808]" dir={isRTL ? "rtl" : "ltr"}>
      <div className="max-w-[1440px] mx-auto px-6 lg:px-12">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          <div className={isRTL ? "text-right" : ""}>
            <h2
              className="text-3xl md:text-4xl lg:text-[2.75rem] font-bold text-white leading-tight mb-4"
              style={isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {}}
            >
              {t.portfolioHeading}
            </h2>
            <p
              className="text-white/55 text-lg leading-relaxed mb-8 max-w-[480px]"
              style={isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {}}
            >
              {t.portfolioSubtitle}
            </p>
            <Link
              href="/p2p"
              className="inline-flex px-6 py-3 bg-[#e2b700] hover:bg-[#f5ca00] text-black text-sm font-semibold rounded-xl transition-colors"
            >
              {t.portfolioCta}
            </Link>
          </div>

          <div className="space-y-3">
            {cryptos.map((coin) => (
              <Link
                key={coin.symbol}
                href={coin.href}
                className="flex items-center justify-between p-4 bg-[#141414] border border-white/8 rounded-xl hover:border-white/15 hover:bg-[#181818] transition-all group"
              >
                <div className={`flex items-center gap-3 ${isRTL ? "flex-row-reverse" : ""}`}>
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                    style={{ backgroundColor: `${coin.color}20`, color: coin.color }}
                  >
                    {coin.initial}
                  </div>
                  <div className={isRTL ? "text-right" : ""}>
                    <p className="text-sm font-semibold text-white group-hover:text-[#e2b700] transition-colors">
                      {coin.symbol}
                    </p>
                    <p className="text-xs text-white/40">{coin.name}</p>
                  </div>
                </div>
                <div className={`${isRTL ? "text-left" : "text-right"}`}>
                  <p className="text-sm font-semibold text-white">{coin.price}</p>
                  <div
                    className={`flex items-center ${isRTL ? "justify-start flex-row-reverse" : "justify-end"} gap-0.5 text-xs font-medium ${
                      coin.positive ? "text-[#0ecb81]" : "text-[#f6465d]"
                    }`}
                  >
                    {coin.positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {coin.change}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

