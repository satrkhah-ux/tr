"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, Upload, ShieldCheck, Clock, XCircle, RefreshCw } from "lucide-react";
import { PalmXNavbar } from "@/components/PalmXNavbar";
import { OkxFooter } from "@/components/OkxFooter";
import { useLanguage } from "@/components/LanguageProvider";

// ─── Simulated current KYC state (in real app this comes from API) ────────────
// Possible: "unverified" | "pending" | "verified" | "rejected" | "resubmit"
type MockState = "unverified" | "pending" | "verified" | "rejected" | "resubmit";

const TIER1_INITIAL = { firstName: "", lastName: "", dob: "", nationality: "", address: "", city: "" };
const TIER2_INITIAL = { docType: "passport", docNumber: "", frontFile: "", backFile: "", selfieFile: "" };

const COUNTRIES = [
  "Iraq", "Saudi Arabia", "UAE", "Kuwait", "Qatar", "Bahrain", "Oman",
  "Jordan", "Egypt", "Morocco", "Lebanon", "Syria", "Turkey", "Iran",
  "United States", "United Kingdom", "Germany", "France", "India", "Pakistan",
];

export default function KycPage() {
  const { t, isRTL } = useLanguage();
  const router = useRouter();
  const rtlFont = isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {};

  const [step, setStep]         = useState<1 | 2 | 3>(1);
  const [tier1, setTier1]       = useState({ ...TIER1_INITIAL });
  const [tier2, setTier2]       = useState({ ...TIER2_INITIAL });
  const [submitting, setSubmitting] = useState(false);

  // Simulated final KYC state after submit (for demo purposes, start unverified)
  const [finalState, setFinalState] = useState<MockState | null>(null);

  const rtl = isRTL ? "rtl" : "ltr";

  const docTypes = [
    { value: "passport",   label: t.kycPassport },
    { value: "national_id",label: t.kycNationalId },
    { value: "license",    label: t.kycLicense },
  ];

  function handleFileSelect(key: "frontFile" | "backFile" | "selfieFile") {
    // Simulated file selection — in production, file would be uploaded to encrypted storage
    const names = ["document_front.jpg", "document_back.jpg", "selfie_with_doc.jpg"];
    const idx = key === "frontFile" ? 0 : key === "backFile" ? 1 : 2;
    setTier2((f) => ({ ...f, [key]: names[idx] }));
  }

  async function handleSubmit() {
    setSubmitting(true);
    await new Promise((r) => setTimeout(r, 2000));
    setSubmitting(false);
    setFinalState("pending");
  }

  // ─── Post-submit state screens ────────────────────────────────────────────
  if (finalState === "pending") {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col" dir={rtl}>
        <PalmXNavbar />
        <main className="flex-1 flex items-center justify-center py-24 px-4">
          <div className="text-center max-w-md" style={rtlFont}>
            <div className="w-20 h-20 bg-[#e2b700]/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <Clock className="w-10 h-10 text-[#e2b700]" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-3">{t.kycPendingTitle}</h1>
            <p className="text-white/60 text-sm leading-relaxed mb-8">{t.kycPendingDesc}</p>
            <div className="bg-[#0a0a0a] border border-white/8 rounded-2xl p-4 mb-6 text-left">
              <p className="text-xs font-semibold text-white/40 uppercase tracking-wide mb-2">Submission Summary</p>
              <div className="space-y-1.5">
                {[
                  ["Name",    `${tier1.firstName} ${tier1.lastName}`],
                  ["DOB",     tier1.dob],
                  ["Country", tier1.nationality],
                  ["Document",docTypes.find((d) => d.value === tier2.docType)?.label ?? "—"],
                  ["Doc #",   tier2.docNumber],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between text-sm">
                    <span className="text-white/40">{k}</span>
                    <span className="text-white">{String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
            <button
              onClick={() => router.push("/dashboard")}
              className="px-6 py-3 bg-[#e2b700] hover:bg-[#f5ca00] text-black font-semibold rounded-xl text-sm transition-colors"
              style={rtlFont}
            >
              Back to Dashboard
            </button>
          </div>
        </main>
        <OkxFooter />
      </div>
    );
  }

  if (finalState === "verified") {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col" dir={rtl}>
        <PalmXNavbar />
        <main className="flex-1 flex items-center justify-center py-24 px-4">
          <div className="text-center max-w-md" style={rtlFont}>
            <div className="w-20 h-20 bg-[#0ecb81]/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-10 h-10 text-[#0ecb81]" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-3">{t.kycVerifiedTitle}</h1>
            <p className="text-white/60 text-sm leading-relaxed mb-8">{t.kycVerifiedDesc}</p>
            <button
              onClick={() => router.push("/dashboard")}
              className="px-6 py-3 bg-[#e2b700] text-black font-semibold rounded-xl text-sm"
              style={rtlFont}
            >
              Go to Dashboard
            </button>
          </div>
        </main>
        <OkxFooter />
      </div>
    );
  }

  if (finalState === "rejected") {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col" dir={rtl}>
        <PalmXNavbar />
        <main className="flex-1 flex items-center justify-center py-24 px-4">
          <div className="text-center max-w-md" style={rtlFont}>
            <div className="w-20 h-20 bg-[#f6465d]/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <XCircle className="w-10 h-10 text-[#f6465d]" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-3">{t.kycRejectedTitle}</h1>
            <p className="text-white/60 text-sm leading-relaxed mb-8">{t.kycRejectedDesc}</p>
            <button
              onClick={() => { setFinalState(null); setStep(1); }}
              className="px-6 py-3 bg-[#e2b700] text-black font-semibold rounded-xl text-sm"
              style={rtlFont}
            >
              Resubmit Application
            </button>
          </div>
        </main>
        <OkxFooter />
      </div>
    );
  }

  if (finalState === "resubmit") {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col" dir={rtl}>
        <PalmXNavbar />
        <main className="flex-1 flex items-center justify-center py-24 px-4">
          <div className="text-center max-w-md" style={rtlFont}>
            <div className="w-20 h-20 bg-[#ff8c00]/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <RefreshCw className="w-10 h-10 text-[#ff8c00]" />
            </div>
            <h1 className="text-2xl font-bold text-white mb-3">{t.kycResubmitTitle}</h1>
            <p className="text-white/60 text-sm leading-relaxed mb-8">{t.kycResubmitDesc}</p>
            <button
              onClick={() => { setFinalState(null); setStep(2); }}
              className="px-6 py-3 bg-[#e2b700] text-black font-semibold rounded-xl text-sm"
              style={rtlFont}
            >
              Update Documents
            </button>
          </div>
        </main>
        <OkxFooter />
      </div>
    );
  }

  // ─── Active flow ──────────────────────────────────────────────────────────
  const tier1Valid =
    tier1.firstName.trim() &&
    tier1.lastName.trim() &&
    tier1.dob &&
    tier1.nationality &&
    tier1.address.trim() &&
    tier1.city.trim();

  const tier2Valid =
    tier2.docNumber.trim() &&
    tier2.frontFile &&
    tier2.selfieFile;

  return (
    <div className="min-h-screen bg-black text-white flex flex-col" dir={rtl}>
      <PalmXNavbar />

      <main className="flex-1 pt-24 pb-20">
        <div className="max-w-[640px] mx-auto px-4">
          {/* Header */}
          <div className="text-center mb-8" style={rtlFont}>
            <div className="inline-flex items-center justify-center w-14 h-14 bg-[#e2b700]/10 rounded-2xl mb-4">
              <ShieldCheck className="w-7 h-7 text-[#e2b700]" />
            </div>
            <h1 className="text-2xl font-bold text-white">{t.kycTitle}</h1>
            <p className="text-white/50 text-sm mt-2">{t.kycSubtitle}</p>
          </div>

          {/* Step indicator */}
          <div className="flex items-center justify-center gap-3 mb-8">
            {[1, 2].map((s) => (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                    s < step
                      ? "bg-[#0ecb81] text-black"
                      : s === step
                      ? "bg-[#e2b700] text-black"
                      : "bg-white/10 text-white/40"
                  }`}
                >
                  {s < step ? <CheckCircle className="w-4 h-4" /> : s}
                </div>
                <span
                  className={`text-xs font-medium ${s === step ? "text-white" : "text-white/35"}`}
                  style={rtlFont}
                >
                  {s === 1 ? t.kycTier1 : t.kycTier2}
                </span>
                {s < 2 && <div className="w-12 h-px bg-white/15 mx-2" />}
              </div>
            ))}
          </div>

          {/* Step 1: Basic Information */}
          {step === 1 && (
            <div className="bg-[#0a0a0a] border border-white/8 rounded-2xl p-6">
              <h2 className="text-base font-semibold text-white mb-1" style={rtlFont}>{t.kycTier1}</h2>
              <p className="text-xs text-white/40 mb-5" style={rtlFont}>{t.kycTier1Desc}</p>

              <div className="grid grid-cols-2 gap-4">
                {[
                  { key: "firstName", label: t.kycFirstName, placeholder: "Ahmed", half: true },
                  { key: "lastName",  label: t.kycLastName,  placeholder: "Al-Rashid", half: true },
                ].map(({ key, label, placeholder }) => (
                  <div key={key}>
                    <label className="text-xs font-semibold text-white/50 block mb-1.5 uppercase tracking-wide" style={rtlFont}>
                      {label} <span className="text-[#f6465d]">*</span>
                    </label>
                    <input
                      type="text"
                      value={(tier1 as Record<string, string>)[key]}
                      onChange={(e) => setTier1((f) => ({ ...f, [key]: e.target.value }))}
                      placeholder={placeholder}
                      className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#e2b700]/50"
                      style={rtlFont}
                    />
                  </div>
                ))}

                <div>
                  <label className="text-xs font-semibold text-white/50 block mb-1.5 uppercase tracking-wide" style={rtlFont}>
                    {t.kycDob} <span className="text-[#f6465d]">*</span>
                  </label>
                  <input
                    type="date"
                    value={tier1.dob}
                    max="2008-01-01"
                    onChange={(e) => setTier1((f) => ({ ...f, dob: e.target.value }))}
                    className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#e2b700]/50"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-white/50 block mb-1.5 uppercase tracking-wide" style={rtlFont}>
                    {t.kycNationality} <span className="text-[#f6465d]">*</span>
                  </label>
                  <select
                    value={tier1.nationality}
                    onChange={(e) => setTier1((f) => ({ ...f, nationality: e.target.value }))}
                    className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-[#e2b700]/50 cursor-pointer"
                    style={rtlFont}
                  >
                    <option value="">Select country</option>
                    {COUNTRIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                <div className="col-span-2">
                  <label className="text-xs font-semibold text-white/50 block mb-1.5 uppercase tracking-wide" style={rtlFont}>
                    {t.kycAddress} <span className="text-[#f6465d]">*</span>
                  </label>
                  <input
                    type="text"
                    value={tier1.address}
                    onChange={(e) => setTier1((f) => ({ ...f, address: e.target.value }))}
                    placeholder="Street address, district"
                    className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#e2b700]/50"
                    style={rtlFont}
                  />
                </div>

                <div className="col-span-2">
                  <label className="text-xs font-semibold text-white/50 block mb-1.5 uppercase tracking-wide" style={rtlFont}>
                    {t.kycCity} <span className="text-[#f6465d]">*</span>
                  </label>
                  <input
                    type="text"
                    value={tier1.city}
                    onChange={(e) => setTier1((f) => ({ ...f, city: e.target.value }))}
                    placeholder="Baghdad"
                    className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-[#e2b700]/50"
                    style={rtlFont}
                  />
                </div>
              </div>

              <button
                onClick={() => setStep(2)}
                disabled={!tier1Valid}
                className="w-full mt-6 py-3 bg-[#e2b700] hover:bg-[#f5ca00] disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold rounded-xl text-sm transition-colors"
                style={rtlFont}
              >
                {t.kycNext} →
              </button>
            </div>
          )}

          {/* Step 2: Document Upload */}
          {step === 2 && (
            <div className="bg-[#0a0a0a] border border-white/8 rounded-2xl p-6">
              <h2 className="text-base font-semibold text-white mb-1" style={rtlFont}>{t.kycTier2}</h2>
              <p className="text-xs text-white/40 mb-5" style={rtlFont}>{t.kycTier2Desc}</p>

              {/* Document type */}
              <div className="mb-4">
                <label className="text-xs font-semibold text-white/50 block mb-1.5 uppercase tracking-wide" style={rtlFont}>
                  {t.kycDocType} <span className="text-[#f6465d]">*</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {docTypes.map((d) => (
                    <button
                      key={d.value}
                      onClick={() => setTier2((f) => ({ ...f, docType: d.value }))}
                      className={`py-2.5 px-3 rounded-xl text-xs font-medium border transition-colors ${
                        tier2.docType === d.value
                          ? "bg-[#e2b700]/10 border-[#e2b700]/50 text-[#e2b700]"
                          : "bg-black border-white/10 text-white/50 hover:text-white hover:border-white/20"
                      }`}
                      style={rtlFont}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Document number */}
              <div className="mb-4">
                <label className="text-xs font-semibold text-white/50 block mb-1.5 uppercase tracking-wide" style={rtlFont}>
                  {t.kycDocNumber} <span className="text-[#f6465d]">*</span>
                </label>
                <input
                  type="text"
                  value={tier2.docNumber}
                  onChange={(e) => setTier2((f) => ({ ...f, docNumber: e.target.value.toUpperCase() }))}
                  placeholder="A1234567"
                  className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-sm text-white font-mono placeholder:text-white/25 focus:outline-none focus:border-[#e2b700]/50"
                />
              </div>

              {/* Upload areas */}
              <div className="space-y-3 mb-4">
                {[
                  { key: "frontFile",  label: t.kycUploadFront,  required: true },
                  { key: "backFile",   label: t.kycUploadBack,   required: tier2.docType !== "passport" },
                  { key: "selfieFile", label: t.kycUploadSelfie, required: true },
                ].map(({ key, label, required }) => {
                  const uploaded = (tier2 as Record<string, string>)[key];
                  return (
                    <div key={key}>
                      <label className="text-xs font-semibold text-white/50 block mb-1.5 uppercase tracking-wide" style={rtlFont}>
                        {label} {required && <span className="text-[#f6465d]">*</span>}
                      </label>
                      <button
                        type="button"
                        onClick={() => handleFileSelect(key as "frontFile" | "backFile" | "selfieFile")}
                        className={`w-full border-2 border-dashed rounded-xl py-4 flex items-center justify-center gap-3 transition-colors ${
                          uploaded
                            ? "border-[#0ecb81]/40 bg-[#0ecb81]/5 text-[#0ecb81]"
                            : "border-white/15 hover:border-[#e2b700]/40 hover:bg-[#e2b700]/5 text-white/40 hover:text-white/70"
                        }`}
                        style={rtlFont}
                      >
                        {uploaded ? (
                          <>
                            <CheckCircle className="w-4 h-4" />
                            <span className="text-sm">{uploaded}</span>
                          </>
                        ) : (
                          <>
                            <Upload className="w-4 h-4" />
                            <span className="text-sm">{label}</span>
                          </>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>

              <p className="text-xs text-white/30 mb-5" style={rtlFont}>{t.kycUploadNote}</p>

              {/* Encryption notice */}
              <div className="bg-[#e2b700]/5 border border-[#e2b700]/15 rounded-xl px-4 py-3 mb-5 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-[#e2b700] flex-shrink-0 mt-0.5" />
                <p className="text-xs text-white/60" style={rtlFont}>
                  Your documents are encrypted with AES-256 and stored in a secure cloud vault. Only our compliance team can decrypt them.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep(1)}
                  className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white/70 font-medium rounded-xl text-sm transition-colors"
                  style={rtlFont}
                >
                  ← {t.kycBack}
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={!tier2Valid || submitting}
                  className="flex-1 py-3 bg-[#e2b700] hover:bg-[#f5ca00] disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
                  style={rtlFont}
                >
                  {submitting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                      Uploading…
                    </>
                  ) : (
                    t.kycSubmit
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      <OkxFooter />
    </div>
  );
}
