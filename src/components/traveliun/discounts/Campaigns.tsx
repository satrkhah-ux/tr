"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ScanLine, TicketPercent } from "lucide-react";
import { countAudience, createCampaign } from "@/lib/data/discounts-actions";
import { AUDIENCE_LABEL, discountLabel, type Audience, type DiscountKind } from "@/lib/discounts/rules";
import type { CampaignRow, Exclusions } from "@/lib/data/discounts";
import { ExclusionPicker } from "./ExclusionPicker";

/** «حملات الكوبونات» — the campaigns and a new one: the discount, its validity and who gets it (discounts.manage). */

export const card = "rounded-2xl border border-tv-border-default bg-tv-surface-raised p-4 shadow-sm sm:p-5";
export const field = "tv-field min-h-10 w-full rounded-lg border border-tv-border-default bg-tv-surface-raised px-3 text-[13px]";
const label = "text-[12.5px] font-bold text-tv-text-muted";
const STATUS: Record<string, string> = { draft: "جاهزة للإرسال", sending: "قيد الإرسال", done: "أُرسلت" };

export function Campaigns({ rows }: { rows: CampaignRow[] }) {
  const router = useRouter();
  const [form, setForm] = useState({
    title: "كوبون العملاء القدامى",
    kind: "amount" as DiscountKind,
    value: "300",
    applies_to: "package" as "package" | "any",
    valid_days: "30",
    audience: "all" as Audience,
    audience_days: "30",
  });
  const [counted, setCounted] = useState<{ key: string; n: number } | null>(null);
  const [exclude, setExclude] = useState<Exclusions>({ booked: true, followups: true, stages: [] });
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const days = form.audience === "older" ? Number(form.audience_days) || null : null;
  const key = `${form.audience}:${days}`;
  const count = counted?.key === key ? counted.n : null;

  useEffect(() => {
    let live = true;
    void countAudience(form.audience, days).then((n) => live && setCounted({ key: `${form.audience}:${days}`, n }));
    return () => {
      live = false;
    };
  }, [form.audience, days]);

  const create = () =>
    start(async () => {
      const r = await createCampaign({
        title: form.title,
        kind: form.kind,
        value: Number(form.value),
        applies_to: form.applies_to,
        valid_days: Number(form.valid_days),
        audience: form.audience,
        audience_days: days,
        exclude,
      });
      if (r.ok) router.push(`/discounts/${r.id}`);
      else setError(r.error);
    });

  return (
    <div dir="rtl" className="tv-fade-up mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-extrabold text-tv-text-strong"><TicketPercent className="size-6" />الخصومات</h1>
        <Link href="/discounts/scan" className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-tv-action-primary px-4 text-[13px] font-extrabold text-tv-action-on-primary">
          <ScanLine className="size-4" />قارئ الكوبونات
        </Link>
      </div>

      <section className={card}>
        <h2 className="mb-3 text-[15px] font-extrabold text-tv-text-strong">حملة جديدة</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={`${label} sm:col-span-2`}>اسم الحملة<input value={form.title} onChange={set("title")} maxLength={120} className={`${field} mt-1`} /></label>
          <fieldset className={label}>
            <legend>نوع الخصم</legend>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {(["amount", "percent"] as const).map((k) => (
                <button key={k} type="button" onClick={() => setForm((f) => ({ ...f, kind: k }))} aria-pressed={form.kind === k}
                  className={`min-h-10 rounded-lg border text-[13px] font-bold ${form.kind === k ? "border-tv-action-primary bg-tv-action-primary text-tv-action-on-primary" : "border-tv-border-default text-tv-text-muted"}`}>
                  {k === "amount" ? "مبلغ (ريال)" : "نسبة (%)"}
                </button>
              ))}
            </div>
          </fieldset>
          <label className={label}>{form.kind === "amount" ? "قيمة الخصم (ريال)" : "نسبة الخصم (%)"}
            <input value={form.value} onChange={set("value")} inputMode="decimal" className={`${field} mt-1`} /></label>
          <label className={label}>يطبّق على
            <select value={form.applies_to} onChange={set("applies_to")} className={`${field} mt-1`}>
              <option value="package">طلب باقة سياحية فقط</option>
              <option value="any">أي طلب</option>
            </select></label>
          <label className={label}>صلاحية الكوبون (أيام من وصوله للعميل)
            <input value={form.valid_days} onChange={set("valid_days")} inputMode="numeric" className={`${field} mt-1`} /></label>
          <label className={label}>من يستلمه
            <select value={form.audience} onChange={set("audience")} className={`${field} mt-1`}>
              {(Object.keys(AUDIENCE_LABEL) as Audience[]).map((a) => <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>)}
            </select></label>
          {form.audience === "older" && (
            <label className={label}>عدد الأيام<input value={form.audience_days} onChange={set("audience_days")} inputMode="numeric" className={`${field} mt-1`} /></label>
          )}
        </div>
        <div className="mt-3"><ExclusionPicker value={exclude} onChange={setExclude} /></div>
        <p className="mt-3 rounded-xl bg-tv-surface-sunken px-3 py-2 text-[13px] font-bold text-tv-text-muted">
          سيُنشأ كوبون خاص باسم ورقم كل عميل (المستثنون يظهرون في القائمة بسبب استثنائهم):{" "}
          <span className="text-tv-text-strong">{count === null ? "…" : count.toLocaleString("en-US")} عميل</span>
          {" "}، خصم {discountLabel(form.kind, Number(form.value) || 0)}، صالح {form.valid_days} يوماً.
          لا يُرسل شيء قبل أن تراجع الحملة وتضغط «أرسل».
        </p>
        {error && <p role="alert" className="mt-2 text-[12.5px] font-bold text-tv-status-danger">{error}</p>}
        <button type="button" onClick={create} disabled={pending || !count}
          className="mt-3 min-h-11 w-full rounded-xl bg-tv-action-primary text-[14px] font-extrabold text-tv-action-on-primary disabled:opacity-50 sm:w-auto sm:px-8">
          {pending ? "يُنشئ الكوبونات…" : "أنشئ الحملة"}
        </button>
      </section>

      <section className={card}>
        <h2 className="mb-3 text-[15px] font-extrabold text-tv-text-strong">الحملات</h2>
        {rows.length === 0 ? (
          <p className="text-[13px] text-tv-text-faint">لا توجد حملات بعد.</p>
        ) : (
          <ul className="divide-y divide-tv-border-default">
            {rows.map((c) => (
              <li key={c.id}>
                <Link href={`/discounts/${c.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:bg-tv-surface-sunken">
                  <span>
                    <span className="block text-[14px] font-extrabold text-tv-text-strong">{c.title}</span>
                    <span className="text-[12px] font-semibold text-tv-text-faint">
                      خصم {discountLabel(c.kind, c.value)} · {c.valid_days} يوماً · {STATUS[c.status] ?? c.status}
                    </span>
                  </span>
                  <span className="flex gap-3 text-[12px] font-bold text-tv-text-muted">
                    <span>الكوبونات {c.total}</span><span>أُرسل {c.sent}</span><span>فُتح {c.opened}</span>
                    <span className="text-tv-text-brand">استُخدم {c.redeemed}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
