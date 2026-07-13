"use client";

import { useState } from "react";
import Link from "next/link";
import { MapPin, Mail, Phone, MessageSquare, Send, CheckCircle2 } from "lucide-react";
import { PalmXNavbar } from "@/components/PalmXNavbar";
import { OkxFooter } from "@/components/OkxFooter";
import { useLanguage } from "@/components/LanguageProvider";

const OFFICES = [
  { city: "Baghdad", country: "Iraq",         flag: "🇮🇶", address: "Al-Karrada District, Baghdad, Iraq" },
  { city: "Dubai",   country: "UAE",           flag: "🇦🇪", address: "DIFC, Gate District, Dubai, UAE" },
  { city: "London",  country: "United Kingdom",flag: "🇬🇧", address: "Canary Wharf, London, UK" },
];

export default function ContactPage() {
  const { isRTL } = useLanguage();
  const arabicFont = isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {};
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSent(true);
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col" dir={isRTL ? "rtl" : "ltr"}>
      <PalmXNavbar />

      <main className="flex-1 pt-24 pb-24">
        <div className="max-w-[1100px] mx-auto px-6 lg:px-12">
          {/* Header */}
          <div className="text-center pt-12 pb-16">
            <h1 className="text-4xl font-bold text-white mb-4" style={arabicFont}>Contact Us</h1>
            <p className="text-white/50 max-w-lg mx-auto" style={arabicFont}>
              Our support team is available 24/7 to help with any questions about your account, trading, or our platform.
            </p>
          </div>

          <div className="grid lg:grid-cols-2 gap-10">
            {/* Contact Form */}
            <div className="bg-[#0a0a0a] border border-white/8 rounded-2xl p-8">
              <h2 className="text-lg font-bold text-white mb-6" style={arabicFont}>Send a Message</h2>

              {sent ? (
                <div className="flex flex-col items-center justify-center py-12 text-center gap-4">
                  <CheckCircle2 className="w-14 h-14 text-[#0ecb81]" />
                  <h3 className="text-lg font-semibold text-white" style={arabicFont}>Message Sent!</h3>
                  <p className="text-sm text-white/45" style={arabicFont}>
                    We&apos;ll get back to you within 24 hours.
                  </p>
                  <button
                    onClick={() => { setSent(false); setForm({ name: "", email: "", subject: "", message: "" }); }}
                    className="mt-2 text-sm text-[#e2b700] hover:underline"
                    style={arabicFont}
                  >
                    Send another message
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-white/40 mb-1.5" style={arabicFont}>Full Name</label>
                      <input
                        required
                        type="text"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-[#e2b700]/50"
                        placeholder="Your name"
                        style={arabicFont}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-white/40 mb-1.5" style={arabicFont}>Email</label>
                      <input
                        required
                        type="email"
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-[#e2b700]/50"
                        placeholder="you@example.com"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-white/40 mb-1.5" style={arabicFont}>Subject</label>
                    <input
                      required
                      type="text"
                      value={form.subject}
                      onChange={(e) => setForm({ ...form, subject: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-[#e2b700]/50"
                      placeholder="How can we help?"
                      style={arabicFont}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-white/40 mb-1.5" style={arabicFont}>Message</label>
                    <textarea
                      required
                      rows={5}
                      value={form.message}
                      onChange={(e) => setForm({ ...form, message: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-[#e2b700]/50 resize-none"
                      placeholder="Describe your issue or question..."
                      style={arabicFont}
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full flex items-center justify-center gap-2 py-3 bg-[#e2b700] hover:bg-[#f5ca00] text-black font-semibold rounded-xl transition-colors"
                    style={arabicFont}
                  >
                    <Send className="w-4 h-4" /> Send Message
                  </button>
                </form>
              )}
            </div>

            {/* Contact info */}
            <div className="space-y-6">
              {/* Quick links */}
              <div className="bg-[#0a0a0a] border border-white/8 rounded-2xl p-6 space-y-4">
                {[
                  { icon: MessageSquare, label: "Live Chat",     sublabel: "Average response < 2 min", href: "/support" },
                  { icon: Mail,          label: "Email Support", sublabel: "support@palmx.com",         href: "mailto:support@palmx.com" },
                  { icon: Phone,         label: "Iraq Hotline",  sublabel: "+964 (0) 800 PALMX",         href: "tel:+9641234567" },
                ].map(({ icon: Icon, label, sublabel, href }) => (
                  <Link
                    key={label}
                    href={href}
                    className="flex items-center gap-4 p-4 bg-white/3 hover:bg-white/6 rounded-xl transition-colors group"
                  >
                    <div className="w-10 h-10 rounded-xl bg-[#e2b700]/10 flex items-center justify-center flex-shrink-0 group-hover:bg-[#e2b700]/20 transition-colors">
                      <Icon className="w-4 h-4 text-[#e2b700]" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-white" style={arabicFont}>{label}</div>
                      <div className="text-xs text-white/40">{sublabel}</div>
                    </div>
                  </Link>
                ))}
              </div>

              {/* Offices */}
              <div className="bg-[#0a0a0a] border border-white/8 rounded-2xl p-6">
                <h3 className="text-sm font-semibold text-white/40 uppercase tracking-wider mb-4" style={arabicFont}>
                  Our Offices
                </h3>
                <div className="space-y-4">
                  {OFFICES.map(({ city, country, flag, address }) => (
                    <div key={city} className="flex items-start gap-3">
                      <span className="text-xl mt-0.5 flex-shrink-0">{flag}</span>
                      <div>
                        <div className="text-sm font-semibold text-white" style={arabicFont}>{city}, {country}</div>
                        <div className="flex items-center gap-1 text-xs text-white/35 mt-0.5">
                          <MapPin className="w-3 h-3 flex-shrink-0" />
                          {address}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <OkxFooter />
    </div>
  );
}
