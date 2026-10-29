"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { deleteExternalTrip, saveExternalTrip, type ExternalTripRow } from "@/lib/data/external-trips";
import { CONFIRMED_ITEMS, EXTERNAL_STATUS, externalTripEnd, type ExternalStatus } from "@/lib/leads/lifecycle-rules";
import { EditSheet } from "@/components/ui/edit-sheet";
import { TraveliunShell } from "../TraveliunShell";

/**
 * «نظام البكجات ← المؤكدون خارج النظام» (the user, 2026-10-22): a confirmed
 * client from before the system in one short row — the mobile, the travel date,
 * the days, the destination, the status, what was paid and what was confirmed.
 * No offer, no file. The client's WhatsApp conversation is then handled as a
 * traveller's: when they write before the return + 3 days it comes back to
 * whoever entered the trip («إدارة المحادثات»).
 */
const FIELD = "h-9 rounded-[8px] border border-[#dbe6e1] bg-white px-2.5 text-[12.5px] text-[#0f3d38] outline-none focus:border-[#2aa87a]";
const CARD = "rounded-[14px] border border-[#cfe0d9] bg-white p-4";
const LABEL = "grid gap-1 text-[11.5px] font-bold text-[#185045]";
const STATUS_COLOR: Record<ExternalStatus, string> = { confirmed: "bg-[#eef6ff] text-[#1d4f8a]", paid_partial: "bg-[#fff6e6] text-[#8a5a10]", paid_full: "bg-[#e8f6ef] text-[#185045]", cancelled: "bg-[#f2f4f3] text-[#7a8a86]" };

type Form = { id?: string; phone: string; travelStart: string; days: string; destination: string; status: ExternalStatus; paid: string; confirmed: string[] };
const EMPTY: Form = { phone: "", travelStart: "", days: "", destination: "", status: "confirmed", paid: "", confirmed: [] };
const showPhone = (p: string) => (p.startsWith("966") ? `0${p.slice(3)}` : p);

export function ExternalTripsBoard({ initial }: { initial: { rows: ExternalTripRow[]; me: string | null; admin: boolean } }) {
  const router = useRouter();
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [mine, setMine] = useState(false);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const rows = mine ? initial.rows.filter((r) => r.employee_id === initial.me) : initial.rows;
  const canChange = (r: ExternalTripRow) => initial.admin || (initial.me !== null && r.employee_id === initial.me);

  const save = async () => {
    setBusy("save");
    setMsg(null);
    const r = await saveExternalTrip({
      id: form.id,
      phone: form.phone,
      travelStart: form.travelStart,
      days: Number(form.days),
      destination: form.destination,
      status: form.status,
      paidAmount: form.paid.trim() === "" ? null : Number(form.paid),
      confirmed: form.confirmed,
    });
    setBusy(null);
    setMsg(r.ok ? { ok: true, text: form.id ? "حُفظ التعديل" : "أُضيف العميل" } : { ok: false, text: r.error });
    if (r.ok) {
      setForm(EMPTY);
      router.refresh();
    }
  };
  const remove = async (r: ExternalTripRow) => {
    if (!window.confirm(`حذف رحلة ${showPhone(r.phone)} إلى ${r.destination}؟`)) return;
    setBusy(r.id);
    const res = await deleteExternalTrip(r.id);
    setBusy(null);
    setMsg(res.ok ? { ok: true, text: "حُذفت" } : { ok: false, text: res.error });
    if (res.ok) router.refresh();
  };
  const edit = (r: ExternalTripRow) => {
    setForm({ id: r.id, phone: showPhone(r.phone), travelStart: r.travel_start, days: String(r.days), destination: r.destination, status: r.status, paid: r.paid_amount == null ? "" : String(r.paid_amount), confirmed: r.confirmed_items });
  };

  // the same fields in the sheet (editing) and in the add card
  const formFields = (
    <>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
            <label className={LABEL}>
              رقم الجوال
              <input type="tel" inputMode="tel" dir="ltr" placeholder="05xxxxxxxx" value={form.phone} onChange={(e) => set("phone", e.target.value)} className={FIELD} />
            </label>
            <label className={LABEL}>
              تاريخ السفر
              <input type="date" value={form.travelStart} onChange={(e) => set("travelStart", e.target.value)} className={FIELD} />
            </label>
            <label className={LABEL}>
              عدد الأيام
              <input type="number" min={1} max={365} inputMode="numeric" value={form.days} onChange={(e) => set("days", e.target.value)} className={FIELD} />
            </label>
            <label className={LABEL}>
              الوجهة
              <input placeholder="جورجيا" value={form.destination} onChange={(e) => set("destination", e.target.value)} className={FIELD} />
            </label>
            <label className={LABEL}>
              الحالة
              <select value={form.status} onChange={(e) => set("status", e.target.value as ExternalStatus)} className={FIELD}>
                {(Object.keys(EXTERNAL_STATUS) as ExternalStatus[]).map((k) => (
                  <option key={k} value={k}>{EXTERNAL_STATUS[k]}</option>
                ))}
              </select>
            </label>
            <label className={LABEL}>
              المبلغ المدفوع (ريال)
              <input type="number" min={0} inputMode="decimal" value={form.paid} onChange={(e) => set("paid", e.target.value)} className={FIELD} />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[11.5px] font-bold text-[#185045]">ما تم تأكيده:</span>
            {CONFIRMED_ITEMS.map((x) => {
              const on = form.confirmed.includes(x);
              return (
                <button key={x} type="button" aria-pressed={on} onClick={() => set("confirmed", on ? form.confirmed.filter((y) => y !== x) : [...form.confirmed, x])} className={`h-8 rounded-full border px-3 text-[12px] font-bold ${on ? "border-[#2aa87a] bg-[#e8f6ef] text-[#185045]" : "border-[#dbe6e1] bg-white text-[#557d78]"}`}>
                  {x}
                </button>
              );
            })}
          </div>
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={save} disabled={busy !== null} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#2aa87a] px-4 text-[12.5px] font-bold text-white disabled:opacity-50">
              {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : null} {form.id ? "حفظ التعديل" : "إضافة"}
            </button>
            {form.id ? (
              <button type="button" onClick={() => setForm(EMPTY)} className="h-9 rounded-[8px] border border-[#dbe6e1] px-3 text-[12.5px] font-bold text-[#557d78]">إلغاء</button>
            ) : null}
          </div>
    </>
  );

  return (
    <TraveliunShell title="nav.externalTrips">
      <div className="space-y-4">
        {msg ? <div className={`rounded-[10px] px-3 py-2 text-[12.5px] font-bold ${msg.ok ? "bg-[#e8f6ef] text-[#185045]" : "bg-[#fdecef] text-[#a3263f]"}`}>{msg.text}</div> : null}

        {/* «التعديل يفتح في مكانه»: a trip being edited opens in the side sheet — the row stays where it is (the owner, 2026-10-29) */}
        <EditSheet open={form.id !== undefined} onClose={() => setForm(EMPTY)} title="تعديل رحلة">
          {formFields}
        </EditSheet>

        {form.id === undefined ? (
        <section className={CARD}>
          <h2 className="mb-1 text-[14px] font-extrabold text-[#0f3d38]">إضافة عميل مؤكد</h2>
          <p className="mb-3 text-[12px] text-[#557d78]">لعميل أكّد قبل النظام أو خارجه — لا يحتاج عرضاً ولا ملفاً. إذا راسلنا قبل عودته بثلاثة أيام تصل محادثته إليك مباشرة.</p>
          {formFields}
        </section>
        ) : null}

        <section className={CARD}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[14px] font-extrabold text-[#0f3d38]">العملاء المؤكدون خارج النظام ({rows.length})</h2>
            <label className="inline-flex items-center gap-1.5 text-[12px] font-bold text-[#185045]">
              <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> ما أدخلته فقط
            </label>
          </div>
          {rows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-right text-[12.5px]">
                <thead className="text-[11.5px] text-[#557d78]">
                  <tr>
                    <th className="py-1.5 font-bold">الجوال</th>
                    <th className="font-bold">الوجهة</th>
                    <th className="font-bold">السفر</th>
                    <th className="font-bold">الأيام</th>
                    <th className="font-bold">الحالة</th>
                    <th className="font-bold">المدفوع</th>
                    <th className="font-bold">ما تم تأكيده</th>
                    <th className="font-bold">أدخله</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-[#eef3f1] text-[#0f3d38]">
                      <td dir="ltr" className="py-1.5 text-right">{showPhone(r.phone)}</td>
                      <td>{r.destination}</td>
                      <td dir="ltr" className="text-right">{r.travel_start} ← {externalTripEnd(r.travel_start, r.days)}</td>
                      <td>{r.days}</td>
                      <td><span className={`rounded-full px-2 py-0.5 text-[11.5px] font-bold ${STATUS_COLOR[r.status]}`}>{EXTERNAL_STATUS[r.status]}</span></td>
                      <td>{r.paid_amount == null ? "—" : `${r.paid_amount.toLocaleString("en-US")} ريال`}</td>
                      <td className="text-[#335f59]">{r.confirmed_items.join("، ") || "—"}</td>
                      <td>{r.employee_name ?? "—"}</td>
                      <td className="whitespace-nowrap">
                        {canChange(r) ? (
                          <>
                            <button type="button" onClick={() => edit(r)} aria-label="تعديل" className="p-1 text-[#1f7f5c]"><Pencil className="size-4" /></button>
                            <button type="button" onClick={() => remove(r)} disabled={busy === r.id} aria-label="حذف" className="p-1 text-[#a3263f]">{busy === r.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}</button>
                          </>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-[12.5px] text-[#557d78]">لا عملاء بعد — أضف أول عميل من الأعلى.</p>
          )}
        </section>
      </div>
    </TraveliunShell>
  );
}
