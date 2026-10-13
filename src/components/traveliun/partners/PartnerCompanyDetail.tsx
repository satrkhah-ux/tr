"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Ban, CheckCircle2, Loader2 } from "lucide-react";
import { DirText } from "@/components/DirText";
import type { TranslationKey } from "@/lib/i18n";
import { setPartnerSuspended, type PartnerCompanyDetail } from "@/lib/data/partner-companies";
import { describeTerms } from "@/lib/partners/pricing";
import { TraveliunShell } from "../TraveliunShell";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { useSafeTransition } from "../useSafeTransition";
import { IssueAccount } from "./PendingRegistrations";
import type { PartnerStatement } from "@/lib/partners/ledger";
import { StatementView, LedgerControls } from "./StatementView";
import { TiersEditor } from "./TiersEditor";
import type { Tier } from "@/lib/partners/tiers";

/**
 * One partner company, from our side: who logs in for it, what it has started
 * and issued, which of its clients confirmed, what that is worth and what has
 * been paid, and what we changed about it. Suspending shuts its portal at once;
 * its files and history stay.
 */

const card = "rounded-[14px] border border-[#e2ebe7] bg-white p-4 dark:border-[#22443b] dark:bg-[#12241f]";
const STATUS_LABEL: Record<string, string> = {
  approved: "معتمدة",
  suspended: "موقوفة",
  pending: "بانتظار القرار",
  rejected: "مرفوضة",
};
const OFFER_STATUS: Record<string, string> = { sent: "مُرسل", confirmed: "مؤكّد", cancelled: "ملغى", draft: "مسودة" };
const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export function PartnerCompanyDetailView({ detail, statement, tiers }: { detail: PartnerCompanyDetail; statement: PartnerStatement | null; tiers: Tier[] }) {
  const { t } = useTraveliunUI();
  const { company } = detail;
  const confirmed = detail.offers.filter((o) => o.client_status).length;

  return (
    <TraveliunShell title="nav.partnerCompanies">
      <div className="space-y-4">
        <Link href="/partner-companies" className="inline-flex items-center gap-1 text-[12.5px] font-bold text-[#557d78] hover:underline">
          <ArrowRight className="size-4" />
          {t("nav.partnerCompanies")}
        </Link>

        <section className={card}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-lg font-extrabold text-[#003c3a] dark:text-[#eaf3ef]">{company.name}</h1>
              <p className="mt-1 text-[12px] font-semibold text-[#93aaa3]">
                {[company.name_latin, company.phone, company.email, company.website].filter(Boolean).join(" · ") || "—"}
              </p>
              <p className="mt-1 text-[12px] font-bold text-[#557d78]">
                الشروط:{" "}
                {describeTerms({ kind: company.price_adjust_kind === "commission" ? "commission" : "markup", pct: Number(company.price_adjust_pct) || 0 })}
              </p>
            </div>
            <span
              className={`rounded-full px-3 py-1 text-[12px] font-bold ${
                company.status === "approved" ? "bg-[#e9f7f0] text-[#0f7a52]" : "bg-[#fdeef2] text-[#c22850]"
              }`}
            >
              {STATUS_LABEL[company.status] ?? company.status}
            </span>
          </div>
          {company.status === "approved" || company.status === "suspended" ? <SuspendControl id={company.id} suspended={company.status === "suspended"} /> : null}
          <IssueAccount company={company} />
        </section>

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Tile label="ملفات بدأتها" value={String(detail.files)} />
          <Tile label="عروض أُصدرت" value={String(detail.offers.length)} />
          <Tile label="أكّدها العميل" value={String(confirmed)} />
          <Tile label="قيمة المؤكَّد" value={detail.sales.map((s) => `${money(s.total)} ${s.currency}`).join(" · ") || "—"} />
          <Tile label="المسدَّد" value={detail.paid.map((p) => `${money(p.net)} ${p.currency}`).join(" · ") || "—"} />
        </section>

        {statement ? (
          <>
            <StatementView statement={statement} title="الحساب" />
            <LedgerControls partnerId={company.id} limit={statement.limit} />
          </>
        ) : null}

        <TiersEditor
          partnerId={company.id}
          initial={tiers}
          title="سلّم العمولة لهذه الشركة"
          hint="بعد عدد من الملفات المؤكدة في الربع تتغيّر نسبتها. بلا درجات هنا يُطبَّق السلّم العام (في صفحة الشركات)."
        />

        <section className={card}>
          <h2 className="mb-3 text-[14px] font-extrabold text-[#003c3a] dark:text-[#eaf3ef]">العروض</h2>
          {detail.offers.length === 0 ? (
            <p className="text-[12.5px] font-semibold text-[#93aaa3]">لم تُصدر عرضاً بعد.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-right text-[12.5px]">
                <thead>
                  <tr className="text-[11.5px] font-bold text-[#93aaa3]">
                    <th className="pb-2">العرض</th>
                    <th className="pb-2">الوجهة</th>
                    <th className="pb-2">القيمة</th>
                    <th className="pb-2">الحالة</th>
                    <th className="pb-2">التنفيذ</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.offers.map((o) => (
                    <tr key={o.serial} className="border-t border-[#eef4f1] dark:border-[#22443b]">
                      <td className="tv-tnum py-2 font-bold">
                        <DirText dir="ltr">{o.serial}</DirText>
                      </td>
                      <td className="py-2 font-semibold text-[#557d78]">{o.destination ?? "—"}</td>
                      <td className="tv-tnum py-2 font-semibold">
                        <DirText dir="ltr">{o.total != null ? `${money(o.total)} ${o.currency ?? ""}` : "—"}</DirText>
                      </td>
                      <td className="py-2 font-semibold">
                        {o.client_status ? t(`ops.client.${o.client_status}` as TranslationKey) : (OFFER_STATUS[o.status ?? ""] ?? o.status ?? "—")}
                      </td>
                      <td className="py-2 font-semibold text-[#557d78]">
                        {o.execution_status ? t(`ops.exec.${o.execution_status}` as TranslationKey) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className={card}>
            <h2 className="mb-3 text-[14px] font-extrabold text-[#003c3a] dark:text-[#eaf3ef]">حسابات الدخول</h2>
            {detail.users.length === 0 ? (
              <p className="text-[12.5px] font-semibold text-[#93aaa3]">لم يُصدر لها حساب بعد.</p>
            ) : (
              <ul className="space-y-1.5">
                {detail.users.map((u) => (
                  <li key={u.email} className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-[#f4f8f6] px-3 py-2 text-[12.5px] dark:bg-[#17302a]">
                    <span className="font-bold">
                      {u.name ? `${u.name} · ` : ""}
                      <DirText dir="ltr">{u.email}</DirText>
                    </span>
                    <span className="text-[11.5px] font-bold text-[#557d78]">{u.status === "active" ? "فعّال" : "موقوف"}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={card}>
            <h2 className="mb-3 text-[14px] font-extrabold text-[#003c3a] dark:text-[#eaf3ef]">سجل التغييرات</h2>
            {detail.activity.length === 0 ? (
              <p className="text-[12.5px] font-semibold text-[#93aaa3]">لا تغييرات مسجّلة.</p>
            ) : (
              <ul className="space-y-1.5 text-[12px]">
                {detail.activity.map((a, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eef4f1] pb-1.5 dark:border-[#22443b]">
                    <span className="font-semibold">{describeActivity(a)}</span>
                    <span className="tv-tnum text-[11px] font-bold text-[#93aaa3]">
                      <DirText dir="ltr">{`${a.created_at.slice(0, 16).replace("T", " ")}${a.actor_email ? ` · ${a.actor_email}` : ""}`}</DirText>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </TraveliunShell>
  );
}

function describeActivity(a: PartnerCompanyDetail["activity"][number]): string {
  const meta = a.meta ?? {};
  if (meta["suspended"] === true) return `أوقفت${meta["reason"] ? ` — ${String(meta["reason"])}` : ""}`;
  if (meta["suspended"] === false) return `أُعيد تفعيلها${meta["reason"] ? ` — ${String(meta["reason"])}` : ""}`;
  if (meta["deactivated"] === true) return "أُلغي تفعيلها";
  if (meta["payment"] === true) return `سُجّلت دفعة ${String(meta["amount"] ?? "")} ${String(meta["currency"] ?? "")} — ${String(meta["receipt"] ?? "")}`;
  if ("credit_limit" in meta) return meta["credit_limit"] == null ? "أُلغي الحد الائتماني" : `الحد الائتماني ${String(meta["credit_limit"])} ${String(meta["credit_currency"] ?? "")}`;
  if (a.action === "partner.updated") return "عُدّلت بياناتها";
  return a.action;
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className={card}>
      <div className="text-[11.5px] font-bold text-[#78948f]">{label}</div>
      <div className="tv-tnum mt-1.5 text-[17px] font-extrabold text-[#185045] dark:text-[#7fd0b2] [overflow-wrap:anywhere]">
        <DirText dir="ltr">{value}</DirText>
      </div>
    </div>
  );
}

/** «إيقاف» shuts the portal now; «إعادة التفعيل» opens it again. The reason is kept in the log. */
function SuspendControl({ id, suspended }: { id: string; suspended: boolean }) {
  const router = useRouter();
  const [pending, run] = useSafeTransition();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!asking) {
    return (
      <button
        type="button"
        onClick={() => setAsking(true)}
        className={`mt-3 inline-flex h-9 items-center gap-1.5 rounded-[9px] border px-3 text-[12px] font-bold ${
          suspended ? "border-[#b7d0c7] text-[#185045]" : "border-[#f0c7c7] text-[#c22850]"
        }`}
      >
        {suspended ? <CheckCircle2 className="size-4" /> : <Ban className="size-4" />}
        {suspended ? "إعادة التفعيل" : "إيقاف الشركة"}
      </button>
    );
  }
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 rounded-[10px] border border-[#e2ebe7] bg-[#f8fbf9] p-2.5 dark:border-[#22443b] dark:bg-[#17302a]">
      <label className="grid min-w-[200px] flex-1 gap-1 text-[11.5px] font-bold text-[#185045]">
        {suspended ? "سبب إعادة التفعيل (اختياري)" : "سبب الإيقاف"}
        <input
          id={`suspend-reason-${id}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="h-9 rounded-[8px] border border-[#dbe6e1] bg-white px-2.5 text-[12.5px] font-semibold dark:border-[#294039] dark:bg-[#0f1f1b]"
        />
      </label>
      <button
        type="button"
        disabled={pending || (!suspended && !reason.trim())}
        onClick={() =>
          run(async () => {
            setError(null);
            const res = await setPartnerSuspended(id, !suspended, reason);
            if (res.ok) {
              setAsking(false);
              setReason("");
              router.refresh();
            } else setError("تعذّر الحفظ. حاول مرة أخرى.");
          })
        }
        className={`inline-flex h-9 items-center gap-1.5 rounded-[9px] px-3 text-[12px] font-bold text-white disabled:opacity-60 ${
          suspended ? "bg-[#185045]" : "bg-[#c22850]"
        }`}
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : null}
        {suspended ? "أعِد التفعيل" : "أوقف الآن"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => setAsking(false)}
        className="inline-flex h-9 items-center rounded-[9px] border border-[#dbe6e1] px-3 text-[12px] font-bold text-[#557d78]"
      >
        تراجع
      </button>
      {error ? <p className="basis-full text-[11.5px] font-bold text-[#c22850]">{error}</p> : null}
    </div>
  );
}
