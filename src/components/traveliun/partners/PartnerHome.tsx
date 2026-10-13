"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FilePlus2, Loader2, Wallet, Globe2, FileText, PackageCheck, CheckCircle2, Link2, Copy } from "lucide-react";
import { DirText } from "@/components/DirText";
import { TraveliunShell } from "../TraveliunShell";
import { createPartnerFile } from "@/lib/partners/drafts";
import { draftHref } from "@/lib/offer/draft-types";
import { WelcomeBoardButton } from "../WelcomeBoardButton";
import type { PartnerAwaiting, PartnerHomeData, PartnerRequest } from "@/lib/partners/home";
import type { PartnerStatement } from "@/lib/partners/ledger";
import { StatementView } from "./StatementView";
import { confirmPartnerOffer } from "@/lib/data/operations";
import { partnerClientLink } from "@/lib/data/operation-hub";
import { DOCUMENT_LABEL } from "@/lib/operations/voucher-dto";
import { useSafeTransition } from "../useSafeTransition";
import { renewPartnerOffer } from "@/lib/partners/renew";
import type { PartnerSession } from "@/lib/partners/session";

/**
 * The partner's home: their numbers, not ours.
 *
 * Inside the normal shell, because a partner IS a user of this system — they
 * just have a different menu and a different mark in the corner. A second
 * chrome would be a second set of bugs.
 */

const CLIENT_STATUS: Record<string, string> = {
  awaiting_reply: "بانتظار ردّ العميل",
  confirmed: "مؤكَّد",
  paid_partial: "مدفوع جزئياً",
  paid_full: "مدفوع بالكامل",
  completed: "منتهٍ",
  cancelled: "ملغى",
};

const EXECUTION_STATUS: Record<string, string> = {
  pending_bookings: "بانتظار الحجز",
  flights_booked: "حُجز الطيران",
  hotels_booked: "حُجزت الفنادق",
  transfers_booked: "حُجز النقل",
  vouchers_issued: "صدرت الفواوتشرات",
  ready_to_travel: "جاهز للسفر",
  travelled: "سافر",
  cancelled: "ملغى",
};

const PAYMENT_KIND: Record<string, string> = {
  deposit: "عربون",
  installment: "دفعة",
  final: "دفعة أخيرة",
  refund: "استرداد",
};

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof FileText;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-[14px] border border-[#e2ebe7] bg-white p-4 dark:border-[#22443b] dark:bg-[#12241f]">
      <div className="flex items-center gap-2 text-[12px] font-bold text-[#78948f]">
        <Icon className="size-4 text-[var(--tv-brand)]" />
        {label}
      </div>
      <div className="tv-tnum mt-2 text-2xl font-extrabold text-[var(--tv-brand)]">
        <DirText dir="ltr">{value}</DirText>
      </div>
      {hint ? <div className="mt-0.5 text-[11px] font-semibold text-[#93aaa3]">{hint}</div> : null}
    </div>
  );
}

export function PartnerHome({
  partnerName,
  terms,
  data,
  statement,
  tier,
}: {
  partnerName: string;
  terms: string;
  data: PartnerHomeData;
  statement: PartnerStatement | null;
  tier: PartnerSession["tier"];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  return (
    <TraveliunShell title="nav.dashboard">
      <div className="space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-extrabold text-[var(--tv-brand)]">{partnerName}</h1>
            <p className="mt-1 text-[12.5px] font-semibold text-[#557d78]">شروط التعامل: {terms}</p>
            {tier.next ? (
              <p className="mt-0.5 text-[12px] font-bold text-[#0f7a52]">
                أكّدتم هذا الربع {tier.confirmed} — باقٍ لكم {tier.next.needed} لتصبح نسبتكم {tier.next.pct}%.
              </p>
            ) : null}
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const res = await createPartnerFile();
                if (res.ok) router.push(draftHref(res.id));
                else setError("تعذّر إنشاء الملف. حاول مرة أخرى.");
              })
            }
            className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-[var(--tv-brand)] px-5 text-[13px] font-bold text-white hover:opacity-90 disabled:opacity-60"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <FilePlus2 className="size-4" />}
            إصدار بكج جديد
          </button>
        </header>
        {error ? <p className="text-[12.5px] font-bold text-[#c22850]">{error}</p> : null}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat icon={FileText} label="عدد الطلبات" value={String(data.files)} hint="ملفات بدأتموها" />
          <Stat icon={PackageCheck} label="عدد البكجات" value={String(data.issued)} hint="صدرت فعلياً" />
          <Stat icon={Globe2} label="الدول المستهدفة" value={String(data.destinations.length)} />
          <Stat
            icon={Wallet}
            label="الرصيد المسجَّل"
            value={
              data.balances.length > 0
                ? data.balances.map((b) => `${money(b.net)} ${b.currency}`).join(" · ")
                : "—"
            }
            hint="المدفوع ناقص المسترد"
          />
        </section>

        {data.awaiting.length > 0 ? (
          <section className="rounded-[14px] border border-[#e2ebe7] bg-white p-4 dark:border-[#22443b] dark:bg-[#12241f]">
            <h2 className="text-[14px] font-extrabold text-[var(--tv-brand)]">بانتظار تأكيد العميل</h2>
            <p className="mb-3 mt-0.5 text-[12px] font-semibold text-[#78948f]">
              حين يوافق عميلكم سجّلوا ذلك هنا — يصل الطلب لقسم العمليات عندنا فوراً ويبدأ الحجز.
            </p>
            <ul className="space-y-1.5">
              {data.awaiting.map((a) => (
                <AwaitingRow key={a.serial} item={a} />
              ))}
            </ul>
          </section>
        ) : null}

        {data.reports.length > 0 ? <MonthlyReports reports={data.reports} /> : null}

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-[14px] border border-[#e2ebe7] bg-white p-4 dark:border-[#22443b] dark:bg-[#12241f]">
            <h2 className="mb-3 text-[14px] font-extrabold text-[var(--tv-brand)]">
              الدول المستهدفة ومرات استخدامها
            </h2>
            {data.destinations.length === 0 ? (
              <p className="rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-6 text-center text-[12.5px] font-semibold text-[#93aaa3]">
                لا وجهات بعد — تظهر هنا تلقائياً مع أول بكج.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {data.destinations.map((d) => (
                  <li
                    key={d.name}
                    className="flex items-center justify-between rounded-[10px] bg-[#f4f8f6] px-3 py-2 dark:bg-[#17302a]"
                  >
                    <span className="text-[13px] font-bold text-[#0f3d38] dark:text-[#d6e5df]">{d.name}</span>
                    <span className="tv-tnum rounded-full bg-white px-2.5 py-0.5 text-[11.5px] font-extrabold text-[var(--tv-brand)] dark:bg-[#0f231e]">
                      <DirText dir="ltr">{d.count}</DirText> مرة
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-[14px] border border-[#e2ebe7] bg-white p-4 dark:border-[#22443b] dark:bg-[#12241f]">
            <h2 className="mb-3 text-[14px] font-extrabold text-[var(--tv-brand)]">الطلبات قيد التنفيذ</h2>
            {data.requests.length === 0 ? (
              <p className="rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-6 text-center text-[12.5px] font-semibold text-[#93aaa3]">
                لا طلبات مؤكَّدة بعد. يظهر الطلب هنا حين يوافق العميل ويبدأ التنفيذ.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {data.requests.map((r, i) => (
                  <li
                    key={`${r.serial ?? "x"}-${i}`}
                    className="rounded-[10px] border border-[#e9f0ed] p-2.5 dark:border-[#22443b]"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="tv-tnum text-[12.5px] font-extrabold text-[#0f3d38] dark:text-[#d6e5df]">
                        <DirText dir="ltr">{r.serial ?? "—"}</DirText>
                      </span>
                      <span className="rounded-full bg-[#e9f7f0] px-2 py-0.5 text-[11px] font-bold text-[#0f7a52]">
                        {CLIENT_STATUS[r.client_status] ?? r.client_status}
                      </span>
                      <span className="rounded-full bg-[#eef4f1] px-2 py-0.5 text-[11px] font-bold text-[#557d78]">
                        {EXECUTION_STATUS[r.execution_status] ?? r.execution_status}
                      </span>
                      {r.travel_start ? (
                        <span className="tv-tnum text-[11px] font-bold text-[#93aaa3]">
                          <DirText dir="ltr">{r.travel_start}</DirText>
                        </span>
                      ) : null}
                      {/* Their guest, their sign — their logo on it. */}
                      {r.serial ? (
                        <span className="ms-auto">
                          <WelcomeBoardButton serial={r.serial} />
                        </span>
                      ) : null}
                    </div>
                    <RequestDocuments request={r} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {statement ? <StatementView statement={statement} title="كشف حسابكم معنا" /> : null}

        <section className="rounded-[14px] border border-[#e2ebe7] bg-white p-4 dark:border-[#22443b] dark:bg-[#12241f]">
          <h2 className="mb-3 text-[14px] font-extrabold text-[var(--tv-brand)]">سجل الحسابات المالية</h2>
          {data.ledger.length === 0 ? (
            <p className="rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-6 text-center text-[12.5px] font-semibold text-[#93aaa3]">
              لا حركات مالية مسجَّلة بعد.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-right">
                <thead>
                  <tr className="text-[11.5px] font-bold text-[#93aaa3]">
                    <th className="pb-2 font-bold">التاريخ</th>
                    <th className="pb-2 font-bold">البكج</th>
                    <th className="pb-2 font-bold">النوع</th>
                    <th className="pb-2 font-bold">المبلغ</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ledger.map((e, i) => (
                    <tr key={`${e.serial ?? "x"}-${i}`} className="border-t border-[#eef4f1] dark:border-[#22443b]">
                      <td className="tv-tnum py-2 text-[12.5px] font-semibold text-[#557d78]">
                        <DirText dir="ltr">{e.paid_at}</DirText>
                      </td>
                      <td className="tv-tnum py-2 text-[12.5px] font-bold text-[#0f3d38] dark:text-[#d6e5df]">
                        <DirText dir="ltr">{e.serial ?? "—"}</DirText>
                      </td>
                      <td className="py-2 text-[12.5px] font-semibold text-[#557d78]">
                        {PAYMENT_KIND[e.kind] ?? e.kind}
                      </td>
                      <td
                        className={`tv-tnum py-2 text-[12.5px] font-extrabold ${
                          e.kind === "refund" ? "text-[#c22850]" : "text-[#0f7a52]"
                        }`}
                      >
                        <DirText dir="ltr">
                          {e.kind === "refund" ? "−" : ""}
                          {money(e.amount)} {e.currency}
                        </DirText>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <p className="text-center text-[11px] font-semibold text-[#93aaa3]">
          الحجز الفعلي لدى الفنادق يتم من قسم العمليات — يظهر تقدّمه في «الطلبات قيد التنفيذ» أعلاه.{" "}
          <Link href="/package-generator" className="font-bold text-[var(--tv-brand)] underline">
            بكجاتي
          </Link>
        </p>
      </div>
    </TraveliunShell>
  );
}

/** One issued offer whose client has not answered yet — «العميل أكّد», asked twice so a stray tap does not start bookings. */
function AwaitingRow({ item }: { item: PartnerAwaiting }) {
  const router = useRouter();
  const [pending, run] = useSafeTransition();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = () =>
    run(async () => {
      setError(null);
      const res = await confirmPartnerOffer(item.serial);
      if (res.ok) {
        setAsking(false);
        router.refresh();
      } else {
        setError(
          res.error === "ops.err.notFound"
            ? "لم نجد هذا العرض ضمن عروض شركتكم."
            : res.error === "ops.err.invalidTransition"
              ? "هذا العرض ملغى ولا يمكن تأكيده."
              : res.error === "ops.err.offerExpired"
              ? "انتهت صلاحية أسعار هذا العرض — جدّدوا التسعير ثم أكّدوا."
              : res.error === "ops.err.creditLimit"
                ? "تجاوز الحد الائتماني لشركتكم. سدّدوا المستحق أو تواصلوا معنا لتأكيد هذا الملف."
                : "تعذّر التسجيل. حاول مرة أخرى.",
        );
      }
    });

  return (
    <li className="rounded-[10px] border border-[#e9f0ed] p-2.5 dark:border-[#22443b]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="tv-tnum text-[12.5px] font-extrabold text-[#0f3d38] dark:text-[#d6e5df]">
          <DirText dir="ltr">{item.serial}</DirText>
        </span>
        {item.destination ? <span className="text-[12px] font-bold text-[#557d78]">{item.destination}</span> : null}
        {item.valid_until ? (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${item.expired ? "bg-[#fdeef2] text-[#c22850]" : "bg-[#eef4f1] text-[#557d78]"}`}>
            {item.expired ? (item.renewed ? "منتهٍ — جُدّد" : "انتهت صلاحية الأسعار") : <>صالح حتى <DirText dir="ltr">{item.valid_until}</DirText></>}
          </span>
        ) : null}
        {item.was && item.total != null && item.was.total != null ? (
          <span className="tv-tnum text-[11px] font-bold text-[#93aaa3]">
            كان <DirText dir="ltr">{`${item.was.total.toLocaleString("en-US")} ${item.was.currency ?? ""}`}</DirText> · الآن{" "}
            <DirText dir="ltr">{`${item.total.toLocaleString("en-US")} ${item.currency ?? ""}`}</DirText>
          </span>
        ) : null}
        <span className="tv-tnum text-[11px] font-bold text-[#93aaa3]">
          <DirText dir="ltr">{String(item.travelers)}</DirText> مسافر
          {item.travel_date ? (
            <>
              {" · "}
              <DirText dir="ltr">{item.travel_date}</DirText>
            </>
          ) : null}
        </span>
        <span className="ms-auto flex flex-wrap items-center gap-1.5">
          {/* the client link prints the partner's brand — WhatsApp opens with it typed, the partner picks the contact */}
          <button
            type="button"
            onClick={() => {
              // built at the click: the server render has no origin to put in the link
              const link = `${window.location.origin}/client-offer/${item.serial}`;
              const text = `عرض رحلتكم${item.destination ? ` إلى ${item.destination}` : ""}: ${link}`;
              window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
            }}
            className="inline-flex h-8 items-center rounded-[8px] border border-[#cfe9db] px-3 text-[12px] font-bold text-[#0f7a52] hover:bg-[#f2fbf6]"
          >
            واتساب
          </button>
          {item.expired ? (
            item.renewed ? null : <RenewButton item={item} />
          ) : asking ? (
            <>
              <span className="text-[11.5px] font-bold text-[#557d78]">تأكيد العميل لهذا العرض؟</span>
              <button
                type="button"
                disabled={pending}
                onClick={confirm}
                className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#0f7a52] px-3 text-[12px] font-bold text-white disabled:opacity-60"
              >
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                نعم، أكّد
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setAsking(false)}
                className="inline-flex h-8 items-center rounded-[8px] border border-[#d8e4df] px-3 text-[12px] font-bold text-[#557d78]"
              >
                تراجع
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setAsking(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[var(--tv-brand)] px-3 text-[12px] font-bold text-white hover:opacity-90"
            >
              <CheckCircle2 className="size-3.5" />
              العميل أكّد
            </button>
          )}
        </span>
      </div>
      {error ? <p className="mt-1.5 text-[12px] font-bold text-[#c22850]">{error}</p> : null}
    </li>
  );
}

/** What the partner hands its traveller: the documents issued so far, and the one link that always has the latest. */
function RequestDocuments({ request }: { request: PartnerRequest }) {
  const [pending, run] = useSafeTransition();
  const [token, setToken] = useState(request.client_token);
  const [note, setNote] = useState<string | null>(null);

  const copy = async (path: string) => {
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      setNote("نُسخ الرابط.");
    } catch {
      // no clipboard (an older app view): show it to copy by hand
      setNote(url);
    }
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {request.documents.map((d) => (
        <a
          key={d.kind}
          href={`/voucher/${d.token}/pdf`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-7 items-center gap-1 rounded-[8px] border border-[#d8e4df] px-2.5 text-[11.5px] font-bold text-[#0f3d38] hover:bg-[#f4f8f6] dark:border-[#22443b] dark:text-[#d6e5df]"
        >
          <FileText className="size-3.5" />
          {DOCUMENT_LABEL[d.kind]}
        </a>
      ))}
      {token ? (
        <button
          type="button"
          onClick={() => copy(`/trip/${token}`)}
          className="inline-flex h-7 items-center gap-1 rounded-[8px] bg-[#eef4f1] px-2.5 text-[11.5px] font-bold text-[var(--tv-brand)] dark:bg-[#17302a]"
        >
          <Copy className="size-3.5" />
          نسخ رابط العميل
        </button>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(async () => {
              setNote(null);
              const res = await partnerClientLink(request.operation_id);
              if (res.ok) setToken(res.token);
              else
                setNote(
                  res.error === "ops.err.forbidden"
                    ? "أوقفنا رابط هذا العميل — تواصلوا معنا لرابط جديد."
                    : "تعذّر إنشاء الرابط. حاول مرة أخرى.",
                );
            })
          }
          className="inline-flex h-7 items-center gap-1 rounded-[8px] bg-[#eef4f1] px-2.5 text-[11.5px] font-bold text-[var(--tv-brand)] disabled:opacity-60 dark:bg-[#17302a]"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
          رابط العميل
        </button>
      )}
      {note ? <span className="text-[11.5px] font-semibold text-[#557d78] [overflow-wrap:anywhere]">{note}</span> : null}
    </div>
  );
}

/** «جدّد التسعير»: a copy of the file at today's prices — opened at once so the partner reissues it. */
function RenewButton({ item }: { item: PartnerAwaiting }) {
  const router = useRouter();
  const [pending, run] = useSafeTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          run(async () => {
            setError(null);
            const res = await renewPartnerOffer(item.serial, item.draft_id);
            if (res.ok) router.push(draftHref(res.id));
            else setError(res.message);
          })
        }
        className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[var(--tv-brand)] px-3 text-[12px] font-bold text-white disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
        جدّد التسعير
      </button>
      {error ? <span className="basis-full text-[11.5px] font-bold text-[#c22850]">{error}</span> : null}
    </>
  );
}

/** «تقريركم الشهري»: this month beside the last one. */
function MonthlyReports({ reports }: { reports: PartnerHomeData["reports"] }) {
  return (
    <section className="rounded-[14px] border border-[#e2ebe7] bg-white p-4 dark:border-[#22443b] dark:bg-[#12241f]">
      <h2 className="mb-3 text-[14px] font-extrabold text-[var(--tv-brand)]">تقريركم الشهري</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {reports.map((r, i) => (
          <div key={r.month} className="rounded-[12px] bg-[#f4f8f6] p-3 dark:bg-[#17302a]">
            <div className="mb-2 flex items-center justify-between text-[12px] font-bold text-[#557d78]">
              <span>{i === 0 ? "هذا الشهر" : "الشهر الماضي"}</span>
              <DirText dir="ltr">{r.month}</DirText>
            </div>
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div>
                <dt className="text-[11px] font-bold text-[#93aaa3]">عروض</dt>
                <dd className="tv-tnum text-[18px] font-extrabold text-[var(--tv-brand)]">{r.issued}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-bold text-[#93aaa3]">أكّدها العملاء</dt>
                <dd className="tv-tnum text-[18px] font-extrabold text-[var(--tv-brand)]">{r.confirmed}</dd>
              </div>
              <div>
                <dt className="text-[11px] font-bold text-[#93aaa3]">نسبة التحويل</dt>
                <dd className="tv-tnum text-[18px] font-extrabold text-[var(--tv-brand)]">{r.conversion == null ? "—" : `${r.conversion}%`}</dd>
              </div>
            </dl>
            <p className="mt-2 text-[11.5px] font-semibold text-[#557d78]">
              {r.value.length ? <>قيمة المؤكَّد: <DirText dir="ltr">{r.value.map((v) => `${v.total.toLocaleString("en-US")} ${v.currency}`).join(" · ")}</DirText></> : "لا مؤكَّد بعد"}
              {r.top.length ? ` — الأكثر طلباً: ${r.top.map((t) => `${t.name} (${t.count})`).join("، ")}` : ""}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
