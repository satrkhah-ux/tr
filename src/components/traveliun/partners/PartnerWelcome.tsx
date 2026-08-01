"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, KeyRound, Loader2, ShieldAlert } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Where an invitation lands: set a password, and you are in.
 *
 * The invite mail used to point at the site root, which did nothing at all —
 * the account existed and there was no way to give it a password. This page is
 * the missing half of «إصدار حساب».
 *
 * The token arrives in one of three shapes depending on how Supabase built the
 * link, and the browser client is configured with `detectSessionInUrl: false`,
 * so all three are handled here explicitly rather than hoped for:
 *   #access_token + #refresh_token  → setSession
 *   ?token_hash=&type=              → verifyOtp   (the modern email link)
 *   ?code=                          → exchangeCodeForSession (PKCE)
 */
const field =
  "h-11 w-full rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-sm text-[#185045] outline-none focus:border-[#2aa87a]";

type Phase = "checking" | "ready" | "invalid" | "done";

export function PartnerWelcome() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    (async () => {
      try {
        // An already-valid session (a refresh of this page, say) is enough.
        const existing = await supabase.auth.getSession();
        if (existing.data.session) {
          setPhase("ready");
          return;
        }

        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
        const query = new URLSearchParams(window.location.search);

        const accessToken = hash.get("access_token");
        const refreshToken = hash.get("refresh_token");
        if (accessToken && refreshToken) {
          const { error: e } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          setPhase(e ? "invalid" : "ready");
          return;
        }

        const tokenHash = query.get("token_hash");
        const type = query.get("type");
        if (tokenHash) {
          const { error: e } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: (type as "invite" | "recovery" | "magiclink") ?? "invite",
          });
          setPhase(e ? "invalid" : "ready");
          return;
        }

        const code = query.get("code");
        if (code) {
          const { error: e } = await supabase.auth.exchangeCodeForSession(code);
          setPhase(e ? "invalid" : "ready");
          return;
        }

        setPhase("invalid");
      } catch {
        setPhase("invalid");
      }
    })();
  }, []);

  if (phase === "checking") {
    return (
      <div className="grid place-items-center rounded-2xl border border-[#e2ebe7] bg-white p-10">
        <Loader2 className="size-6 animate-spin text-[#185045]" />
      </div>
    );
  }

  if (phase === "invalid") {
    return (
      <div className="rounded-2xl border border-[#f2c7c7] bg-[#fff7f7] p-8 text-center">
        <ShieldAlert className="mx-auto size-9 text-[#c43d3d]" />
        <h2 className="mt-3 text-lg font-extrabold text-[#0f3d38]">هذا الرابط لم يعد صالحاً</h2>
        <p className="mt-2 text-[13px] font-semibold text-[#557d78]">
          روابط الدعوة تنتهي صلاحيتها بعد فترة، أو تكون قد استُخدمت من قبل. تواصل مع فريق ترافليون
          لإرسال دعوة جديدة.
        </p>
        <Link
          href="/b2b"
          className="mt-5 inline-flex h-10 items-center rounded-[10px] border border-[#dbe6e1] px-4 text-[12.5px] font-bold text-[#557d78] hover:bg-[#f4f8f6]"
        >
          العودة لبوابة الشركات
        </Link>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="rounded-2xl border border-[#bfe5d4] bg-[#f2fbf6] p-8 text-center">
        <CheckCircle2 className="mx-auto size-10 text-[#0f7a52]" />
        <h2 className="mt-3 text-lg font-extrabold text-[#0f3d38]">تم تعيين كلمة المرور</h2>
        <p className="mt-2 text-[13px] font-semibold text-[#557d78]">جارٍ فتح بوابتك…</p>
      </div>
    );
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        if (password.length < 8) {
          setError("كلمة المرور يجب أن تكون 8 أحرف على الأقل.");
          return;
        }
        if (password !== confirm) {
          setError("الكلمتان غير متطابقتين.");
          return;
        }
        setSaving(true);
        try {
          const supabase = createSupabaseBrowserClient();
          const { error: e2 } = await supabase.auth.updateUser({ password });
          if (e2) {
            setError("تعذّر حفظ كلمة المرور. جرّب رابط الدعوة مرة أخرى.");
            return;
          }
          setPhase("done");
          router.replace("/b2b");
          router.refresh();
        } finally {
          setSaving(false);
        }
      }}
      className="rounded-2xl border border-[#e2ebe7] bg-white p-6 shadow-[0_1px_2px_rgba(0,60,58,0.04)]"
    >
      <h2 className="text-base font-extrabold text-[#003c3a]">اختر كلمة المرور</h2>
      <p className="mb-4 mt-1 text-[12px] font-semibold text-[#93aaa3]">
        هذه كلمتك أنت — لا يعرفها أحد في ترافليون ولا تُخزَّن لدينا.
      </p>

      <div className="grid gap-3">
        <label className="grid gap-1.5 text-[12px] font-bold text-[#185045]">
          كلمة المرور
          <input
            type="password"
            dir="ltr"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${field} text-start`}
          />
        </label>
        <label className="grid gap-1.5 text-[12px] font-bold text-[#185045]">
          تأكيد كلمة المرور
          <input
            type="password"
            dir="ltr"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={`${field} text-start`}
          />
        </label>
      </div>

      {error ? <p className="mt-3 text-[12.5px] font-bold text-[#c22850]">{error}</p> : null}

      <button
        type="submit"
        disabled={saving}
        className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-[#185045] text-[13px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
      >
        {saving ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
        حفظ والدخول
      </button>
    </form>
  );
}
