"use client";

import Link from "next/link";
import { Smartphone, Shield, Zap, Bell, BarChart2, Lock } from "lucide-react";
import { PalmXNavbar } from "@/components/PalmXNavbar";
import { OkxFooter } from "@/components/OkxFooter";
import { useLanguage } from "@/components/LanguageProvider";

const APP_FEATURES = [
  { icon: Zap,       title: "Buy Crypto Instantly",     desc: "Buy BTC, ETH, USDT and 300+ assets in seconds using IQD, credit card, or bank transfer." },
  { icon: BarChart2, title: "Live Market Charts",        desc: "Professional TradingView charts with 50+ indicators. Switch between Spot, Futures, and P2P." },
  { icon: Shield,    title: "Bank-grade Security",       desc: "2FA, biometric login, anti-phishing codes, and cold storage for 95%+ of assets." },
  { icon: Bell,      title: "Smart Push Alerts",         desc: "Price alarms, order fills, and copy-trade signals delivered in real time." },
  { icon: Lock,      title: "One-tap Withdrawal",        desc: "Withdraw to Iraqi bank accounts or IQD wallets with 1-tap approval and instant confirmation." },
  { icon: Smartphone,title: "Arabic-first Interface",    desc: "Full RTL support, Arabic language, and Iraq-localized payment methods out of the box." },
];

export default function AppPage() {
  const { isRTL } = useLanguage();
  const arabicFont = isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {};

  return (
    <div className="min-h-screen bg-black text-white flex flex-col" dir={isRTL ? "rtl" : "ltr"}>
      <PalmXNavbar />

      <main className="flex-1">
        {/* Hero */}
        <section className="pt-32 pb-20 px-6 lg:px-12">
          <div className="max-w-[1100px] mx-auto grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <div
                className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full border border-[#e2b700]/30 text-[#e2b700] mb-6"
                style={arabicFont}
              >
                <Smartphone className="w-3.5 h-3.5" /> PalmX Mobile App
              </div>
              <h1 className="text-4xl lg:text-5xl font-bold text-white leading-tight mb-5" style={arabicFont}>
                Trade Crypto<br />
                <span style={{ color: "#e2b700" }}>From Anywhere</span>
              </h1>
              <p className="text-white/50 leading-relaxed mb-8" style={arabicFont}>
                The full power of PalmX — spot trading, P2P, copy trading, wallets, and 300+ coins —
                in the palm of your hand. Available for iOS and Android.
              </p>

              {/* Download buttons */}
              <div className={`flex flex-wrap gap-4 ${isRTL ? "flex-row-reverse" : ""}`}>
                <a
                  href="#"
                  className="flex items-center gap-3 px-5 py-3 bg-white text-black font-semibold rounded-xl hover:bg-white/90 transition-colors"
                >
                  <svg viewBox="0 0 24 24" className="w-6 h-6 fill-black flex-shrink-0" xmlns="http://www.w3.org/2000/svg">
                    <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                  </svg>
                  <div className={isRTL ? "text-right" : ""} style={arabicFont}>
                    <div className="text-[10px] leading-none text-black/60">Download on the</div>
                    <div className="text-sm font-bold leading-tight">App Store</div>
                  </div>
                </a>
                <a
                  href="#"
                  className="flex items-center gap-3 px-5 py-3 bg-white text-black font-semibold rounded-xl hover:bg-white/90 transition-colors"
                >
                  <svg viewBox="0 0 24 24" className="w-6 h-6 flex-shrink-0" xmlns="http://www.w3.org/2000/svg">
                    <path fill="#4CAF50" d="M1.22 0c-.03.08-.04.16-.04.25v23.5c0 .09.01.17.04.25l.13-.12L12 12.26v-.52L1.35.12 1.22 0z"/>
                    <path fill="#2196F3" d="M15.54 15.84l-3.54-3.54v-.52l3.54-3.54.07.04 4.14 2.35c1.18.67 1.18 1.76 0 2.43l-4.14 2.35-.07.04z"/>
                    <path fill="#FFC107" d="M15.61 15.8L12 12 1.22 23.75c.39.41 1.03.46 1.74.07L15.61 15.8"/>
                    <path fill="#F44336" d="M15.61 8.2L2.96.18C2.25-.21 1.61-.16 1.22.25L12 12l3.61-3.8z"/>
                  </svg>
                  <div className={isRTL ? "text-right" : ""} style={arabicFont}>
                    <div className="text-[10px] leading-none text-black/60">Get it on</div>
                    <div className="text-sm font-bold leading-tight">Google Play</div>
                  </div>
                </a>
              </div>

              {/* QR hint */}
              <p className="text-xs text-white/30 mt-5" style={arabicFont}>
                Or scan the QR code on any app store page to download instantly.
              </p>
            </div>

            {/* Phone mockup (stylised) */}
            <div className="flex justify-center">
              <div className="relative w-60 h-[480px] bg-[#141414] border-2 border-white/10 rounded-[40px] p-4 shadow-2xl shadow-[#e2b700]/5">
                {/* Status bar */}
                <div className="flex justify-between items-center px-2 py-1 mb-3">
                  <span className="text-[10px] text-white/40">9:41</span>
                  <div className="flex gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-white/30" />
                    <div className="w-1.5 h-1.5 rounded-full bg-white/30" />
                    <div className="w-1.5 h-1.5 rounded-full bg-white/30" />
                  </div>
                </div>
                {/* App UI mockup */}
                <div className="space-y-3 px-1">
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-lg">🌴</span>
                    <span className="text-sm font-bold text-white">Palm<span className="text-[#e2b700]">X</span></span>
                  </div>
                  <div className="bg-[#0a0a0a] rounded-xl p-3">
                    <div className="text-[10px] text-white/35 mb-0.5">Total Balance</div>
                    <div className="text-lg font-bold text-white">$24,812.40</div>
                    <div className="text-[10px] text-[#0ecb81] mt-0.5">+4.28% today</div>
                  </div>
                  {[
                    { coin: "₿", name: "Bitcoin", val: "$18,200", chg: "+3.1%" },
                    { coin: "Ξ", name: "Ethereum", val: "$4,100",  chg: "+5.4%" },
                    { coin: "₮", name: "Tether",   val: "$2,512",  chg: "+0.0%" },
                  ].map(({ coin, name, val, chg }) => (
                    <div key={name} className="flex items-center justify-between bg-[#0a0a0a] rounded-xl p-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-[#e2b700]/15 flex items-center justify-center text-xs font-bold text-[#e2b700]">{coin}</div>
                        <span className="text-[11px] text-white font-medium">{name}</span>
                      </div>
                      <div className="text-right">
                        <div className="text-[11px] text-white font-semibold">{val}</div>
                        <div className="text-[10px] text-[#0ecb81]">{chg}</div>
                      </div>
                    </div>
                  ))}
                </div>
                {/* Home indicator */}
                <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-16 h-1 bg-white/20 rounded-full" />
              </div>
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="py-20 px-6 lg:px-12 bg-[#0a0a0a]">
          <div className="max-w-[1100px] mx-auto">
            <h2 className="text-2xl font-bold text-white text-center mb-12" style={arabicFont}>
              Everything in One App
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {APP_FEATURES.map(({ icon: Icon, title, desc }) => (
                <div key={title} className="bg-[#141414] border border-white/8 rounded-xl p-6">
                  <div className="w-10 h-10 rounded-xl bg-[#e2b700]/10 flex items-center justify-center mb-4">
                    <Icon className="w-5 h-5 text-[#e2b700]" />
                  </div>
                  <h3 className="text-sm font-bold text-white mb-1.5" style={arabicFont}>{title}</h3>
                  <p className="text-xs text-white/45 leading-relaxed" style={arabicFont}>{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-24 px-6 text-center">
          <h2 className="text-3xl font-bold text-white mb-4" style={arabicFont}>Download PalmX Today</h2>
          <p className="text-white/40 mb-8 max-w-md mx-auto" style={arabicFont}>
            Join 70M+ traders and take your crypto portfolio with you everywhere.
          </p>
          <Link
            href="/dashboard"
            className="inline-flex px-10 py-4 bg-[#e2b700] hover:bg-[#f5ca00] text-black font-bold rounded-xl transition-colors"
            style={arabicFont}
          >
            Create Free Account
          </Link>
        </section>
      </main>

      <OkxFooter />
    </div>
  );
}
