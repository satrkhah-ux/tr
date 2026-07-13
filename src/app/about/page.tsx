"use client";

import Link from "next/link";
import { Shield, Users, Globe, Award, ChevronRight } from "lucide-react";
import { PalmXNavbar } from "@/components/PalmXNavbar";
import { OkxFooter } from "@/components/OkxFooter";
import { useLanguage } from "@/components/LanguageProvider";

const STATS = [
  { value: "70M+", label: "Registered Users" },
  { value: "180+", label: "Countries Served" },
  { value: "$10B+", label: "Daily Trading Volume" },
  { value: "2018",  label: "Founded" },
];

const VALUES = [
  { icon: Shield,  title: "Security First",   desc: "Industry-leading cold storage, proof-of-reserves, and 24/7 risk monitoring." },
  { icon: Users,   title: "User-Centric",      desc: "Every feature is designed around what traders and investors actually need." },
  { icon: Globe,   title: "Global Reach",      desc: "Operating in 180+ countries with full Arabic and English localization, including Iraq." },
  { icon: Award,   title: "Trust & Compliance",desc: "Regulated entity with transparent operations and regular third-party audits." },
];

export default function AboutPage() {
  const { isRTL } = useLanguage();
  const arabicFont = isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {};

  return (
    <div className="min-h-screen bg-black text-white flex flex-col" dir={isRTL ? "rtl" : "ltr"}>
      <PalmXNavbar />

      <main className="flex-1 pt-24 pb-24">
        {/* Hero */}
        <section className="max-w-[900px] mx-auto px-6 lg:px-12 text-center pt-12 pb-20">
          <div className="inline-flex items-center gap-2 text-[#e2b700] text-sm font-medium bg-[#e2b700]/10 border border-[#e2b700]/20 rounded-full px-4 py-1.5 mb-6">
            🌴 About PalmX
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-white leading-tight mb-6" style={arabicFont}>
            The Future of Crypto Trading<br />
            <span className="text-[#e2b700]">Starts in the Middle East</span>
          </h1>
          <p className="text-lg text-white/55 max-w-2xl mx-auto leading-relaxed" style={arabicFont}>
            PalmX is a next-generation cryptocurrency exchange built for speed, security, and accessibility — with a special focus on serving users in Iraq and the broader Arab world.
          </p>
        </section>

        {/* Stats */}
        <section className="border-y border-white/8 bg-[#0a0a0a] py-12 mb-20">
          <div className="max-w-[1100px] mx-auto px-6 lg:px-12 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
            {STATS.map(({ value, label }) => (
              <div key={label}>
                <div className="text-3xl md:text-4xl font-bold text-[#e2b700] mb-1">{value}</div>
                <div className="text-sm text-white/45" style={arabicFont}>{label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Mission */}
        <section className="max-w-[900px] mx-auto px-6 lg:px-12 mb-20">
          <h2 className="text-2xl font-bold text-white mb-4" style={arabicFont}>Our Mission</h2>
          <p className="text-white/55 text-base leading-relaxed mb-4" style={arabicFont}>
            PalmX was founded with a clear mission: to make world-class cryptocurrency trading accessible to everyone — from seasoned traders in global financial centres to first-time investors in Baghdad, Basra, and beyond.
          </p>
          <p className="text-white/55 text-base leading-relaxed" style={arabicFont}>
            We support the Iraqi Dinar (IQD) as a first-class currency, offer full Arabic language support with RTL layout, and ensure our platform fully complies with financial regulations in every market we operate in.
          </p>
        </section>

        {/* Values */}
        <section className="max-w-[1100px] mx-auto px-6 lg:px-12 mb-20">
          <h2 className="text-2xl font-bold text-white mb-8 text-center" style={arabicFont}>Our Core Values</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {VALUES.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="bg-[#0a0a0a] border border-white/8 rounded-2xl p-6 hover:border-white/15 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-[#e2b700]/10 flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5 text-[#e2b700]" />
                </div>
                <h3 className="text-sm font-semibold text-white mb-2" style={arabicFont}>{title}</h3>
                <p className="text-xs text-white/45 leading-relaxed" style={arabicFont}>{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="max-w-[600px] mx-auto px-6 text-center">
          <h2 className="text-2xl font-bold text-white mb-4" style={arabicFont}>Ready to start trading?</h2>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-8 py-3.5 bg-[#e2b700] hover:bg-[#f5ca00] text-black font-semibold rounded-xl transition-colors"
            style={arabicFont}
          >
            Create your account <ChevronRight className="w-4 h-4" />
          </Link>
        </section>
      </main>

      <OkxFooter />
    </div>
  );
}
