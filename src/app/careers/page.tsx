"use client";

import Link from "next/link";
import { Briefcase, Globe, Zap, Heart, MapPin, Clock } from "lucide-react";
import { PalmXNavbar } from "@/components/PalmXNavbar";
import { OkxFooter } from "@/components/OkxFooter";
import { useLanguage } from "@/components/LanguageProvider";

const OPEN_ROLES = [
  { title: "Senior Frontend Engineer",      dept: "Engineering",  location: "Baghdad / Remote", type: "Full-time" },
  { title: "Blockchain Security Researcher", dept: "Security",     location: "Remote",           type: "Full-time" },
  { title: "Product Manager — P2P",         dept: "Product",      location: "Dubai / Remote",   type: "Full-time" },
  { title: "Arabic Content Strategist",     dept: "Marketing",    location: "Baghdad",          type: "Full-time" },
  { title: "Backend Engineer (Node.js)",    dept: "Engineering",  location: "Remote",           type: "Full-time" },
  { title: "Compliance Analyst — MENA",     dept: "Legal",        location: "Dubai",            type: "Full-time" },
  { title: "UX Designer",                   dept: "Design",       location: "Remote",           type: "Contract" },
  { title: "Customer Support Lead",         dept: "Operations",   location: "Baghdad",          type: "Full-time" },
];

const PERKS = [
  { icon: Globe,     title: "Remote-first",      desc: "Work from anywhere on Earth. We have team members across 20+ countries." },
  { icon: Zap,       title: "Move fast",          desc: "Flat structure, no bureaucracy. Ship meaningful work and see impact immediately." },
  { icon: Heart,     title: "Wellbeing stipend",  desc: "$200/month for health, fitness, or mental wellness — your choice." },
  { icon: Briefcase, title: "Competitive pay",    desc: "Top-of-market salaries in local currency (IQD, AED, USD, EUR) + equity." },
];

const DEPT_COLORS: Record<string, string> = {
  Engineering: "#e2b700", Security: "#f6465d", Product: "#0ecb81",
  Marketing: "#3b82f6", Legal: "#a855f7", Design: "#ec4899", Operations: "#22d3ee",
};

export default function CareersPage() {
  const { isRTL } = useLanguage();
  const arabicFont = isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {};

  return (
    <div className="min-h-screen bg-black text-white flex flex-col" dir={isRTL ? "rtl" : "ltr"}>
      <PalmXNavbar />

      <main className="flex-1">
        {/* Hero */}
        <section className="pt-32 pb-20 px-6 lg:px-12 max-w-[1100px] mx-auto text-center">
          <div
            className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full border border-[#e2b700]/30 text-[#e2b700] mb-6"
            style={arabicFont}
          >
            <Briefcase className="w-3.5 h-3.5" /> Careers
          </div>
          <h1 className="text-4xl lg:text-5xl font-bold text-white leading-tight mb-5" style={arabicFont}>
            Build the Future of Finance<br />
            <span style={{ color: "#e2b700" }}>in the Middle East</span>
          </h1>
          <p className="text-white/50 max-w-xl mx-auto mb-10 leading-relaxed" style={arabicFont}>
            PalmX is on a mission to make crypto accessible to every Iraqi and every Arab. Join a
            passionate team of builders working at the frontier of decentralized finance.
          </p>
          <a
            href="#roles"
            className="inline-flex px-8 py-3.5 bg-[#e2b700] hover:bg-[#f5ca00] text-black font-bold rounded-xl transition-colors"
            style={arabicFont}
          >
            See Open Positions ({OPEN_ROLES.length})
          </a>
        </section>

        {/* Perks */}
        <section className="py-16 px-6 lg:px-12 bg-[#0a0a0a]">
          <div className="max-w-[1100px] mx-auto grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {PERKS.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="bg-[#141414] border border-white/8 rounded-xl p-6">
                <div className="w-10 h-10 rounded-xl bg-[#e2b700]/10 flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5 text-[#e2b700]" />
                </div>
                <h3 className="text-sm font-bold text-white mb-1.5" style={arabicFont}>{title}</h3>
                <p className="text-xs text-white/45 leading-relaxed" style={arabicFont}>{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Open roles */}
        <section id="roles" className="py-20 px-6 lg:px-12">
          <div className="max-w-[1100px] mx-auto">
            <h2 className="text-2xl font-bold text-white mb-8" style={arabicFont}>Open Positions</h2>
            <div className="space-y-3">
              {OPEN_ROLES.map(({ title, dept, location, type }) => (
                <div
                  key={title}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-[#0a0a0a] border border-white/8 hover:border-white/15 transition-colors rounded-xl px-6 py-5"
                >
                  <div>
                    <h3 className="text-sm font-bold text-white" style={arabicFont}>{title}</h3>
                    <div className={`flex items-center gap-3 mt-1.5 flex-wrap ${isRTL ? "flex-row-reverse" : ""}`}>
                      <span
                        className="text-xs font-semibold px-2 py-0.5 rounded-full"
                        style={{ color: DEPT_COLORS[dept] ?? "#e2b700", backgroundColor: `${DEPT_COLORS[dept] ?? "#e2b700"}18` }}
                      >
                        {dept}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-white/35">
                        <MapPin className="w-3 h-3" />{location}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-white/35">
                        <Clock className="w-3 h-3" />{type}
                      </span>
                    </div>
                  </div>
                  <Link
                    href="/dashboard"
                    className="flex-shrink-0 px-5 py-2 text-sm font-semibold border border-[#e2b700]/40 hover:bg-[#e2b700]/10 text-[#e2b700] rounded-xl transition-colors self-start sm:self-auto"
                    style={arabicFont}
                  >
                    Apply
                  </Link>
                </div>
              ))}
            </div>

            <p className="text-sm text-white/35 text-center mt-10" style={arabicFont}>
              Don&apos;t see a match?{" "}
              <Link href="/contact" className="text-[#e2b700] hover:underline">
                Send us a general application
              </Link>
            </p>
          </div>
        </section>
      </main>

      <OkxFooter />
    </div>
  );
}
