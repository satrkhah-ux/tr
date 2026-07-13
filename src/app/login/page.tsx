"use client";

import { useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Shield, ArrowLeft } from "lucide-react";
import { PalmXNavbar } from "@/components/PalmXNavbar";
import { useLanguage } from "@/components/LanguageProvider";

const OTP_LENGTH = 6;

type Step = "credentials" | "2fa";

// Simple brute-force guard (client-side, demo)
const MAX_ATTEMPTS = 5;

export default function LoginPage() {
  const { t, isRTL } = useLanguage();
  const router = useRouter();
  const arabicFont = isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {};

  // Step
  const [step, setStep] = useState<Step>("credentials");

  // Credentials
  const [emailOrPhone, setEmailOrPhone] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  // 2FA
  const [twoFaOtp, setTwoFaOtp] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const twoFaRefs = useRef<(HTMLInputElement | null)[]>([]);

  // State
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [attempts, setAttempts] = useState(0);

  const isLocked = attempts >= MAX_ATTEMPTS;

  // ── Credentials submit ──────────────────────────────────────────────────
  const handleLogin = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError("");
      if (isLocked) { setError(t.authErrorTooManyAttempts); return; }
      if (!emailOrPhone || !password) return;
      setLoading(true);
      await new Promise((r) => setTimeout(r, 800));
      setLoading(false);
      // Demo: wrong password triggers error after 3rd attempt
      if (password === "wrong") {
        const next = attempts + 1;
        setAttempts(next);
        setError(next >= MAX_ATTEMPTS ? t.authErrorTooManyAttempts : t.authErrorInvalidCredentials);
        return;
      }
      setStep("2fa");
    },
    [emailOrPhone, password, isLocked, attempts, t]
  );

  // ── 2FA submit ──────────────────────────────────────────────────────────
  const handle2Fa = useCallback(async () => {
    const code = twoFaOtp.join("");
    if (code.length < OTP_LENGTH) { setError(t.authErrorOtpInvalid); return; }
    setLoading(true);
    await new Promise((r) => setTimeout(r, 800));
    setLoading(false);
    router.push("/dashboard");
  }, [twoFaOtp, t, router]);

  const handle2FaInput = useCallback((index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    setTwoFaOtp((prev) => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });
    setError("");
    if (digit && index < OTP_LENGTH - 1) twoFaRefs.current[index + 1]?.focus();
  }, []);

  const handle2FaKeyDown = useCallback((index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !twoFaOtp[index] && index > 0)
      twoFaRefs.current[index - 1]?.focus();
  }, [twoFaOtp]);

  const handle2FaPaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH);
    const next = Array(OTP_LENGTH).fill("");
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setTwoFaOtp(next);
    const fi = Math.min(pasted.length, OTP_LENGTH - 1);
    twoFaRefs.current[fi]?.focus();
  }, []);

  return (
    <div className="min-h-screen bg-black text-white flex flex-col" dir={isRTL ? "rtl" : "ltr"}>
      <PalmXNavbar />

      <main className="flex-1 flex items-center justify-center px-4 py-24">
        <div className="w-full max-w-[420px]">

          {/* ── 2FA Step ──────────────────────────────────────────────── */}
          {step === "2fa" ? (
            <>
              <button
                onClick={() => { setStep("credentials"); setTwoFaOtp(Array(OTP_LENGTH).fill("")); setError(""); }}
                className={`inline-flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors mb-8 ${isRTL ? "flex-row-reverse" : ""}`}
              >
                <ArrowLeft className={`w-4 h-4 ${isRTL ? "rotate-180" : ""}`} />
                <span style={arabicFont}>{isRTL ? "العودة" : "Back"}</span>
              </button>

              <div className="text-center mb-8">
                <div className="w-14 h-14 rounded-full bg-[#e2b700]/15 flex items-center justify-center mx-auto mb-4">
                  <span className="text-2xl">🔐</span>
                </div>
                <h1 className="text-2xl font-bold text-white" style={arabicFont}>{t.authTwoFaTitle}</h1>
                <p className="text-sm text-white/40 mt-2" style={arabicFont}>{t.authTwoFaSubtitle}</p>
              </div>

              <div className="bg-[#0a0a0a] border border-white/8 rounded-2xl p-7">
                <div className={`flex gap-2 justify-center mb-6 ${isRTL ? "flex-row-reverse" : ""}`}>
                  {Array.from({ length: OTP_LENGTH }).map((_, i) => (
                    <input
                      key={i}
                      ref={(el) => { twoFaRefs.current[i] = el; }}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={twoFaOtp[i]}
                      onChange={(e) => handle2FaInput(i, e.target.value)}
                      onKeyDown={(e) => handle2FaKeyDown(i, e)}
                      onPaste={handle2FaPaste}
                      className={`w-11 h-14 text-center text-xl font-bold bg-white/5 border rounded-xl text-white focus:outline-none transition-colors ${
                        twoFaOtp[i] ? "border-[#e2b700]/60 bg-[#e2b700]/5" : "border-white/10 focus:border-[#e2b700]/40"
                      }`}
                      autoFocus={i === 0}
                    />
                  ))}
                </div>

                {error && (
                  <div className="text-xs text-[#f6465d] bg-[#f6465d]/10 border border-[#f6465d]/20 rounded-xl px-4 py-2.5 mb-4 text-center" style={arabicFont}>
                    {error}
                  </div>
                )}

                <button
                  onClick={handle2Fa}
                  disabled={twoFaOtp.join("").length < OTP_LENGTH || loading}
                  className="w-full py-3.5 bg-[#e2b700] hover:bg-[#f5ca00] disabled:bg-white/10 disabled:text-white/30 text-black font-bold rounded-xl transition-colors"
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
                  ) : t.authTwoFaTitle.split(" ")[0] === "Two-Factor" ? "Verify & Log In" : "تحقق وادخل"}
                </button>

                <p className="text-[10px] text-white/15 text-center mt-4" style={arabicFont}>
                  {isRTL ? "بيئة تجريبية: أي رمز مكون من 6 أرقام صالح" : "Demo mode: any 6-digit code is accepted"}
                </p>
              </div>
            </>
          ) : (

          /* ── Credentials Step ─────────────────────────────────────── */
          <>
            <div className="text-center mb-8">
              <Link href="/" className="inline-flex items-center gap-2 mb-4">
                <span className="text-2xl">🌴</span>
                <span className="text-2xl font-bold text-white">Palm<span style={{ color: "#e2b700" }}>X</span></span>
              </Link>
              <h1 className="text-2xl font-bold text-white" style={arabicFont}>{t.authLogin}</h1>
              <p className="text-sm text-white/40 mt-1" style={arabicFont}>
                {t.authNoAccount}{" "}
                <Link href="/signup" className="text-[#e2b700] hover:underline">{t.authSignup}</Link>
              </p>
            </div>

            <div className="bg-[#0a0a0a] border border-white/8 rounded-2xl p-7">
              <form onSubmit={handleLogin} noValidate className="space-y-4">
                {/* Email or phone */}
                <div>
                  <label className="block text-xs text-white/40 mb-1.5" style={arabicFont}>{t.authEmailOrPhone}</label>
                  <input
                    type="text"
                    required
                    autoComplete="username"
                    value={emailOrPhone}
                    onChange={(e) => setEmailOrPhone(e.target.value)}
                    disabled={isLocked}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-[#e2b700]/60 transition-colors disabled:opacity-40"
                    placeholder={isRTL ? "user@example.com أو +964..." : "user@example.com or +964..."}
                    style={arabicFont}
                  />
                </div>

                {/* Password */}
                <div>
                  <div className={`flex items-center justify-between mb-1.5 ${isRTL ? "flex-row-reverse" : ""}`}>
                    <label className="text-xs text-white/40" style={arabicFont}>{t.authPassword}</label>
                    <Link href="/forgot-password" className="text-xs text-[#e2b700] hover:underline" style={arabicFont}>
                      {t.authForgotPassword}
                    </Link>
                  </div>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={isLocked}
                      className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-[#e2b700]/60 transition-colors pr-12 disabled:opacity-40"
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
                </div>

                {/* Remember me */}
                <label className={`flex items-center gap-2.5 cursor-pointer group ${isRTL ? "flex-row-reverse" : ""}`}>
                  <div
                    onClick={() => setRememberMe((r) => !r)}
                    className={`w-4 h-4 rounded border transition-all flex items-center justify-center cursor-pointer ${
                      rememberMe ? "bg-[#e2b700] border-[#e2b700]" : "border-white/20 group-hover:border-white/40"
                    }`}
                  >
                    {rememberMe && (
                      <svg viewBox="0 0 10 10" className="w-2.5 h-2.5" fill="none">
                        <path d="M1.5 5l2.5 2.5 5-5" stroke="black" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </div>
                  <span className="text-xs text-white/50" style={arabicFont}>{t.authRememberMe}</span>
                </label>

                {/* Error */}
                {error && (
                  <div className="text-xs text-[#f6465d] bg-[#f6465d]/10 border border-[#f6465d]/20 rounded-xl px-4 py-2.5" style={arabicFont}>
                    {error}
                  </div>
                )}

                {/* Submit */}
                <button
                  type="submit"
                  disabled={!emailOrPhone || !password || loading || isLocked}
                  className="w-full py-3.5 bg-[#e2b700] hover:bg-[#f5ca00] disabled:bg-white/10 disabled:text-white/30 text-black font-bold rounded-xl transition-colors"
                  style={arabicFont}
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                      </svg>
                      {isRTL ? "جارٍ التسجيل..." : "Logging in..."}
                    </span>
                  ) : t.authLogin}
                </button>
              </form>

              {/* reCAPTCHA notice */}
              <div className={`flex items-center gap-1.5 mt-4 justify-center ${isRTL ? "flex-row-reverse" : ""}`}>
                <Shield className="w-3 h-3 text-white/20" />
                <p className="text-[10px] text-white/20" style={arabicFont}>{t.authProtectedBy}</p>
              </div>
            </div>
          </>
          )}

        </div>
      </main>
    </div>
  );
}
