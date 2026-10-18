"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { FileText, KeyRound, LogOut, Printer, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cancelAlmatarBooking } from "@/lib/almatar/actions";
import { cancelFeePct, REQUEST_KINDS, STATUS_LABEL, TERMS, vehicleLabel } from "@/lib/almatar/rules";
import type { AlmatarBooking, AlmatarService, AlmatarSession } from "@/lib/almatar/server";
import { ChangePasswordDialog } from "../ChangePasswordDialog";
import { AlmatarRequestForm } from "./AlmatarRequestForm";

const card = "rounded-2xl border border-[#e7e5ef] bg-white p-5 shadow-[0_1px_2px_rgba(27,26,31,0.04)]";
const sar = (n: number) => `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n)} ر.س`;

const STATUS_TONE: Record<string, string> = {
  pending: "bg-[#fff8e8] text-[#a86a10]",
  confirmed: "bg-[#e8f6ef] text-[#17795a]",
  rejected: "bg-[#fff0f3] text-[#c22850]",
  cancelled: "bg-[#f1f1f4] text-[#747583]",
};

/** «المطار»'s own screen: book a line of its transport list, follow it, carry its voucher. Its identity, not ours. */
export function AlmatarPortal({ session, services, bookings }: { session: AlmatarSession; services: AlmatarService[]; bookings: AlmatarBooking[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<{ ok: boolean; text: string; ref?: string } | null>(null);
  const [changeOpen, setChangeOpen] = useState(false);
  // the page's own clock, read once: a booking past its time offers no cancel
  const [now] = useState(() => Date.now());

  const byId = new Map(services.map((s) => [s.id, s]));

  function cancel(b: AlmatarBooking) {
    const fee = cancelFeePct(new Date(b.service_at), new Date());
    const ask = fee
      ? `الخدمة بعد أقل من 12 ساعة — الإلغاء الآن برسوم 100% (${sar(Number(b.total_sar))}). هل تلغي الحجز ${b.ref}؟`
      : `إلغاء الحجز ${b.ref} دون رسوم؟`;
    if (!window.confirm(ask)) return;
    start(async () => {
      const r = await cancelAlmatarBooking(b.id);
      setNotice({ ok: r.ok, text: r.message ?? "" });
      if (r.ok) router.refresh();
    });
  }

  async function signOut() {
    await createSupabaseBrowserClient().auth.signOut();
    router.replace("/b2b");
    router.refresh();
  }

  return (
    <main className="min-h-dvh bg-[#f7f7f8] pb-12" dir="rtl" style={{ "--am": session.brand_color, "--am2": session.accent_color } as CSSProperties}>
      <header className="border-b border-[#e7e5ef] bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            {session.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={session.logo_url} alt={session.name_latin ?? session.name} className="h-9 w-auto" />
            ) : (
              <span className="text-xl font-extrabold text-[var(--am)]">{session.name}</span>
            )}
            <span className="rounded-full bg-[var(--am)]/10 px-2.5 py-0.5 text-[11.5px] font-bold text-[var(--am)]">حجوزات المواصلات</span>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setChangeOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-[#d9d9de] px-3 text-[12px] font-bold text-[#46455a] hover:bg-[#f7f7f8]">
              <KeyRound className="size-4" /> تغيير كلمة المرور
            </button>
            <button type="button" onClick={signOut} className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-[#d9d9de] px-3 text-[12px] font-bold text-[#46455a] hover:bg-[#f7f7f8]">
              <LogOut className="size-4" /> خروج
            </button>
          </div>
        </div>
      </header>
      <ChangePasswordDialog open={changeOpen} onOpenChange={setChangeOpen} />

      <div className="mx-auto grid max-w-6xl gap-4 px-4 pt-5">
        {notice ? (
          <p className={`${card} flex items-center justify-between text-[13px] font-bold ${notice.ok ? "text-[#17795a]" : "text-[#c22850]"}`}>
            <span className="flex flex-wrap items-center gap-3">
              {notice.text}
              {notice.ref ? <PrintLink requestRef={notice.ref} /> : null}
            </span>
            <button type="button" aria-label="إغلاق" onClick={() => setNotice(null)}>
              <X className="size-4" />
            </button>
          </p>
        ) : null}

        <AlmatarRequestForm
          services={services}
          onDone={(ok, text, ref) => {
            setNotice({ ok, text, ref });
            router.refresh();
          }}
        />

        <section className={card}>
          <h2 className="text-base font-extrabold text-[#1b1a1f]">حجوزاتي</h2>
          {bookings.length === 0 ? (
            <p className="mt-2 text-[12.5px] font-semibold text-[#747583]">لا توجد حجوزات بعد.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="border-b border-[#efeff2] text-start text-[11px] text-[#92939e]">
                    {["الرقم", "الخدمة", "الموعد", "المركبة", "العميل", "المبلغ", "الحالة", ""].map((h) => (
                      <th key={h} className="whitespace-nowrap px-2 py-2 text-start font-bold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bookings.map((b, i) => {
                    // a request's lines sit together: its print button on the first only
                    const firstOfRequest = Boolean(b.request_ref) && bookings[i - 1]?.request_ref !== b.request_ref;
                    const s = byId.get(b.service_id);
                    const open = (b.status === "pending" || b.status === "confirmed") && new Date(b.service_at).getTime() > now;
                    return (
                      <tr key={b.id} className="border-b border-[#f4f4f6] align-top font-semibold text-[#1b1a1f]">
                        <td className="whitespace-nowrap px-2 py-2 font-bold">
                          <span dir="ltr">{b.ref}</span>
                          {b.request_ref ? (
                            <div className="max-w-[150px] whitespace-normal text-[11px] font-semibold text-[#92939e]">
                              <span dir="ltr">{b.request_ref}</span> {firstOfRequest ? <PrintLink requestRef={b.request_ref} /> : null}
                              {b.request_kind ? ` · ${REQUEST_KINDS.find((k) => k.id === b.request_kind)?.label ?? ""}` : ""}
                            </div>
                          ) : null}
                        </td>
                        <td className="min-w-[200px] px-2 py-2">
                          {s ? `${s.name_ar} — ${s.scope_ar}` : b.service_id}
                          <div className="text-[11px] text-[#92939e]">{s?.country_ar}</div>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2" dir="ltr">
                          {b.service_date} {b.service_time.slice(0, 5)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2">
                          {vehicleLabel(b.vehicle)} × {b.units}
                        </td>
                        <td className="min-w-[130px] px-2 py-2">
                          {b.lead_name}
                          <div className="text-[11px] text-[#92939e]">{b.passengers} راكب{b.flight_no ? ` · ${b.flight_no}` : ""}</div>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 tv-tnum">
                          {sar(Number(b.total_sar))}
                          {b.cancel_fee_pct ? <div className="text-[11px] text-[#c22850]">رسوم إلغاء {sar(Number(b.cancel_fee_sar))}</div> : null}
                        </td>
                        <td className="px-2 py-2">
                          <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold ${STATUS_TONE[b.status] ?? ""}`}>{STATUS_LABEL[b.status] ?? b.status}</span>
                          {b.status_note ? <div className="mt-1 text-[11px] text-[#c22850]">{b.status_note}</div> : null}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2">
                          <div className="flex gap-1.5">
                            {b.status === "confirmed" && b.voucher_token ? (
                              <a
                                href={`/b2b/transport-voucher/${b.voucher_token}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex h-8 items-center gap-1 rounded-lg bg-[var(--am)] px-2.5 text-[11.5px] font-bold text-white"
                              >
                                <FileText className="size-3.5" /> الفوتشر
                              </a>
                            ) : null}
                            {open ? (
                              <button type="button" disabled={pending} onClick={() => cancel(b)} className="h-8 rounded-lg border border-[#f3c7d2] px-2.5 text-[11.5px] font-bold text-[#c22850] disabled:opacity-50">
                                إلغاء
                              </button>
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

        <details className={card}>
          <summary className="cursor-pointer text-[13px] font-extrabold text-[#1b1a1f]">الشروط والأحكام</summary>
          <ol className="mt-3 list-decimal space-y-1.5 ps-5 text-[12.5px] font-semibold leading-6 text-[#46455a]">
            {TERMS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ol>
        </details>
      </div>
    </main>
  );
}

/** «طباعة الحجز» — the request as a PDF in Almatar's identity, for its client. */
function PrintLink({ requestRef }: { requestRef: string }) {
  return (
    <a
      href={`/b2b/transport-request/${requestRef}`}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--am)] px-2 text-[11.5px] font-bold text-[var(--am)] hover:bg-[var(--am)]/5"
    >
      <Printer className="size-3.5" /> طباعة الحجز
    </a>
  );
}
