"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { registerPartnerCompany } from "@/lib/partners/registration";
import { DOCUMENT_KINDS, DOCUMENT_LABEL, PARTNER_TERMS } from "@/lib/partners/registration-form";

/**
 * The registration form a company fills in from the outside.
 *
 * Everything commercial — colours, logo placement, the percentage — is set by
 * us at approval, so asking for it here would suggest the company decides it.
 * What we need now is who they are, that they are licensed to sell travel, how
 * to reach them, and that they accept the terms. Sent as FormData: the
 * documents travel with it.
 */

const field =
  "tv-field h-11 w-full rounded-[10px] border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus";
const label = "grid gap-1.5 text-[12px] font-bold text-[#185045]";

export function PartnerRegisterForm() {
  const [pending, startTransition] = useTransition();
  const [reference, setReference] = useState<string | null>(null);
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
    commercial_register: "",
    tourism_license: "",
    vat_number: "",
    city: "",
    country: "",
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  if (reference) {
    return (
      <div className="rounded-2xl border border-[#bfe5d4] bg-[#f2fbf6] p-8 text-center">
        <CheckCircle2 className="mx-auto size-10 text-[#0f7a52]" />
        <h2 className="mt-3 text-lg font-extrabold text-[#0f3d38]">وصلنا طلبك</h2>
        <p className="mt-2 text-[13px] font-semibold text-[#557d78]">
          رقم طلبك: <bdi dir="ltr" className="font-extrabold text-[#0f3d38]">{reference}</bdi>
        </p>
        <p className="mt-2 text-[13px] font-semibold text-[#557d78]">
          نردّ خلال يومي عمل على البريد الذي سجّلته. عند الاعتماد يصلك رابط لتعيين كلمة المرور والدخول إلى
          بوابة الشركات.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        // the typed fields from state, the documents and the terms box from the form itself
        const data = new FormData(e.currentTarget);
        for (const [k, v] of Object.entries(form)) data.set(k, v);
        startTransition(async () => {
          const res = await registerPartnerCompany(data);
          if (res.ok) setReference(res.reference);
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

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={label}>
          الدولة *
          <input required value={form.country} onChange={set("country")} className={field} />
        </label>
        <label className={label}>
          المدينة *
          <input required value={form.city} onChange={set("city")} className={field} />
        </label>
      </div>

      <label className={label}>
        العنوان
        <input value={form.address} onChange={set("address")} className={field} />
      </label>

      <fieldset className="grid gap-4 rounded-[12px] border border-[#e2ebe7] p-4">
        <legend className="px-1 text-[12.5px] font-extrabold text-[#185045]">الترخيص</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <label className={label}>
            رقم السجل التجاري *
            <input required dir="ltr" value={form.commercial_register} onChange={set("commercial_register")} className={`${field} text-start`} />
          </label>
          <label className={label}>
            رقم رخصة وزارة السياحة
            <input dir="ltr" value={form.tourism_license} onChange={set("tourism_license")} className={`${field} text-start`} />
          </label>
          <label className={label}>
            الرقم الضريبي
            <input dir="ltr" value={form.vat_number} onChange={set("vat_number")} className={`${field} text-start`} />
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {DOCUMENT_KINDS.map((kind) => (
            <label key={kind} className={label}>
              {DOCUMENT_LABEL[kind]}
              {kind === "commercial_register" ? " *" : ""}
              <input
                type="file"
                name={`doc_${kind}`}
                required={kind === "commercial_register"}
                accept="application/pdf,image/jpeg,image/png,image/webp"
                className="text-[12px] font-semibold text-[#557d78] file:me-2 file:rounded-[8px] file:border-0 file:bg-[#eef4f1] file:px-3 file:py-2 file:text-[12px] file:font-bold file:text-[#185045]"
              />
            </label>
          ))}
        </div>
        <p className="text-[11.5px] font-semibold text-tv-text-faint">PDF أو صورة، حتى 5 ميغابايت لكل ملف. تبقى المستندات عندنا ولا تُنشر.</p>
      </fieldset>

      <label className={label}>
        نبذة عن الشركة ونشاطها
        <textarea
          rows={3}
          value={form.note}
          onChange={set("note")}
          className="tv-field w-full rounded-[10px] border p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus"
        />
      </label>

      {/* The same story the profile page tells: the identity is set with us after
          approval — an unapproved company has nothing to brand yet. */}
      <p className="text-[11.5px] font-semibold text-tv-text-faint">
        بعد الاعتماد ترسلون لنا شعار الشركة وألوانها، ونعتمدها لتظهر على عروضكم.
      </p>

      <details className="rounded-[12px] border border-[#e2ebe7] bg-[#f8fbf9] p-4 text-[12.5px] text-[#557d78]">
        <summary className="cursor-pointer font-extrabold text-[#185045]">شروط التعاون</summary>
        <ol className="mt-2 list-decimal space-y-1 ps-5 font-semibold">
          {PARTNER_TERMS.map((clause) => (
            <li key={clause}>{clause}</li>
          ))}
        </ol>
      </details>
      <label className="flex items-center gap-2 text-[12.5px] font-bold text-[#185045]">
        <input type="checkbox" name="terms" required className="size-4 accent-[#185045]" />
        قرأت شروط التعاون وأوافق عليها
      </label>

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
