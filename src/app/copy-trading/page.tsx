"use client";

import Link from "next/link";
import { TrendingUp, Users, Shield, Zap, Star, Copy, BarChart2, Bell } from "lucide-react";
import { PalmXNavbar } from "@/components/PalmXNavbar";
import { OkxFooter } from "@/components/OkxFooter";
import { useLanguage } from "@/components/LanguageProvider";

const TOP_TRADERS = [
  { name: "Ahmad Al-Rashid", handle: "@ahmad_crypto", roi: "+412%", followers: "12.4K", winRate: "78%", drawdown: "8.2%", badge: "🥇" },
  { name: "Sara M.",         handle: "@sara_trades",  roi: "+289%", followers: "9.1K",  winRate: "74%", drawdown: "11%",  badge: "🥈" },
  { name: "Khalid FX",      handle: "@khalid_fx",    roi: "+241%", followers: "7.8K",  winRate: "71%", drawdown: "9.6%", badge: "🥉" },
  { name: "Lena K.",        handle: "@lena_btc",     roi: "+198%", followers: "5.3K",  winRate: "68%", drawdown: "13%",  badge: "⭐" },
  { name: "Mark D.",        handle: "@markd_defi",   roi: "+176%", followers: "4.9K",  winRate: "66%", drawdown: "10%",  badge: "⭐" },
  { name: "Farid T.",       handle: "@farid_trades", roi: "+154%", followers: "3.7K",  winRate: "64%", drawdown: "12%",  badge: "⭐" },
];

const HOW_IT_WORKS = [
  { icon: Users,     step: "01", title: "Browse Top Traders",      desc: "Explore verified traders ranked by ROI, win rate, and drawdown. Filter by risk level, strategy, or trading pair." },
  { icon: Copy,      step: "02", title: "Allocate Your Budget",     desc: "Choose how much of your portfolio to allocate. Set a max loss limit and your trades mirror theirs automatically." },
  { icon: TrendingUp,step: "03", title: "Earn While They Trade",    desc: "Every time the trader opens or closes a position, your account follows. Withdraw anytime, no lock-in period." },
];

const FEATURES = [
  { icon: Shield,   title: "Auto Risk Controls",   desc: "Built-in stop-loss protection. Your copy automatically pauses if drawdown exceeds your set limit." },
  { icon: Zap,      title: "Instant Execution",    desc: "Trades copied in real-time with millisecond sync — you never miss an entry." },
  { icon: BarChart2,title: "Full Transparency",    desc: "Every trade history, strategy, and performance stat for every trader is fully public." },
  { icon: Bell,     title: "Smart Alerts",         desc: "Get notified when your copied trader opens a new position, hits a target, or breaks a streak." },
  { icon: Star,     title: "Become a Trader",      desc: "Build followers, earn up to 10% commission on profits generated from your copiers." },
  { icon: Users,    title: "Community Portfolio",  desc: "Diversify by copying up to 5 traders simultaneously from one allocation screen." },
];

export default function CopyTradingPage() {
  const { isRTL } = useLanguage();
  const arabicFont = isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {};

  return (
    <div className="min-h-screen bg-black text-white flex flex-col" dir={isRTL ? "rtl" : "ltr"}>
      <PalmXNavbar />

      <main className="flex-1">
        {/* Hero */}
        <section className="pt-32 pb-20 px-6 lg:px-12 max-w-[1200px] mx-auto text-center">
          <div
            className="inline-flex items-center gap-2 text-xs font-semibold tracking-wider uppercase px-3 py-1.5 rounded-full border border-[#e2b700]/30 text-[#e2b700] mb-6"
            style={arabicFont}
          >
            <TrendingUp className="w-3.5 h-3.5" /> Copy Trading
          </div>
          <h1 className="text-4xl lg:text-6xl font-bold text-white leading-tight mb-6" style={arabicFont}>
            Mirror the Moves of<br />
            <span style={{ color: "#e2b700" }}>Top Crypto Traders</span>
          </h1>
          <p className="text-white/55 max-w-2xl mx-auto text-lg mb-10 leading-relaxed" style={arabicFont}>
            Select a proven trader, set your budget, and let their strategy work for you —
            fully automated, fully transparent, zero experience needed.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/dashboard"
              className="px-8 py-3.5 bg-[#e2b700] hover:bg-[#f5ca00] text-black font-bold rounded-xl transition-colors"
              style={arabicFont}
            >
              Start Copying Now
            </Link>
            <Link
              href="#traders"
              className="px-8 py-3.5 border border-white/15 hover:border-white/30 text-white font-semibold rounded-xl transition-colors"
              style={arabicFont}
            >
              View Top Traders
            </Link>
          </div>
          {/* Quick stats */}
          <div className="mt-16 grid grid-cols-3 gap-6 max-w-lg mx-auto">
            {[
              { val: "8,400+", lbl: "Active Traders" },
              { val: "$2.1B+", lbl: "Funds Copied" },
              { val: "avg +247%", lbl: "Annual ROI (top 10)" },
            ].map(({ val, lbl }) => (
              <div key={lbl}>
                <div className="text-2xl font-bold text-[#e2b700]">{val}</div>
                <div className="text-xs text-white/40 mt-1" style={arabicFont}>{lbl}</div>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="py-20 px-6 lg:px-12 bg-[#0a0a0a]">
          <div className="max-w-[1200px] mx-auto">
            <h2 className="text-2xl font-bold text-white text-center mb-12" style={arabicFont}>
              How Copy Trading Works
            </h2>
            <div className="grid md:grid-cols-3 gap-6">
              {HOW_IT_WORKS.map(({ icon: Icon, step, title, desc }) => (
                <div key={step} className="bg-[#141414] border border-white/8 rounded-2xl p-8 relative overflow-hidden">
                  <div className="absolute top-4 right-5 text-5xl font-black text-white/4 select-none">{step}</div>
                  <div className="w-12 h-12 rounded-xl bg-[#e2b700]/10 flex items-center justify-center mb-5">
                    <Icon className="w-6 h-6 text-[#e2b700]" />
                  </div>
                  <h3 className="text-base font-bold text-white mb-2" style={arabicFont}>{title}</h3>
                  <p className="text-sm text-white/50 leading-relaxed" style={arabicFont}>{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Top traders leaderboard */}
        <section id="traders" className="py-20 px-6 lg:px-12">
          <div className="max-w-[1200px] mx-auto">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-10">
              <h2 className="text-2xl font-bold text-white" style={arabicFont}>Top Traders Leaderboard</h2>
              <span className="text-xs text-white/35" style={arabicFont}>Performance over last 12 months</span>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-white/8">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/8 bg-[#0a0a0a]">
                    {["Trader", "12M ROI", "Win Rate", "Max Drawdown", "Followers", ""].map((h) => (
                      <th
                        key={h}
                        className={`px-5 py-3.5 text-xs font-semibold text-white/35 uppercase tracking-wider ${isRTL ? "text-right" : "text-left"}`}
                        style={arabicFont}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {TOP_TRADERS.map(({ name, handle, roi, followers, winRate, drawdown, badge }) => (
                    <tr key={handle} className="border-b border-white/5 hover:bg-white/2 transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <span className="text-xl">{badge}</span>
                          <div>
                            <div className="font-semibold text-white text-sm" style={arabicFont}>{name}</div>
                            <div className="text-xs text-white/35">{handle}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 font-bold text-[#0ecb81]">{roi}</td>
                      <td className="px-5 py-4 text-white/70">{winRate}</td>
                      <td className="px-5 py-4 text-[#f6465d]/80">{drawdown}</td>
                      <td className="px-5 py-4 text-white/55">{followers}</td>
                      <td className="px-5 py-4">
                        <Link
                          href="/dashboard"
                          className="px-4 py-1.5 bg-[#e2b700]/10 hover:bg-[#e2b700]/20 text-[#e2b700] text-xs font-semibold rounded-lg transition-colors"
                          style={arabicFont}
                        >
                          Copy
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="text-center mt-6">
              <Link
                href="/dashboard"
                className="text-sm text-[#e2b700] hover:text-[#f5ca00] transition-colors"
                style={arabicFont}
              >
                View all 8,400+ traders →
              </Link>
            </div>
          </div>
        </section>

        {/* Features grid */}
        <section className="py-20 px-6 lg:px-12 bg-[#0a0a0a]">
          <div className="max-w-[1200px] mx-auto">
            <h2 className="text-2xl font-bold text-white text-center mb-12" style={arabicFont}>
              Everything You Need to Copy Smarter
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {FEATURES.map(({ icon: Icon, title, desc }) => (
                <div key={title} className="bg-[#141414] border border-white/8 rounded-xl p-6">
                  <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center mb-4">
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
        <section className="py-24 px-6 lg:px-12">
          <div className="max-w-[640px] mx-auto text-center">
            <h2 className="text-3xl font-bold text-white mb-4" style={arabicFont}>
              Ready to Copy the Best?
            </h2>
            <p className="text-white/45 mb-8" style={arabicFont}>
              Create your free PalmX account and start copying top traders in under 2 minutes.
            </p>
            <Link
              href="/dashboard"
              className="inline-flex px-10 py-4 bg-[#e2b700] hover:bg-[#f5ca00] text-black font-bold rounded-xl transition-colors text-base"
              style={arabicFont}
            >
              Get Started Free
            </Link>
          </div>
        </section>
      </main>

      <OkxFooter />
    </div>
  );
}
