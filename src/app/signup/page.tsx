"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, ChevronDown, Shield, Check } from "lucide-react";
import { PalmXNavbar } from "@/components/PalmXNavbar";
import { useLanguage } from "@/components/LanguageProvider";

// ─── Country codes (Iraq default) ──────────────────────────────────────────
const COUNTRY_CODES = [
  { code: "+964", flag: "🇮🇶", name: "Iraq" },
  { code: "+966", flag: "🇸🇦", name: "Saudi Arabia" },
  { code: "+971", flag: "🇦🇪", name: "UAE" },
  { code: "+962", flag: "🇯🇴", name: "Jordan" },
  { code: "+965", flag: "🇰🇼", name: "Kuwait" },
  { code: "+968", flag: "🇴🇲", name: "Oman" },
  { code: "+974", flag: "🇶🇦", name: "Qatar" },
  { code: "+973", flag: "🇧🇭", name: "Bahrain" },
  { code: "+20",  flag: "🇪🇬", name: "Egypt" },
  { code: "+212", flag: "🇲🇦", name: "Morocco" },
  { code: "+216", flag: "🇹🇳", name: "Tunisia" },
  { code: "+1",   flag: "🇺🇸", name: "USA" },
  { code: "+44",  flag: "🇬🇧", name: "UK" },
  { code: "+49",  flag: "🇩🇪", name: "Germany" },
  { code: "+33",  flag: "🇫🇷", name: "France" },
  { code: "+7",   flag: "🇷🇺", name: "Russia" },
  { code: "+86",  flag: "🇨🇳", name: "China" },
  { code: "+81",  flag: "🇯🇵", name: "Japan" },
  { code: "+82",  flag: "🇰🇷", name: "South Korea" },
  { code: "+91",  flag: "🇮🇳", name: "India" },
];

// ─── Password strength ──────────────────────────────────────────────────────
type Strength = 0 | 1 | 2 | 3 | 4;

function calcStrength(pw: string): Strength {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[a-z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(4, score) as Strength;
}

const STRENGTH_META: { label: string; labelAr: string; color: string }[] = [
  { label: "Weak",   labelAr: "ضعيفة",   color: "#f6465d" },
  { label: "Weak",   labelAr: "ضعيفة",   color: "#f6465d" },
  { label: "Fair",   labelAr: "مقبولة",  color: "#e2b700" },
  { label: "Good",   labelAr: "جيدة",    color: "#3b82f6" },
  { label: "Strong", labelAr: "قوية",    color: "#0ecb81" },
];

const REQUIREMENTS = [
  { label: "At least 8 characters",           labelAr: "8 أحرف كحد أدنى",           test: (p: string) => p.length >= 8 },
  { label: "Uppercase letter (A-Z)",          labelAr: "حرف كبير (A-Z)",            test: (p: string) => /[A-Z]/.test(p) },
  { label: "Lowercase letter (a-z)",          labelAr: "حرف صغير (a-z)",            test: (p: string) => /[a-z]/.test(p) },
  { label: "Number (0-9)",                    labelAr: "رقم (0-9)",                  test: (p: string) => /[0-9]/.test(p) },
  { label: "Symbol (e.g. !@#$)",             labelAr: "رمز خاص (مثل !@#$)",         test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

export default function SignupPage() {
  const { t, isRTL } = useLanguage();
  const router = useRouter();
  const arabicFont = isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {};

  // Form state
  const [tab, setTab] = useState<"email" | "phone">("email");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [countryCode, setCountryCode] = useState(COUNTRY_CODES[0]);
  const [showCountryDropdown, setShowCountryDropdown] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [referral, setReferral] = useState("");
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const strength = calcStrength(password);
  const strengthMeta = STRENGTH_META[strength];

  const canSubmit = agreeTerms && agreePrivacy && strength >= 3 && (tab === "email" ? email.includes("@") : phone.length >= 7);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError("");
      if (!agreeTerms || !agreePrivacy) { setError(t.authErrorTerms); return; }
      if (strength < 3) { setError(t.authErrorPasswordWeak); return; }
      setLoading(true);
      // Simulate reCAPTCHA + API call delay
      await new Promise((r) => setTimeout(r, 900));
      setLoading(false);
      const destination = tab === "email" ? email : `${countryCode.code}${phone}`;
      router.push(`/signup/verify?to=${encodeURIComponent(destination)}&type=${tab}`);
    },
    [agreeTerms, agreePrivacy, strength, t, tab, email, phone, countryCode, router]
  );

  return (
    <div className="min-h-screen bg-black text-white flex flex-col" dir={isRTL ? "rtl" : "ltr"}>
      <PalmXNavbar />

      <main className="flex-1 flex items-center justify-center px-4 py-24">
        <div className="w-full max-w-[440px]">
          {/* Logo */}
          <div className="text-center mb-8">
            <Link href="/" className="inline-flex items-center gap-2 mb-4">
              <span className="text-2xl">🌴</span>
              <span className="text-2xl font-bold text-white">Palm<span style={{ color: "#e2b700" }}>X</span></span>
            </Link>
            <h1 className="text-2xl font-bold text-white" style={arabicFont}>{t.authSignup}</h1>
            <p className="text-sm text-white/40 mt-1" style={arabicFont}>
              {t.authAlreadyHave}{" "}
              <Link href="/login" className="text-[#e2b700] hover:underline">{t.authLogin}</Link>
            </p>
          </div>

          <div className="bg-[#0a0a0a] border border-white/8 rounded-2xl p-7">
            {/* Email / Phone tab */}
            <div className="flex rounded-xl bg-white/5 p-1 mb-6">
              {(["email", "phone"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setTab(v)}
                  className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${
                    tab === v ? "bg-[#e2b700] text-black shadow" : "text-white/50 hover:text-white"
                  }`}
                  style={arabicFont}
                >
                  {v === "email" ? t.authEmailTab : t.authPhoneTab}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              {/* Email or Phone */}
              {tab === "email" ? (
                <div>
                  <label className="block text-xs text-white/40 mb-1.5" style={arabicFont}>{t.authEmail}</label>
                  <input
                    type="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-[#e2b700]/60 transition-colors"
                    placeholder="you@example.com"
                    style={arabicFont}
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-xs text-white/40 mb-1.5" style={arabicFont}>{t.authPhone}</label>
                  <div className="flex gap-2">
                    {/* Country code selector */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowCountryDropdown((s) => !s)}
                        className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-xl px-3 py-3 text-sm text-white hover:border-white/20 transition-colors h-full whitespace-nowrap"
                      >
                        <span>{countryCode.flag}</span>
                        <span className="text-xs font-mono">{countryCode.code}</span>
                        <ChevronDown className="w-3 h-3 text-white/40" />
                      </button>
                      {showCountryDropdown && (
                        <div className="absolute top-full mt-1 left-0 w-64 max-h-56 overflow-y-auto bg-[#141414] border border-white/10 rounded-xl py-1 shadow-2xl z-50">
                          {COUNTRY_CODES.map((c) => (
                            <button
                              key={c.code + c.name}
                              type="button"
                              onClick={() => { setCountryCode(c); setShowCountryDropdown(false); }}
                              className="flex items-center gap-3 w-full px-3 py-2.5 text-sm hover:bg-white/5 transition-colors text-left"
                            >
                              <span>{c.flag}</span>
                              <span className="text-white/70 text-xs flex-1">{c.name}</span>
                              <span className="text-xs font-mono text-white/40">{c.code}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <input
                      type="tel"
                      required
                      autoComplete="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                      className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-[#e2b700]/60 transition-colors"
                      placeholder="7701234567"
                    />
                  </div>
                </div>
              )}

              {/* Password */}
              <div>
                <label className="block text-xs text-white/40 mb-1.5" style={arabicFont}>{t.authPassword}</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-[#e2b700]/60 transition-colors pr-12"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className={`absolute ${isRTL ? "left-3" : "right-3"} top-1/2 -translate-y-1/2 text-white/30 hover:text-white/70 transition-colors`}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {/* Strength bar */}
                {password.length > 0 && (
                  <div className="mt-2 space-y-2">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4].map((i) => (
                        <div
                          key={i}
                          className="h-1.5 flex-1 rounded-full transition-all duration-300"
                          style={{ backgroundColor: strength >= i ? strengthMeta.color : "#ffffff18" }}
                        />
                      ))}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium" style={{ color: strengthMeta.color, ...arabicFont }}>
                        {isRTL ? strengthMeta.labelAr : strengthMeta.label}
                      </span>
                    </div>
                    {/* Requirements */}
                    <div className="grid grid-cols-1 gap-1 pt-1">
                      {REQUIREMENTS.map((req) => {
                        const passed = req.test(password);
                        return (
                          <div key={req.label} className={`flex items-center gap-2 text-xs ${isRTL ? "flex-row-reverse" : ""}`}>
                            <div
                              className={`w-3.5 h-3.5 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                                passed ? "bg-[#0ecb81]/20" : "bg-white/5"
                              }`}
                            >
                              {passed && <Check className="w-2 h-2 text-[#0ecb81]" />}
                            </div>
                            <span className={passed ? "text-[#0ecb81]" : "text-white/35"} style={arabicFont}>
                              {isRTL ? req.labelAr : req.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Referral code */}
              <div>
                <label className="block text-xs text-white/40 mb-1.5" style={arabicFont}>{t.authReferralCode}</label>
                <input
                  type="text"
                  value={referral}
                  onChange={(e) => setReferral(e.target.value.toUpperCase())}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-[#e2b700]/60 transition-colors"
                  placeholder="e.g. PALMX25"
                  style={arabicFont}
                  maxLength={20}
                />
              </div>

              {/* Terms checkboxes */}
              <div className="space-y-3 pt-1">
                {[
                  { state: agreeTerms, set: setAgreeTerms, label: t.authAgreeTerms, link: t.authTermsLink, href: "/support" },
                  { state: agreePrivacy, set: setAgreePrivacy, label: t.authAgreeTerms, link: t.authPrivacyLink, href: "/support" },
                ].map(({ state, set, label, link, href }, i) => (
                  <label key={i} className={`flex items-start gap-3 cursor-pointer group ${isRTL ? "flex-row-reverse" : ""}`}>
                    <div
                      onClick={() => set(!state)}
                      className={`w-4 h-4 rounded flex-shrink-0 border transition-all mt-0.5 flex items-center justify-center cursor-pointer ${
                        state ? "bg-[#e2b700] border-[#e2b700]" : "border-white/20 group-hover:border-white/40"
                      }`}
                    >
                      {state && <Check className="w-2.5 h-2.5 text-black" />}
                    </div>
                    <span className="text-xs text-white/55 leading-relaxed" style={arabicFont}>
                      {label}{" "}
                      <Link href={href} className="text-[#e2b700] hover:underline">{link}</Link>
                    </span>
                  </label>
                ))}
              </div>

              {/* Error */}
              {error && (
                <div className="text-xs text-[#f6465d] bg-[#f6465d]/10 border border-[#f6465d]/20 rounded-xl px-4 py-2.5" style={arabicFont}>
                  {error}
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={!canSubmit || loading}
                className="w-full py-3.5 bg-[#e2b700] hover:bg-[#f5ca00] disabled:bg-white/10 disabled:text-white/30 text-black font-bold rounded-xl transition-colors mt-2"
                style={arabicFont}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    {isRTL ? "جارٍ التحقق..." : "Verifying..."}
                  </span>
                ) : t.authContinue}
              </button>
            </form>

            {/* reCAPTCHA notice */}
            <div className={`flex items-center gap-1.5 mt-4 justify-center ${isRTL ? "flex-row-reverse" : ""}`}>
              <Shield className="w-3 h-3 text-white/20" />
              <p className="text-[10px] text-white/20" style={arabicFont}>{t.authProtectedBy}</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
