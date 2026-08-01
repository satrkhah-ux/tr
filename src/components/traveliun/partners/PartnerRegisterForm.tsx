"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { registerPartnerCompany } from "@/lib/partners/registration";

/**
 * The registration form a company fills in from the outside.
 *
 * Deliberately short. Everything commercial — colours, logo placement, the
 * percentage — is set by us at approval, so asking for it here would suggest the
 * company decides it. What we need now is who they are and how to reach them.
 */

const field =
  "h-11 w-full rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-sm text-[#185045] outline-none focus:border-[#2aa87a]";
const label = "grid gap-1.5 text-[12px] font-bold text-[#185045]";

export function PartnerRegisterForm() {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    name_latin: "",
    email: "",
    phone: "",
    contact_name: "",
    website: "",
    address: "",
    note: "",
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  if (done) {
    return (
      <div className="rounded-2xl border border-[#bfe5d4] bg-[#f2fbf6] p-8 text-center">
        <CheckCircle2 className="mx-auto size-10 text-[#0f7a52]" />
        <h2 className="mt-3 text-lg font-extrabold text-[#0f3d38]">وصلنا طلبك</h2>
        <p className="mt-2 text-[13px] font-semibold text-[#557d78]">
          سيراجعه فريقنا ويتواصل معك على البريد الذي سجّلته. عند الاعتماد يصلك رابط لتعيين كلمة المرور
          والدخول إلى بوابة الشركات.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const res = await registerPartnerCompany(form);
          if (res.ok) setDone(true);
          else setError(res.message);
        });
      }}
      className="grid gap-4 rounded-2xl border border-[#e2ebe7] bg-white p-6 shadow-[0_1px_2px_rgba(0,60,58,0.04)]"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={label}>
          اسم الشركة *
          <input required value={form.name} onChange={set("name")} className={field} />
        </label>
        <label className={label}>
          الاسم بالإنجليزية
          <input dir="ltr" value={form.name_latin} onChange={set("name_latin")} className={`${field} text-start`} />
        </label>
        <label className={label}>
          البريد الإلكتروني *
          <input required type="email" dir="ltr" value={form.email} onChange={set("email")} className={`${field} text-start`} />
        </label>
        <label className={label}>
          رقم التواصل *
          <input required dir="ltr" value={form.phone} onChange={set("phone")} className={`${field} text-start`} />
        </label>
        <label className={label}>
          اسم المسؤول
          <input value={form.contact_name} onChange={set("contact_name")} className={field} />
        </label>
        <label className={label}>
          الموقع الإلكتروني
          <input dir="ltr" placeholder="https://" value={form.website} onChange={set("website")} className={`${field} text-start`} />
        </label>
      </div>

      <label className={label}>
        العنوان
        <input value={form.address} onChange={set("address")} className={field} />
      </label>

      <label className={label}>
        نبذة عن الشركة ونشاطها
        <textarea
          rows={3}
          value={form.note}
          onChange={set("note")}
          className="w-full rounded-[10px] border border-[#dbe6e1] bg-white p-3 text-sm text-[#185045] outline-none focus:border-[#2aa87a]"
        />
      </label>

      {/* The logo is uploaded after approval, from the partner's own portal —
          an unapproved company's file has nowhere to live and nothing to brand. */}
      <p className="text-[11.5px] font-semibold text-[#93aaa3]">
        شعار الشركة يُرفع بعد الاعتماد من داخل البوابة، ويُعتمد مع الألوان.
      </p>

      {error ? <p className="text-[12.5px] font-bold text-[#c22850]">{error}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-[#185045] px-6 text-[13px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        إرسال الطلب
      </button>
    </form>
  );
}
