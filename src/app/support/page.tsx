"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, MessageSquare, Mail, BookOpen, ChevronRight, CheckCircle2, AlertCircle, Info } from "lucide-react";
import { PalmXNavbar } from "@/components/PalmXNavbar";
import { OkxFooter } from "@/components/OkxFooter";
import { useLanguage } from "@/components/LanguageProvider";

const CATEGORIES = [
  { icon: "🪙", label: "Getting Started",      articles: 12, href: "#" },
  { icon: "💱", label: "Buying & Selling",     articles: 18, href: "#" },
  { icon: "🏦", label: "Deposits & Withdrawals",articles: 14, href: "#" },
  { icon: "🔐", label: "Account & Security",    articles: 22, href: "#" },
  { icon: "📊", label: "Trading & Orders",      articles: 30, href: "#" },
  { icon: "👥", label: "P2P Trading",           articles: 10, href: "#" },
  { icon: "🤖", label: "Trading Bots",          articles:  8, href: "#" },
  { icon: "⚖️", label: "Fees & Limits",         articles: 11, href: "#" },
];

const POPULAR = [
  { q: "How do I verify my identity (KYC)?",                        href: "#" },
  { q: "Why is my withdrawal pending?",                              href: "#" },
  { q: "How to buy crypto with Iraqi Dinar (IQD)?",                 href: "#" },
  { q: "What are PalmX trading fees?",                               href: "#" },
  { q: "How do I enable two-factor authentication (2FA)?",           href: "#" },
  { q: "How to transfer crypto to an external wallet?",              href: "#" },
];

const STATUS_LIST = [
  { service: "Trading Engine",   status: "operational" },
  { service: "Deposits",         status: "operational" },
  { service: "Withdrawals",      status: "operational" },
  { service: "P2P Marketplace",  status: "operational" },
  { service: "Mobile App (iOS)", status: "operational" },
  { service: "Mobile App (Android)", status: "operational" },
];

const STATUS_ICON = {
  operational:    { icon: CheckCircle2, color: "#0ecb81",  label: "Operational" },
  degraded:       { icon: AlertCircle,  color: "#e2b700",  label: "Degraded" },
  outage:         { icon: AlertCircle,  color: "#f6465d",  label: "Outage" },
};

export default function SupportPage() {
  const { isRTL } = useLanguage();
  const arabicFont = isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {};
  const [query, setQuery] = useState("");

  return (
    <div className="min-h-screen bg-black text-white flex flex-col" dir={isRTL ? "rtl" : "ltr"}>
      <PalmXNavbar />

      <main className="flex-1">
        {/* Hero */}
        <section className="pt-32 pb-16 px-6 lg:px-12 bg-gradient-to-b from-[#0a0a0a] to-black">
          <div className="max-w-[700px] mx-auto text-center">
            <div
              className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full border border-[#e2b700]/30 text-[#e2b700] mb-6"
              style={arabicFont}
            >
              <BookOpen className="w-3.5 h-3.5" /> Support Center
            </div>
            <h1 className="text-4xl font-bold text-white mb-4" style={arabicFont}>How can we help?</h1>
            <p className="text-white/45 mb-8" style={arabicFont}>
              Search our help articles, or contact support 24/7.
            </p>
            {/* Search */}
            <div className="relative">
              <Search className={`absolute ${isRTL ? "right-4" : "left-4"} top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none`} />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search help articles..."
                className={`w-full bg-[#141414] border border-white/10 rounded-xl ${isRTL ? "pr-11 pl-4" : "pl-11 pr-4"} py-3.5 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#e2b700]/50`}
                style={arabicFont}
              />
            </div>
          </div>
        </section>

        {/* Contact channels */}
        <section className="py-10 px-6 lg:px-12">
          <div className="max-w-[1100px] mx-auto grid sm:grid-cols-3 gap-4">
            {[
              { icon: MessageSquare, label: "Live Chat",     sublabel: "Available 24/7 — avg. response < 2 min", href: "#",                    cta: "Start Chat" },
              { icon: Mail,          label: "Email Support", sublabel: "support@palmx.com — reply within 24h",   href: "mailto:support@palmx.com", cta: "Send Email" },
              { icon: Info,          label: "Request Status",sublabel: "Check system & withdrawal status",        href: "#status",               cta: "View Status" },
            ].map(({ icon: Icon, label, sublabel, href, cta }) => (
              <a
                key={label}
                href={href}
                className="flex flex-col gap-3 bg-[#0a0a0a] border border-white/8 hover:border-white/15 transition-colors rounded-2xl p-6"
              >
                <div className="w-10 h-10 rounded-xl bg-[#e2b700]/10 flex items-center justify-center">
                  <Icon className="w-5 h-5 text-[#e2b700]" />
                </div>
                <div>
                  <div className="text-sm font-bold text-white" style={arabicFont}>{label}</div>
                  <div className="text-xs text-white/35 mt-0.5" style={arabicFont}>{sublabel}</div>
                </div>
                <span className="text-xs font-semibold text-[#e2b700] flex items-center gap-1" style={arabicFont}>
                  {cta} <ChevronRight className="w-3 h-3" />
                </span>
              </a>
            ))}
          </div>
        </section>

        {/* Categories */}
        <section className="py-16 px-6 lg:px-12 bg-[#0a0a0a]">
          <div className="max-w-[1100px] mx-auto">
            <h2 className="text-xl font-bold text-white mb-8" style={arabicFont}>Browse by Category</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {CATEGORIES.map(({ icon, label, articles, href }) => (
                <a
                  key={label}
                  href={href}
                  className="flex items-center gap-4 bg-[#141414] border border-white/8 hover:border-white/15 transition-colors rounded-xl p-4 group"
                >
                  <span className="text-2xl flex-shrink-0">{icon}</span>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white truncate" style={arabicFont}>{label}</div>
                    <div className="text-xs text-white/35 mt-0.5" style={arabicFont}>{articles} articles</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-white/20 group-hover:text-white/50 transition-colors ml-auto flex-shrink-0" />
                </a>
              ))}
            </div>
          </div>
        </section>

        {/* Popular & Status */}
        <section className="py-16 px-6 lg:px-12">
          <div className="max-w-[1100px] mx-auto grid lg:grid-cols-2 gap-8">
            {/* Popular articles */}
            <div>
              <h2 className="text-xl font-bold text-white mb-6" style={arabicFont}>Popular Articles</h2>
              <div className="space-y-2">
                {POPULAR.map(({ q, href }) => (
                  <a
                    key={q}
                    href={href}
                    className="flex items-center justify-between gap-3 bg-[#0a0a0a] border border-white/8 hover:border-white/15 transition-colors rounded-xl px-5 py-3.5 group"
                  >
                    <span className="text-sm text-white/70 group-hover:text-white transition-colors" style={arabicFont}>{q}</span>
                    <ChevronRight className="w-4 h-4 text-white/20 group-hover:text-white/50 transition-colors flex-shrink-0" />
                  </a>
                ))}
              </div>
            </div>

            {/* System status */}
            <div id="status">
              <h2 className="text-xl font-bold text-white mb-6" style={arabicFont}>System Status</h2>
              <div className="bg-[#0a0a0a] border border-white/8 rounded-2xl overflow-hidden">
                {STATUS_LIST.map(({ service, status }, i) => {
                  const { icon: Icon, color, label } = STATUS_ICON[status as keyof typeof STATUS_ICON];
                  return (
                    <div
                      key={service}
                      className={`flex items-center justify-between px-5 py-3.5 ${i < STATUS_LIST.length - 1 ? "border-b border-white/5" : ""}`}
                    >
                      <span className="text-sm text-white/70" style={arabicFont}>{service}</span>
                      <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color }}>
                        <Icon className="w-3.5 h-3.5" />{label}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-white/25 mt-3" style={arabicFont}>Last checked: just now</p>
            </div>
          </div>
        </section>
      </main>

      <OkxFooter />
    </div>
  );
}
