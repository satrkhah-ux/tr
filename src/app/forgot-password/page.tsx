"use client";

import { useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, EyeOff, CheckCircle2, Shield, Check } from "lucide-react";
import { PalmXNavbar } from "@/components/PalmXNavbar";
import { useLanguage } from "@/components/LanguageProvider";

const OTP_LENGTH = 6;

type Step = "request" | "otp" | "newPassword" | "success";

function calcStrength(pw: string): number {
  let s = 0;
  if (pw.length >= 8) s++;
  if (/[A-Z]/.test(pw)) s++;
  if (/[a-z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(4, s);
}

const STRENGTH_COLORS = ["#f6465d", "#f6465d", "#e2b700", "#3b82f6", "#0ecb81"];

export default function ForgotPasswordPage() {
  const { t, isRTL } = useLanguage();
  const router = useRouter();
  const arabicFont = isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {};

  const [step, setStep] = useState<Step>("request");
  const [identifier, setIdentifier] = useState("");
  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  const strength = calcStrength(newPassword);

  // ── Step 1: Request ─────────────────────────────────────────────────────
  const handleRequest = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier) return;
    setLoading(true);
    await new Promise((r) => setTimeout(r, 800));
    setLoading(false);
    setStep("otp");
  }, [identifier]);

  // ── Step 2: OTP ─────────────────────────────────────────────────────────
  const handleOtpInput = useCallback((index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    setOtp((prev) => { const n = [...prev]; n[index] = digit; return n; });
    setError("");
    if (digit && index < OTP_LENGTH - 1) otpRefs.current[index + 1]?.focus();
  }, []);

  const handleOtpKeyDown = useCallback((index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) otpRefs.current[index - 1]?.focus();
  }, [otp]);

  const handleOtpPaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const p = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH);
    const n = Array(OTP_LENGTH).fill("");
    for (let i = 0; i < p.length; i++) n[i] = p[i];
    setOtp(n);
    otpRefs.current[Math.min(p.length, OTP_LENGTH - 1)]?.focus();
  }, []);

  const handleOtpVerify = useCallback(async () => {
    if (otp.join("").length < OTP_LENGTH) { setError(t.authErrorOtpInvalid); return; }
    setLoading(true);
    await new Promise((r) => setTimeout(r, 800));
    setLoading(false);
    setStep("newPassword");
  }, [otp, t]);

  // ── Step 3: New Password ────────────────────────────────────────────────
  const handleReset = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (strength < 3) { setError(t.authErrorPasswordWeak); return; }
    if (newPassword !== confirmPassword) { setError(t.authErrorPasswordMismatch); return; }
    setLoading(true);
    await new Promise((r) => setTimeout(r, 800));
    setLoading(false);
    setStep("success");
    setTimeout(() => router.push("/login"), 2500);
  }, [strength, newPassword, confirmPassword, t, router]);

  // ── UI helpers ──────────────────────────────────────────────────────────
  const StepIndicator = () => {
    const steps = ["request", "otp", "newPassword"] as const;
    const currentIdx = steps.indexOf(step as typeof steps[number]);
    return (
      <div className={`flex items-center gap-2 mb-8 ${isRTL ? "flex-row-reverse" : ""}`}>
        {steps.map((s, i) => {
          const done = currentIdx > i;
          const active = step === s;
          return (
            <div key={s} className={`flex items-center gap-2 ${isRTL ? "flex-row-reverse" : ""}`}>
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  done ? "bg-[#0ecb81] text-black" : active ? "bg-[#e2b700] text-black" : "bg-white/10 text-white/30"
                }`}
              >
                {done ? "✓" : i + 1}
              </div>
              {i < 2 && <div className={`h-px w-10 transition-colors ${done ? "bg-[#0ecb81]/60" : "bg-white/10"}`} />}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col" dir={isRTL ? "rtl" : "ltr"}>
      <PalmXNavbar />

      <main className="flex-1 flex items-center justify-center px-4 py-24">
        <div className="w-full max-w-[420px]">

          {/* Success */}
          {step === "success" ? (
            <div className="text-center space-y-4 py-12">
              <CheckCircle2 className="w-16 h-16 text-[#0ecb81] mx-auto" />
              <h2 className="text-xl font-bold text-white" style={arabicFont}>{t.authPasswordChanged}</h2>
              <p className="text-sm text-white/40" style={arabicFont}>
                {isRTL ? "جارٍ تحويلك..." : "Redirecting to login..."}
              </p>
            </div>
          ) : (
            <>
              {/* Back link */}
              <Link
                href="/login"
                className={`inline-flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors mb-8 ${isRTL ? "flex-row-reverse" : ""}`}
              >
                <ArrowLeft className={`w-4 h-4 ${isRTL ? "rotate-180" : ""}`} />
                <span style={arabicFont}>{t.authBackToLogin}</span>
              </Link>

              <div className="text-center mb-6">
                <h1 className="text-2xl font-bold text-white" style={arabicFont}>{t.authForgotTitle}</h1>
                <p className="text-sm text-white/40 mt-1" style={arabicFont}>
                  {step === "request" && t.authForgotSubtitle}
                  {step === "otp" && `${t.authOtpSubtitle} ${identifier}`}
                  {step === "newPassword" && (isRTL ? "أدخل كلمة المرور الجديدة" : "Enter your new password")}
                </p>
              </div>

              <StepIndicator />

              <div className="bg-[#0a0a0a] border border-white/8 rounded-2xl p-7">

                {/* ── Step 1: Request ────────────────────────────── */}
                {step === "request" && (
                  <form onSubmit={handleRequest} noValidate className="space-y-4">
                    <div>
                      <label className="block text-xs text-white/40 mb-1.5" style={arabicFont}>{t.authEmailOrPhone}</label>
                      <input
                        type="text"
                        required
                        autoComplete="username"
                        value={identifier}
                        onChange={(e) => setIdentifier(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-[#e2b700]/60 transition-colors"
                        placeholder={isRTL ? "user@example.com أو +964..." : "user@example.com or +964..."}
                        style={arabicFont}
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={!identifier || loading}
                      className="w-full py-3.5 bg-[#e2b700] hover:bg-[#f5ca00] disabled:bg-white/10 disabled:text-white/30 text-black font-bold rounded-xl transition-colors"
                      style={arabicFont}
                    >
                      {loading ? (
                        <span className="flex items-center justify-center gap-2">
                          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                          </svg>
                          {isRTL ? "جارٍ الإرسال..." : "Sending..."}
                        </span>
                      ) : t.authForgotSend}
                    </button>
                  </form>
                )}

                {/* ── Step 2: OTP ────────────────────────────────── */}
                {step === "otp" && (
                  <div className="space-y-5">
                    <div className={`flex gap-2 justify-center ${isRTL ? "flex-row-reverse" : ""}`}>
                      {Array.from({ length: OTP_LENGTH }).map((_, i) => (
                        <input
                          key={i}
                          ref={(el) => { otpRefs.current[i] = el; }}
                          type="text"
                          inputMode="numeric"
                          maxLength={1}
                          value={otp[i]}
                          onChange={(e) => handleOtpInput(i, e.target.value)}
                          onKeyDown={(e) => handleOtpKeyDown(i, e)}
                          onPaste={handleOtpPaste}
                          className={`w-11 h-14 text-center text-xl font-bold bg-white/5 border rounded-xl text-white focus:outline-none transition-colors ${
                            otp[i] ? "border-[#e2b700]/60 bg-[#e2b700]/5" : "border-white/10 focus:border-[#e2b700]/40"
                          }`}
                          autoFocus={i === 0}
                        />
                      ))}
                    </div>
                    {error && (
                      <div className="text-xs text-[#f6465d] bg-[#f6465d]/10 border border-[#f6465d]/20 rounded-xl px-4 py-2.5 text-center" style={arabicFont}>
                        {error}
                      </div>
                    )}
                    <button
                      onClick={handleOtpVerify}
                      disabled={otp.join("").length < OTP_LENGTH || loading}
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
                      ) : t.authOtpVerify}
                    </button>
                    <p className="text-[10px] text-white/15 text-center" style={arabicFont}>
                      {isRTL ? "بيئة تجريبية: أي رمز مكون من 6 أرقام صالح" : "Demo mode: any 6-digit code is accepted"}
                    </p>
                  </div>
                )}

                {/* ── Step 3: New Password ─────────────────────── */}
                {step === "newPassword" && (
                  <form onSubmit={handleReset} noValidate className="space-y-4">
                    <div>
                      <label className="block text-xs text-white/40 mb-1.5" style={arabicFont}>{t.authNewPassword}</label>
                      <div className="relative">
                        <input
                          type={showNew ? "text" : "password"}
                          required
                          autoComplete="new-password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-[#e2b700]/60 transition-colors pr-12"
                          placeholder="••••••••"
                        />
                        <button
                          type="button"
                          onClick={() => setShowNew((s) => !s)}
                          className={`absolute ${isRTL ? "left-3" : "right-3"} top-1/2 -translate-y-1/2 text-white/30 hover:text-white/70`}
                          tabIndex={-1}
                        >
                          {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      {newPassword.length > 0 && (
                        <div className="mt-2 space-y-1.5">
                          <div className="flex gap-1">
                            {[1, 2, 3, 4].map((i) => (
                              <div key={i} className="h-1.5 flex-1 rounded-full transition-all" style={{ backgroundColor: strength >= i ? STRENGTH_COLORS[strength] : "#ffffff18" }} />
                            ))}
                          </div>
                          {[
                            { l: "8+ chars", lA: "8+ أحرف", fn: (p: string) => p.length >= 8 },
                            { l: "Uppercase", lA: "حرف كبير", fn: (p: string) => /[A-Z]/.test(p) },
                            { l: "Number",    lA: "رقم",      fn: (p: string) => /[0-9]/.test(p) },
                            { l: "Symbol",    lA: "رمز",      fn: (p: string) => /[^A-Za-z0-9]/.test(p) },
                          ].map(({ l, lA, fn }) => {
                            const ok = fn(newPassword);
                            return (
                              <div key={l} className={`flex items-center gap-1.5 text-xs ${isRTL ? "flex-row-reverse" : ""}`}>
                                <Check className={`w-3 h-3 ${ok ? "text-[#0ecb81]" : "text-white/20"}`} />
                                <span className={ok ? "text-[#0ecb81]" : "text-white/30"} style={arabicFont}>{isRTL ? lA : l}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs text-white/40 mb-1.5" style={arabicFont}>{t.authConfirmPassword}</label>
                      <div className="relative">
                        <input
                          type={showConfirm ? "text" : "password"}
                          required
                          autoComplete="new-password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className={`w-full bg-white/5 border rounded-xl px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none transition-colors pr-12 ${
                            confirmPassword && confirmPassword !== newPassword ? "border-[#f6465d]/50" : "border-white/10 focus:border-[#e2b700]/60"
                          }`}
                          placeholder="••••••••"
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirm((s) => !s)}
                          className={`absolute ${isRTL ? "left-3" : "right-3"} top-1/2 -translate-y-1/2 text-white/30 hover:text-white/70`}
                          tabIndex={-1}
                        >
                          {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      {confirmPassword && confirmPassword !== newPassword && (
                        <p className="text-xs text-[#f6465d] mt-1" style={arabicFont}>{t.authErrorPasswordMismatch}</p>
                      )}
                    </div>
                    {error && (
                      <div className="text-xs text-[#f6465d] bg-[#f6465d]/10 border border-[#f6465d]/20 rounded-xl px-4 py-2.5" style={arabicFont}>
                        {error}
                      </div>
                    )}
                    <button
                      type="submit"
                      disabled={strength < 3 || newPassword !== confirmPassword || loading}
                      className="w-full py-3.5 bg-[#e2b700] hover:bg-[#f5ca00] disabled:bg-white/10 disabled:text-white/30 text-black font-bold rounded-xl transition-colors"
                      style={arabicFont}
                    >
                      {loading ? (
                        <span className="flex items-center justify-center gap-2">
                          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                          </svg>
                          {isRTL ? "جارٍ الحفظ..." : "Saving..."}
                        </span>
                      ) : t.authResetPassword}
                    </button>
                  </form>
                )}

                {/* reCAPTCHA */}
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
