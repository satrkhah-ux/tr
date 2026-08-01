"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Building2, Loader2, LogIn } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * The partner door.
 *
 * Two things and no third: sign in, or apply. Anyone arriving at /b2b is either
 * a company we already work with or one that wants to — and until this existed,
 * both were dropped into the staff shell and told the page did not exist.
 *
 * A staff address signing in here is not an error, it is just the wrong door:
 * the session is real, so we say so and point at the dashboard rather than
 * leaving them on a screen that will not load.
 */
const field =
  "h-11 w-full rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-sm text-[#185045] outline-none focus:border-[#2aa87a]";

export function PartnerSignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    if (!email.trim() || !password) {
      setError("أدخل البريد وكلمة المرور.");
      return;
    }

    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError(
          signInError.message.toLowerCase().includes("invalid")
            ? "البريد أو كلمة المرور غير صحيحة."
            : "تعذّر تسجيل الدخول. حاول مرة أخرى.",
        );
        return;
      }
      // The server decides what this account is — a partner lands on the portal,
      // an employee is told they are at the wrong door.
      router.replace("/b2b");
      router.refresh();
    } catch {
      setError("تعذّر الاتصال بالخادم.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <form
        onSubmit={onSubmit}
        className="rounded-2xl border border-[#e2ebe7] bg-white p-6 shadow-[0_1px_2px_rgba(0,60,58,0.04)]"
      >
        <h2 className="text-base font-extrabold text-[#003c3a]">دخول الشركات</h2>
        <p className="mb-4 mt-1 text-[12px] font-semibold text-[#93aaa3]">
          للشركات المعتمدة التي أُصدر لها حساب.
        </p>

        <div className="grid gap-3">
          <label className="grid gap-1.5 text-[12px] font-bold text-[#185045]">
            البريد الإلكتروني
            <input
              type="email"
              dir="ltr"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`${field} text-start`}
            />
          </label>
          <label className="grid gap-1.5 text-[12px] font-bold text-[#185045]">
            كلمة المرور
            <input
              type="password"
              dir="ltr"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${field} text-start`}
            />
          </label>
        </div>

        {error ? <p className="mt-3 text-[12.5px] font-bold text-[#c22850]">{error}</p> : null}

        <button
          type="submit"
          disabled={loading}
          className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-[#185045] text-[13px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
          دخول
        </button>
      </form>

      <div className="rounded-2xl border border-[#d6eadf] bg-[#f2fbf6] p-6">
        <Building2 className="size-7 text-[#0f7a52]" />
        <h2 className="mt-3 text-base font-extrabold text-[#003c3a]">لست شريكاً بعد؟</h2>
        <p className="mt-1 text-[12.5px] font-semibold text-[#557d78]">
          سجّل شركتك، وبعد اعتماد الطلب يصلك حساب تبني به بكجاتك بهوية شركتك — اسمك وشعارك وألوانك —
          بأسعارنا وشروطك.
        </p>
        <ul className="mt-3 space-y-1.5 text-[12px] font-bold text-[#185045]">
          <li>· ملفات PDF وفواتشر باسم شركتك</li>
          <li>· أسعار الفنادق والطيران والخدمات من نظامنا</li>
          <li>· متابعة الحجوزات أولاً بأول</li>
        </ul>
        <Link
          href="/b2b/register"
          className="mt-4 inline-flex h-11 items-center justify-center rounded-[10px] border border-[#185045] px-5 text-[13px] font-bold text-[#185045] hover:bg-white"
        >
          تقديم طلب شراكة
        </Link>
      </div>
    </div>
  );
}
