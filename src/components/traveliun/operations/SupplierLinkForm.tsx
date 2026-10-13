"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmViaSupplierLink } from "@/lib/data/public-links";

const field = "h-11 w-full rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-[14px] text-[#185045] outline-none focus:border-[#2aa87a]";
const label = "grid gap-1.5 text-[12.5px] font-bold text-[#185045]";

/**
 * The supplier's answer on his link: the confirmation number — or, for a
 * drive or a tour, the driver and the car. The supplier is not a system user,
 * so no shell and no dictionary: his request language picks the words.
 */
export function SupplierLinkForm({
  token,
  en,
  driverKind,
  initial,
}: {
  token: string;
  en: boolean;
  driverKind: boolean;
  initial: { driver: string; phone: string; car: string; plate: string };
}) {
  const router = useRouter();
  const [form, setForm] = useState({ ref: "", ...initial });
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const L = (ar: string, english: string) => (en ? english : ar);

  if (message?.ok) return <p className="rounded-[12px] bg-[#e9f7f0] px-4 py-3 text-[14px] font-bold text-[#0f7a52]">{message.text}</p>;

  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          try {
            const res = await confirmViaSupplierLink(token, form);
            setMessage({ ok: res.ok, text: res.message });
            if (res.ok) router.refresh();
          } catch {
            setMessage({ ok: false, text: L("تعذّر الإرسال. حاولوا مرة أخرى.", "Could not send. Please try again.") });
          }
        });
      }}
    >
      <h2 className="text-[15px] font-extrabold">{L("تأكيد الحجز", "Confirm the booking")}</h2>
      <label className={label}>
        {driverKind ? L("رقم التأكيد (اختياري)", "Confirmation number (optional)") : L("رقم التأكيد", "Confirmation number")}
        <input dir="ltr" required={!driverKind} maxLength={60} value={form.ref} onChange={set("ref")} className={field} />
      </label>
      {driverKind ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={label}>
            {L("اسم السائق", "Driver name")}
            <input required maxLength={120} value={form.driver} onChange={set("driver")} className={field} />
          </label>
          <label className={label}>
            {L("جوال السائق", "Driver mobile")}
            <input required dir="ltr" type="tel" maxLength={30} value={form.phone} onChange={set("phone")} className={field} />
          </label>
          <label className={label}>
            {L("السيارة", "Vehicle")}
            <input maxLength={120} value={form.car} onChange={set("car")} className={field} />
          </label>
          <label className={label}>
            {L("رقم اللوحة", "Plate no.")}
            <input dir="ltr" maxLength={30} value={form.plate} onChange={set("plate")} className={field} />
          </label>
        </div>
      ) : null}
      {message ? <p className="text-[12.5px] font-bold text-[#c22850]">{message.text}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-11 items-center justify-center rounded-[10px] bg-[#185045] px-6 text-[14px] font-bold text-white disabled:opacity-50"
      >
        {pending ? L("جارٍ الإرسال…", "Sending…") : L("تأكيد", "Confirm")}
      </button>
    </form>
  );
}
