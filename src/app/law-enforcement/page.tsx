"use client";

import { useState } from "react";
import { Shield, FileText, Clock, Lock, AlertTriangle, CheckCircle2, Send } from "lucide-react";
import { PalmXNavbar } from "@/components/PalmXNavbar";
import { OkxFooter } from "@/components/OkxFooter";
import { useLanguage } from "@/components/LanguageProvider";

const PROCESS_STEPS = [
  {
    icon: FileText,
    title: "Prepare Official Request",
    desc: "Submit a formal written request on official law-enforcement letterhead. Include jurisdiction, case number, legal authority, and scope of the data requested.",
  },
  {
    icon: Shield,
    title: "Verify Identity",
    desc: "PalmX verifies the identity of the requesting officer and the legal validity of the request through official channels before processing.",
  },
  {
    icon: Clock,
    title: "Review & Response",
    desc: "Valid requests are reviewed within 5 business days. Emergency preservation requests can be expedited within 24 hours if life is at risk.",
  },
  {
    icon: Lock,
    title: "Secure Data Sharing",
    desc: "Responding data is transmitted via encrypted, authenticated channels only. No information is shared via informal or unverified contacts.",
  },
];

const GUIDELINES = [
  "PalmX complies with applicable law and international standards, including FATF guidelines.",
  "We will challenge overbroad, legally deficient, or unauthorized requests.",
  "User privacy is protected — we disclose only the minimum data required by law.",
  "Emergency requests relating to immediate risk to life are prioritized.",
  "We cannot accept requests via email alone — all requests require official legal documentation.",
  "PalmX may notify users of requests unless prohibited by law (e.g. gag orders).",
];

export default function LawEnforcementPage() {
  const { isRTL } = useLanguage();
  const arabicFont = isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {};
  const [sent, setSent] = useState(false);
  const [form, setForm] = useState({ agency: "", officer: "", email: "", caseNo: "", message: "" });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSent(true);
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col" dir={isRTL ? "rtl" : "ltr"}>
      <PalmXNavbar />

      <main className="flex-1">
        {/* Header */}
        <section className="pt-32 pb-16 px-6 lg:px-12 bg-gradient-to-b from-[#0a0a0a] to-black">
          <div className="max-w-[900px] mx-auto">
            <div
              className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider px-3 py-1.5 rounded-full border border-white/20 text-white/60 mb-6"
              style={arabicFont}
            >
              <Shield className="w-3.5 h-3.5" /> Law Enforcement
            </div>
            <h1 className="text-4xl font-bold text-white mb-4" style={arabicFont}>
              Law Enforcement Request Guidelines
            </h1>
            <p className="text-white/50 leading-relaxed max-w-2xl" style={arabicFont}>
              PalmX cooperates with lawfully authorized requests from government and law-enforcement
              agencies while upholding user rights and platform integrity. This page outlines the
              correct process for submitting an official request.
            </p>
          </div>
        </section>

        {/* Important notice */}
        <section className="py-8 px-6 lg:px-12">
          <div className="max-w-[900px] mx-auto">
            <div className="flex gap-3 bg-[#e2b700]/8 border border-[#e2b700]/25 rounded-xl px-5 py-4">
              <AlertTriangle className="w-5 h-5 text-[#e2b700] flex-shrink-0 mt-0.5" />
              <p className="text-sm text-white/70 leading-relaxed" style={arabicFont}>
                <span className="font-semibold text-[#e2b700]">Important: </span>
                Requests submitted without proper legal documentation or through unofficial channels
                will not be processed. Do not contact general customer support for law enforcement matters.
              </p>
            </div>
          </div>
        </section>

        {/* Process */}
        <section className="py-16 px-6 lg:px-12 bg-[#0a0a0a]">
          <div className="max-w-[900px] mx-auto">
            <h2 className="text-xl font-bold text-white mb-10" style={arabicFont}>Request Process</h2>
            <div className="grid sm:grid-cols-2 gap-5">
              {PROCESS_STEPS.map(({ icon: Icon, title, desc }, i) => (
                <div key={title} className="bg-[#141414] border border-white/8 rounded-xl p-6 relative overflow-hidden">
                  <div className="absolute top-3 right-4 text-4xl font-black text-white/3 select-none">0{i + 1}</div>
                  <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center mb-4">
                    <Icon className="w-5 h-5 text-white/50" />
                  </div>
                  <h3 className="text-sm font-bold text-white mb-1.5" style={arabicFont}>{title}</h3>
                  <p className="text-xs text-white/45 leading-relaxed" style={arabicFont}>{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Guidelines */}
        <section className="py-16 px-6 lg:px-12">
          <div className="max-w-[900px] mx-auto">
            <h2 className="text-xl font-bold text-white mb-8" style={arabicFont}>Our Principles</h2>
            <div className="space-y-3">
              {GUIDELINES.map((g, i) => (
                <div key={i} className="flex items-start gap-3">
                  <CheckCircle2 className="w-4 h-4 text-[#0ecb81] flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-white/60 leading-relaxed" style={arabicFont}>{g}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Contact form */}
        <section className="py-16 px-6 lg:px-12 bg-[#0a0a0a]">
          <div className="max-w-[700px] mx-auto">
            <h2 className="text-xl font-bold text-white mb-2" style={arabicFont}>Submit a Request</h2>
            <p className="text-sm text-white/40 mb-8" style={arabicFont}>
              Use this form only if you are a verified law-enforcement official with a lawful basis for disclosure.
            </p>

            {sent ? (
              <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
                <CheckCircle2 className="w-14 h-14 text-[#0ecb81]" />
                <h3 className="text-lg font-semibold text-white" style={arabicFont}>Request Received</h3>
                <p className="text-sm text-white/40 max-w-xs" style={arabicFont}>
                  Our legal compliance team will review and respond within 5 business days.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-white/40 mb-1.5" style={arabicFont}>Agency / Organization</label>
                    <input
                      required type="text" value={form.agency}
                      onChange={(e) => setForm({ ...form, agency: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/30"
                      placeholder="e.g. Iraqi Federal Police" style={arabicFont}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-white/40 mb-1.5" style={arabicFont}>Officer Name</label>
                    <input
                      required type="text" value={form.officer}
                      onChange={(e) => setForm({ ...form, officer: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/30"
                      placeholder="Full legal name" style={arabicFont}
                    />
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-white/40 mb-1.5" style={arabicFont}>Official Email</label>
                    <input
                      required type="email" value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/30"
                      placeholder="officer@agency.gov" style={arabicFont}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-white/40 mb-1.5" style={arabicFont}>Case / Reference Number</label>
                    <input
                      required type="text" value={form.caseNo}
                      onChange={(e) => setForm({ ...form, caseNo: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/30"
                      placeholder="e.g. IFP-2026-0042" style={arabicFont}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-white/40 mb-1.5" style={arabicFont}>Request Details & Legal Basis</label>
                  <textarea
                    required rows={5} value={form.message}
                    onChange={(e) => setForm({ ...form, message: e.target.value })}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/30 resize-none"
                    placeholder="Describe the request, legal authority, and scope of data needed..." style={arabicFont}
                  />
                </div>
                <button
                  type="submit"
                  className="w-full flex items-center justify-center gap-2 py-3 bg-white/10 hover:bg-white/15 text-white font-semibold rounded-xl transition-colors"
                  style={arabicFont}
                >
                  <Send className="w-4 h-4" /> Submit Official Request
                </button>
              </form>
            )}
          </div>
        </section>
      </main>

      <OkxFooter />
    </div>
  );
}
