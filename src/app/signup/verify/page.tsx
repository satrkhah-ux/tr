"use client";

import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, RefreshCw } from "lucide-react";
import { PalmXNavbar } from "@/components/PalmXNavbar";
import { useLanguage } from "@/components/LanguageProvider";

const OTP_LENGTH = 6;
const RESEND_COOLDOWN = 60;

function VerifyContent() {
  const { t, isRTL } = useLanguage();
  const router = useRouter();
  const params = useSearchParams();
  const arabicFont = isRTL ? { fontFamily: "Arial, Tahoma, sans-serif" } : {};

  const destination = params.get("to") ?? "";
  const type = params.get("type") ?? "email";

  const [otp, setOtp] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [verified, setVerified] = useState(false);
  const [resendTimer, setResendTimer] = useState(RESEND_COOLDOWN);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Countdown timer
  useEffect(() => {
    if (resendTimer <= 0) return;
    const id = setInterval(() => setResendTimer((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [resendTimer]);

  const handleInput = useCallback((index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    setOtp((prev) => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });
    setError("");
    if (digit && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  }, []);

  const handleKeyDown = useCallback((index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }, [otp]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH);
    const next = Array(OTP_LENGTH).fill("");
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i];
    setOtp(next);
    const focusIdx = Math.min(pasted.length, OTP_LENGTH - 1);
    inputRefs.current[focusIdx]?.focus();
  }, []);

  const handleVerify = useCallback(async () => {
    const code = otp.join("");
    if (code.length < OTP_LENGTH) { setError(t.authErrorOtpInvalid); return; }
    setLoading(true);
    await new Promise((r) => setTimeout(r, 800));
    setLoading(false);
    // Demo: any 6-digit code passes
    setVerified(true);
    setTimeout(() => router.push("/dashboard"), 1800);
  }, [otp, t, router]);

  const handleResend = useCallback(() => {
    if (resendTimer > 0) return;
    setOtp(Array(OTP_LENGTH).fill(""));
    setError("");
    setResendTimer(RESEND_COOLDOWN);
    inputRefs.current[0]?.focus();
  }, [resendTimer]);

  if (verified) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center space-y-4">
          <CheckCircle2 className="w-16 h-16 text-[#0ecb81] mx-auto animate-bounce" />
          <p className="text-white font-bold text-xl" style={arabicFont}>
            {isRTL ? "تم التحقق بنجاح!" : "Account Verified!"}
          </p>
          <p className="text-white/40 text-sm" style={arabicFont}>
            {isRTL ? "جارٍ تحويلك إلى لوحة التحكم..." : "Redirecting to your dashboard..."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white flex flex-col" dir={isRTL ? "rtl" : "ltr"}>
      <PalmXNavbar />

      <main className="flex-1 flex items-center justify-center px-4 py-24">
        <div className="w-full max-w-[420px]">
          {/* Back */}
          <Link
            href="/signup"
            className={`inline-flex items-center gap-2 text-sm text-white/40 hover:text-white transition-colors mb-8 ${isRTL ? "flex-row-reverse" : ""}`}
          >
            <ArrowLeft className={`w-4 h-4 ${isRTL ? "rotate-180" : ""}`} />
            <span style={arabicFont}>{isRTL ? "العودة" : "Back"}</span>
          </Link>

          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-full bg-[#e2b700]/15 flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">{type === "phone" ? "📱" : "📧"}</span>
            </div>
            <h1 className="text-2xl font-bold text-white" style={arabicFont}>{t.authOtpTitle}</h1>
            <p className="text-sm text-white/40 mt-2 leading-relaxed" style={arabicFont}>
              {t.authOtpSubtitle}{" "}
              <span className="text-white font-semibold">{destination}</span>
            </p>
          </div>

          <div className="bg-[#0a0a0a] border border-white/8 rounded-2xl p-7">
            {/* OTP inputs */}
            <div className={`flex gap-2 justify-center mb-6 ${isRTL ? "flex-row-reverse" : ""}`}>
              {Array.from({ length: OTP_LENGTH }).map((_, i) => (
                <input
                  key={i}
                  ref={(el) => { inputRefs.current[i] = el; }}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={otp[i]}
                  onChange={(e) => handleInput(i, e.target.value)}
                  onKeyDown={(e) => handleKeyDown(i, e)}
                  onPaste={handlePaste}
                  className={`w-11 h-14 text-center text-xl font-bold bg-white/5 border rounded-xl text-white focus:outline-none transition-colors ${
                    otp[i] ? "border-[#e2b700]/60 bg-[#e2b700]/5" : "border-white/10 focus:border-[#e2b700]/40"
                  }`}
                  autoComplete="one-time-code"
                />
              ))}
            </div>

            {/* Error */}
            {error && (
              <div className="text-xs text-[#f6465d] bg-[#f6465d]/10 border border-[#f6465d]/20 rounded-xl px-4 py-2.5 mb-4 text-center" style={arabicFont}>
                {error}
              </div>
            )}

            {/* Verify button */}
            <button
              onClick={handleVerify}
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

            {/* Resend */}
            <div className="mt-5 text-center">
              {resendTimer > 0 ? (
                <p className="text-xs text-white/30" style={arabicFont}>
                  {t.authOtpResendIn} {resendTimer}s
                </p>
              ) : (
                <button
                  onClick={handleResend}
                  className="inline-flex items-center gap-1.5 text-xs text-[#e2b700] hover:text-[#f5ca00] transition-colors"
                  style={arabicFont}
                >
                  <RefreshCw className="w-3 h-3" /> {t.authOtpResend}
                </button>
              )}
            </div>

            {/* Demo hint */}
            <p className="text-[10px] text-white/15 text-center mt-4" style={arabicFont}>
              {isRTL ? "بيئة تجريبية: أي رمز مكون من 6 أرقام صالح" : "Demo mode: any 6-digit code is accepted"}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyContent />
    </Suspense>
  );
}
