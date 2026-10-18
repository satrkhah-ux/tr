"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Car, Check, FileText, KeyRound, TriangleAlert, X } from "lucide-react";
import { confirmAlmatarBooking, createAlmatarLogin, rejectAlmatarBooking, setAlmatarMargin } from "@/lib/almatar/actions";
import { LOGIN_DOMAIN, passwordProblem, STATUS_LABEL, vehicleLabel } from "@/lib/almatar/rules";
import type { AlmatarService, AlmatarStaffBooking } from "@/lib/almatar/server";
import { TraveliunShell } from "../TraveliunShell";
import { card, danger, field, primary, sar, secondary, Stat, td, th } from "../commissions/ui";

const STATUS_TONE: Record<string, string> = {
  pending: "bg-[#fff8e8] text-[#a86a10]",
  confirmed: "bg-[#e8f6ef] text-[#17795a]",
  rejected: "bg-[#fff0f3] text-[#c22850]",
  cancelled: "bg-[#f1f5f3] text-[#557d78]",
};

/** «حجوزات المطار» — Almatar's transport bookings to confirm, its price list, our margin inside it, and its login. */
export function AlmatarAdmin({
  services,
  bookings,
  margin,
  logins,
  canConfirm,
  canAdmin,
  hasCompany,
}: {
  services: AlmatarService[];
  bookings: AlmatarStaffBooking[];
  margin: number;
  logins: { email: string; status: string; created_at: string }[];
  canConfirm: boolean;
  canAdmin: boolean;
  hasCompany: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  // the login form answers under its own button — the page notice sits a screen above it
  const [loginMsg, setLoginMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const byId = new Map(services.map((s) => [s.id, s]));
  const live = bookings.filter((b) => b.status === "confirmed");
  const run = (job: () => Promise<{ ok: boolean; message?: string }>, done = "تم.") =>
    start(async () => {
      const r = await job();
      setNotice({ ok: r.ok, text: r.message ?? done });
      if (r.ok) router.refresh();
    });

  function confirm(b: AlmatarStaffBooking) {
    const driver = window.prompt(`تأكيد ${b.ref} — بيانات السائق والمركبة كما تُطبع على الفوتشر (اختياري):`, "");
    if (driver === null) return;
    run(() => confirmAlmatarBooking(b.id, driver), `أُكّد ${b.ref} — الفوتشر متاح للمطار الآن.`);
  }
  function reject(b: AlmatarStaffBooking) {
    const note = window.prompt(`سبب رفض ${b.ref} (يظهر للمطار):`, "");
    if (!note) return;
    run(() => rejectAlmatarBooking(b.id, note), `رُفض ${b.ref}.`);
  }
  function saveMargin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const pct = Number(new FormData(e.currentTarget).get("margin"));
    run(() => setAlmatarMargin(pct), "حُفظ الهامش — يسري على الحجوزات الجديدة.");
  }
  function makeLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const username = String(f.get("username") ?? "").trim();
    const password = String(f.get("password") ?? "");
    const problem = !username
      ? "اكتب اسم المستخدم."
      : password !== String(f.get("confirm") ?? "")
        ? "كلمتا المرور غير متطابقتين."
        : passwordProblem(password, username);
    if (problem) {
      setLoginMsg({ ok: false, text: problem });
      return;
    }
    const form = e.currentTarget;
    setLoginMsg(null);
    start(async () => {
      try {
        const r = await createAlmatarLogin({ username, password });
        setLoginMsg({ ok: r.ok, text: r.message ?? "" });
        if (r.ok) {
          form.reset();
          router.refresh();
        }
      } catch {
        setLoginMsg({ ok: false, text: "تعذّر الاتصال بالخادم — حدّث الصفحة وأعد المحاولة." });
      }
    });
  }

  return (
    <TraveliunShell title="nav.almatar">
      <div className="tv-fade-up space-y-4">
        <section className={card}>
          <h1 className="flex items-center gap-2 text-lg font-extrabold text-[#003c3a]">
            <Car className="size-5" /> حجوزات المطار
          </h1>
          <p className="mt-1 max-w-3xl text-[12px] font-semibold leading-6 text-[#93aaa3]">
            شريك مواصلات فقط في تايلاند وماليزيا وإندونيسيا، بلائحة أسعار 15 أكتوبر 2026 السارية حتى ديسمبر 2027. أسعاره وحجوزاته في جداول خاصة به لا تختلط ببيانات ترافليون. الفوتشر يصدر بهوية المطار.
          </p>
          {!hasCompany ? <p className="mt-2 text-[12.5px] font-bold text-[#c22850]">شركة المطار غير موجودة بعد — تُنشأ مع المهاجرة 0100.</p> : null}
        </section>

        {notice ? (
          <p className={`${card} flex items-center justify-between text-[12.5px] font-bold ${notice.ok ? "text-[#17795a]" : "text-[#c22850]"}`}>
            {notice.text}
            <button type="button" aria-label="إغلاق" onClick={() => setNotice(null)}>
              <X className="size-4" />
            </button>
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="بانتظار التأكيد" value={String(bookings.filter((b) => b.status === "pending").length)} tone="text-[#a86a10]" />
          <Stat label="مؤكدة" value={String(live.length)} />
          <Stat label="مبيعات المؤكد" value={sar(live.reduce((n, b) => n + Number(b.total_sar), 0))} />
          <Stat label="ربحنا التقديري" value={sar(live.reduce((n, b) => n + Number(b.profit_sar), 0))} tone="text-[#17795a]" hint={`بهامش ${margin}% داخل السعر`} />
        </div>

        <section className={card}>
          <h2 className="text-base font-extrabold text-[#003c3a]">الحجوزات</h2>
          {bookings.length === 0 ? (
            <p className="mt-2 text-[12px] font-semibold text-[#93aaa3]">لا توجد حجوزات بعد.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-[#e2ebe7]">
                    {["الرقم", "الخدمة", "الموعد (محلي)", "المركبة", "المسافر", "الرحلة / المكان", "المبلغ", "ربحنا", "الحالة", ""].map((h) => (
                      <th key={h} className={th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b) => {
                    const s = byId.get(b.service_id);
                    return (
                      <tr key={b.id} className="border-b border-[#f1f5f3] align-top">
                        <td className={td} dir="ltr">
                          {b.ref}
                        </td>
                        <td className={`${td} whitespace-normal`}>
                          {s ? `${s.name_ar} — ${s.scope_ar}` : b.service_id}
                          <div className="text-[11px] text-[#93aaa3]">{s?.country_ar}</div>
                        </td>
                        <td className={td} dir="ltr">
                          {b.service_date} {b.service_time.slice(0, 5)}
                        </td>
                        <td className={td}>
                          {vehicleLabel(b.vehicle)} × {b.units}
                        </td>
                        <td className={`${td} whitespace-normal`}>
                          {b.lead_name}
                          <div className="text-[11px] text-[#93aaa3]" dir="ltr">
                            {b.passengers} pax {b.lead_phone ?? ""}
                          </div>
                        </td>
                        <td className={`${td} whitespace-normal`}>
                          {b.flight_no ? <div dir="ltr">{b.flight_no}</div> : null}
                          <div className="text-[11px] text-[#557d78]">{[b.pickup, b.dropoff].filter(Boolean).join(" ← ")}</div>
                          {b.notes ? <div className="text-[11px] text-[#93aaa3]">{b.notes}</div> : null}
                        </td>
                        <td className={td}>
                          {sar(Number(b.total_sar))}
                          {b.cancel_fee_pct ? <div className="text-[11px] text-[#c22850]">رسوم إلغاء {sar(Number(b.cancel_fee_sar))}</div> : null}
                        </td>
                        <td className={`${td} text-[#17795a]`}>{b.status === "confirmed" ? sar(Number(b.profit_sar)) : "—"}</td>
                        <td className={td}>
                          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${STATUS_TONE[b.status] ?? ""}`}>{STATUS_LABEL[b.status] ?? b.status}</span>
                          {b.driver_info || b.status_note ? <div className="mt-1 max-w-[180px] whitespace-normal text-[11px] text-[#557d78]">{b.driver_info ?? b.status_note}</div> : null}
                        </td>
                        <td className={td}>
                          <div className="flex gap-1.5">
                            {b.status === "pending" && canConfirm ? (
                              <>
                                <button type="button" disabled={pending} onClick={() => confirm(b)} className={`${primary} h-8 gap-1 px-2.5 text-[11.5px]`}>
                                  <Check className="size-3.5" /> تأكيد
                                </button>
                                <button type="button" disabled={pending} onClick={() => reject(b)} className={`${danger} h-8 px-2.5 text-[11.5px]`}>
                                  رفض
                                </button>
                              </>
                            ) : null}
                            {b.status === "confirmed" && b.voucher_token ? (
                              <a href={`/b2b/transport-voucher/${b.voucher_token}`} target="_blank" rel="noreferrer" className={`${secondary} h-8 gap-1 px-2.5 text-[11.5px]`}>
                                <FileText className="size-3.5" /> الفوتشر
                              </a>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={card}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-extrabold text-[#003c3a]">لائحة الأسعار ({services.length} خدمة)</h2>
              <p className="mt-1 text-[12px] font-semibold text-[#93aaa3]">ما تدفعه المطار بالريال، صافٍ وربحنا داخله. ربحنا التقديري = السعر × الهامش.</p>
            </div>
            {canAdmin ? (
              <form onSubmit={saveMargin} className="flex items-end gap-2">
                <label className="grid gap-1 text-[11.5px] font-bold text-[#557d78]">
                  هامش ربحنا داخل السعر %
                  <input name="margin" type="number" min={0} max={99} step="0.5" defaultValue={margin} dir="ltr" className={`${field} w-28`} />
                </label>
                <button type="submit" disabled={pending} className={secondary}>
                  حفظ
                </button>
              </form>
            ) : (
              <span className="text-[12px] font-bold text-[#557d78]">الهامش: {margin}%</span>
            )}
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-[#e2ebe7]">
                  {["الرمز", "الدولة", "الخدمة", "النطاق", "صغيرة", "متوسطة", "فان 10 مقاعد"].map((h) => (
                    <th key={h} className={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s.id} className={`border-b border-[#f1f5f3] ${s.review_note ? "bg-[#fff8e8]" : ""}`}>
                    <td className={td} dir="ltr">
                      {s.id}
                    </td>
                    <td className={td}>{s.country_ar}</td>
                    <td className={`${td} whitespace-normal`}>{s.name_ar}</td>
                    <td className={`${td} whitespace-normal`}>
                      {s.scope_ar}
                      {s.review_note ? (
                        <div className="mt-1 flex items-start gap-1 text-[11px] text-[#a86a10]">
                          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {s.review_note}
                        </div>
                      ) : null}
                    </td>
                    <td className={td}>{sar(Number(s.price_small))}</td>
                    <td className={td}>{sar(Number(s.price_medium))}</td>
                    <td className={td}>{sar(Number(s.price_van10))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {canAdmin ? (
          <section className={card}>
            <h2 className="flex items-center gap-2 text-base font-extrabold text-[#003c3a]">
              <KeyRound className="size-4" /> حساب دخول المطار
            </h2>
            <p className="mt-1 max-w-3xl text-[12px] font-semibold leading-6 text-[#93aaa3]">
              يدخل المطار من بوابة الشركات (/b2b) باسم المستخدم. اكتب كلمة مرور مؤقتة بيدك — لا تُحفظ ولا تُسجَّل هنا — وسيُلزم الحساب بتغييرها عند أول دخول، ويستطيع تغييرها بعد ذلك من شاشته. 10 أحرف على الأقل، حروف وأرقام، ولا تحتوي اسم المستخدم.
            </p>
            {logins.length ? (
              <ul className="mt-3 space-y-1 text-[12.5px] font-bold text-[#185045]">
                {logins.map((l) => (
                  <li key={l.email} dir="ltr" className="text-start">
                    {l.email.endsWith(`@${LOGIN_DOMAIN}`) ? l.email.split("@")[0] : l.email} — {l.status}
                  </li>
                ))}
              </ul>
            ) : null}
            <form onSubmit={makeLogin} noValidate className="mt-3 grid gap-3 sm:grid-cols-4">
              <label className="grid gap-1 text-[11.5px] font-bold text-[#557d78]">
                اسم المستخدم
                <input name="username" defaultValue="almatar" required dir="ltr" autoComplete="off" className={field} />
              </label>
              <label className="grid gap-1 text-[11.5px] font-bold text-[#557d78]">
                كلمة مرور مؤقتة
                <input name="password" type="password" dir="ltr" autoComplete="new-password" className={field} />
              </label>
              <label className="grid gap-1 text-[11.5px] font-bold text-[#557d78]">
                تأكيدها
                <input name="confirm" type="password" dir="ltr" autoComplete="new-password" className={field} />
              </label>
              <div className="grid content-end">
                <button type="submit" disabled={pending || !hasCompany} className={primary}>
                  {pending ? "جارٍ الإنشاء…" : "أنشئ الحساب"}
                </button>
              </div>
            </form>
            {!hasCompany ? <p className="mt-2 text-[12.5px] font-bold text-[#c22850]">شركة المطار غير موجودة — لا يمكن إنشاء الحساب.</p> : null}
            {loginMsg ? (
              <p role="status" className={`mt-3 rounded-[10px] px-3 py-2 text-[13px] font-bold ${loginMsg.ok ? "bg-[#e8f6ef] text-[#17795a]" : "bg-[#fff0f3] text-[#c22850]"}`}>
                {loginMsg.text}
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    </TraveliunShell>
  );
}
