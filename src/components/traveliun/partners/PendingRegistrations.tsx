"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, KeyRound, Loader2, RotateCcw, XCircle } from "lucide-react";
import { DirText } from "@/components/DirText";
import type { PartnerCompany } from "@/lib/data/partner-companies";
import {
  approvePartnerCompany,
  issuePartnerAccount,
  partnerDocumentUrl,
  resendPartnerPasswordLink,
  setPartnerPassword,
  setPartnerStatus,
} from "@/lib/partners/registration";
import { DOCUMENT_LABEL, type PartnerDocumentKind } from "@/lib/partners/registration-form";
import { describeTerms } from "@/lib/partners/pricing";
import { loginName, passwordProblem } from "@/lib/auth/password-rule";

/**
 * Companies that asked to work with us, and the one screen that decides.
 *
 * Approval is where the commercial terms are set, and it is the ONLY place they
 * can be set — a company cannot influence its own percentage, because the form
 * it filled in has no field for one. Issuing the login is a separate, second
 * press: approving decides the terms, issuing decides that someone may sign in.
 */

const field =
  "h-9 w-full rounded-[9px] border border-[#dbe6e1] bg-white px-2.5 text-[12.5px] text-[#185045] outline-none focus:border-[#2aa87a]";

export function PendingRegistrations({ companies }: { companies: PartnerCompany[] }) {
  const pending = companies.filter((c) => c.status === "pending");
  if (pending.length === 0) return null;

  return (
    <section className="mb-4 rounded-2xl border border-[#f2e2b4] bg-[#fffdf7] p-5">
      <h2 className="text-sm font-extrabold text-[#a86a10]">
        طلبات شراكة بانتظار القرار ({pending.length})
      </h2>
      <p className="mb-3 mt-1 text-[11.5px] font-semibold text-[#93aaa3]">
        الشركة لا ترى شيئاً ولا تدخل النظام قبل الاعتماد. النسبة تُحدَّد هنا، ولا يمكن للشركة التأثير فيها.
      </p>
      <div className="space-y-2.5">
        {pending.map((c) => (
          <PendingRow key={c.id} company={c} />
        ))}
      </div>
    </section>
  );
}

function PendingRow({ company }: { company: PartnerCompany }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [kind, setKind] = useState<"markup" | "commission">("markup");
  const [pct, setPct] = useState("15");

  return (
    <div className="rounded-[12px] border border-[#e2ebe7] bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-extrabold text-[#003c3a]">{company.name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] font-bold text-[#557d78]">
            {company.contact_email ? <DirText dir="ltr">{company.contact_email}</DirText> : null}
            {company.phone ? <DirText dir="ltr">{company.phone}</DirText> : null}
            {company.website ? <DirText dir="ltr">{company.website}</DirText> : null}
            {company.contact_name ? <span>{company.contact_name}</span> : null}
          </p>
          {company.registration_note ? (
            <p className="mt-1 text-[11.5px] text-[#93aaa3]">{company.registration_note}</p>
          ) : null}
          <RequestDetails company={company} />
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-[11px] font-bold text-[#185045]">
            الاتجاه
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={field}>
              <option value="markup">إضافة على سعرنا</option>
              <option value="commission">خصم من سعرنا</option>
            </select>
          </label>
          <label className="grid gap-1 text-[11px] font-bold text-[#185045]">
            النسبة %
            <input
              type="number"
              min={0}
              max={100}
              dir="ltr"
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              className={`${field} tv-tnum w-20 text-center`}
            />
          </label>

          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await approvePartnerCompany({
                  id: company.id,
                  price_adjust_kind: kind,
                  price_adjust_pct: Number(pct),
                });
                setMessage(res.ok ? null : res.message);
                if (res.ok) router.refresh();
              })
            }
            className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-3 text-[12px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <BadgeCheck className="size-3.5" />}
            اعتماد
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await setPartnerStatus(company.id, "rejected");
                setMessage(res.ok ? null : res.message);
                if (res.ok) router.refresh();
              })
            }
            className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#f2c7c7] px-3 text-[12px] font-bold text-[#c43d3d] hover:bg-[#fff1f1] disabled:opacity-60"
          >
            <XCircle className="size-3.5" />
            رفض
          </button>
        </div>
      </div>

      <p className="mt-2 text-[11.5px] font-bold text-[#557d78]">
        عند الاعتماد: {describeTerms({ kind, pct: Number(pct) || 0 })}
      </p>
      {message ? <p className="mt-1 text-[11.5px] font-bold text-[#c22850]">{message}</p> : null}
    </div>
  );
}

/**
 * Issuing the login, for a company already approved.
 *
 * Normally Supabase sends a set-your-password link and the only person who ever
 * knows it is the one who chooses it. When that mail never arrives (the owner,
 * 2026-10-19), «كلمة مرور مؤقتة» sets one the administration hands over, which
 * the company must change at its first sign-in. Nothing generates it, and it is
 * cleared from this screen once set.
 */
export function IssueAccount({ company }: { company: PartnerCompany }) {
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState(company.contact_email ?? company.email ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [temp, setTemp] = useState<string | null>(null);
  /** a login made with the temporary password — no invitation to send any more */
  const [made, setMade] = useState(false);
  const router = useRouter();

  if (company.status !== "approved") return null;
  const weak = temp ? passwordProblem(temp, loginName(email)) : null;

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-[10px] border border-[#e2ebe7] bg-[#f8fbf9] p-2.5">
      <label className="grid flex-1 gap-1 text-[11px] font-bold text-[#185045]">
        بريد الدخول للشركة
        <input dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} className={`${field} text-start`} />
      </label>
      {company.has_account || made ? null : (
      <button
        type="button"
        disabled={pending || done}
        onClick={() =>
          startTransition(async () => {
            const res = await issuePartnerAccount({ partner_id: company.id, email });
            if (res.ok) {
              setDone(true);
              setMessage("أُرسل رابط تعيين كلمة المرور إلى الشركة.");
            } else setMessage(res.message);
          })
        }
        className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#b7d0c7] px-3 text-[12px] font-bold text-[#185045] hover:bg-white disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
        {done ? "تم الإرسال" : "إصدار حساب"}
      </button>
      )}

      {/* An invitation is single-use, so a company that lost the first link had
          no way back in — «مُصدر له حساب بالفعل» was a dead end. This is it. */}
      {company.has_account ? (
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setDone(false);
            const res = await resendPartnerPasswordLink({ partner_id: company.id, email });
            if (res.ok) {
              setDone(true);
              setMessage("أُرسل رابط جديد لتعيين كلمة المرور.");
            } else setMessage(res.message);
          })
        }
        className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#dbe6e1] px-3 text-[12px] font-bold text-[#557d78] hover:bg-white disabled:opacity-60"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
        إعادة إرسال كلمة المرور
      </button>
      ) : null}

      {/* the mail never came: a password the administration hands over, changed at the first sign-in */}
      {temp === null ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setTemp("");
            setMessage(null);
          }}
          className="inline-flex h-9 items-center gap-1.5 rounded-[9px] px-2 text-[12px] font-bold text-[#557d78] hover:text-[#185045] disabled:opacity-60"
        >
          <KeyRound className="size-3.5" />
          كلمة مرور جديدة
        </button>
      ) : (
        <span className="flex basis-full flex-wrap items-end gap-2">
          <label className="grid min-w-52 flex-1 gap-1 text-[11px] font-bold text-[#185045]">
            كلمة المرور المؤقتة (10 أحرف على الأقل، حروف وأرقام)
            <input
              dir="ltr"
              value={temp}
              onChange={(e) => setTemp(e.target.value)}
              autoComplete="new-password"
              spellCheck={false}
              className={`${field} text-start`}
            />
          </label>
          <button
            type="button"
            disabled={pending || !temp || Boolean(weak)}
            title={weak ?? undefined}
            onClick={() =>
              startTransition(async () => {
                setDone(false);
                const res = await setPartnerPassword({ partner_id: company.id, email, password: temp });
                if (res.ok) {
                  setDone(true);
                  setTemp(null);
                  if (res.created) {
                    setMade(true);
                    router.refresh();
                  }
                  setMessage(
                    `${res.created ? "أُنشئ حساب الشركة" : "عُيّنت كلمة مرور جديدة وأُخرج الحساب من كل أجهزته"} — أعطِ الشركة البريد ${email} وكلمة المرور، وتدخل من صفحة تسجيل الدخول، وسيُطلب منها تغييرها عند دخولها.`,
                  );
                } else setMessage(res.message);
              })
            }
            className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-3 text-[12px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
            {company.has_account || made ? "تعيين كلمة المرور" : "إصدار الحساب بكلمة المرور"}
          </button>
          <button type="button" onClick={() => setTemp(null)} className="h-9 px-2 text-[12px] font-bold text-[#557d78]">
            إلغاء
          </button>
          {temp && weak ? <span className="basis-full text-[11px] font-bold text-[#a86a10]">{weak}</span> : null}
        </span>
      )}

      {message ? (
        <p className={`basis-full text-[11.5px] font-bold ${done ? "text-[#0f7a52]" : "text-[#c22850]"}`}>{message}</p>
      ) : null}
    </div>
  );
}

/** The licence, where it works, the terms it accepted, and its documents (opened by a short signed link). */
function RequestDetails({ company }: { company: PartnerCompany }) {
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const facts = [
    company.reference_no ? `الطلب ${company.reference_no}` : null,
    company.commercial_register ? `السجل ${company.commercial_register}` : null,
    company.tourism_license ? `الرخصة ${company.tourism_license}` : null,
    company.vat_number ? `الضريبي ${company.vat_number}` : null,
    [company.city, company.country].filter(Boolean).join("، ") || null,
  ].filter(Boolean);
  if (facts.length === 0 && company.documents.length === 0 && !company.terms_accepted_at) return null;

  return (
    <div className="mt-1.5 space-y-1">
      {facts.length ? <p className="text-[11.5px] font-bold text-[#557d78]">{facts.join(" · ")}</p> : null}
      <p className="text-[11px] font-semibold text-[#93aaa3]">
        {company.terms_accepted_at
          ? `وافقت على شروط التعاون (${company.terms_version ?? "—"}) في ${company.terms_accepted_at.slice(0, 10)}`
          : "لا موافقة مسجّلة على شروط التعاون"}
      </p>
      {company.documents.length ? (
        <div className="flex flex-wrap gap-1.5">
          {company.documents.map((d) => (
            <button
              key={d.path}
              type="button"
              disabled={opening === d.path}
              onClick={async () => {
                setError(null);
                setOpening(d.path);
                // opened before the await so the browser treats it as the click's own window
                const tab = window.open("", "_blank");
                const res = await partnerDocumentUrl(company.id, d.path);
                setOpening(null);
                if (res.ok && tab) tab.location.href = res.url;
                else {
                  tab?.close();
                  setError(res.ok ? "اسمح بفتح النوافذ لهذا الموقع." : res.message);
                }
              }}
              className="inline-flex h-7 items-center gap-1 rounded-[8px] border border-[#d8e4df] bg-white px-2.5 text-[11.5px] font-bold text-[#185045] disabled:opacity-60"
            >
              {opening === d.path ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {DOCUMENT_LABEL[d.kind as PartnerDocumentKind] ?? d.kind}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <p className="text-[11px] font-bold text-[#c22850]">{error}</p> : null}
    </div>
  );
}
