"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, KeyRound, Loader2, RotateCcw, XCircle } from "lucide-react";
import { DirText } from "@/components/DirText";
import type { PartnerCompany } from "@/lib/data/partner-companies";
import {
  approvePartnerCompany,
  issuePartnerAccount,
  resendPartnerPasswordLink,
  setPartnerStatus,
} from "@/lib/partners/registration";
import { describeTerms } from "@/lib/partners/pricing";

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
  const [pct, setPct] = useState("35");

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
 * No password is generated here or anywhere: Supabase sends a set-your-password
 * link and the only person who ever knows it is the one who chooses it.
 */
export function IssueAccount({ company }: { company: PartnerCompany }) {
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState(company.contact_email ?? company.email ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (company.status !== "approved") return null;

  return (
    <div className="mt-2 flex flex-wrap items-end gap-2 rounded-[10px] border border-[#e2ebe7] bg-[#f8fbf9] p-2.5">
      <label className="grid flex-1 gap-1 text-[11px] font-bold text-[#185045]">
        بريد الدخول للشركة
        <input dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} className={`${field} text-start`} />
      </label>
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

      {/* An invitation is single-use, so a company that lost the first link had
          no way back in — «مُصدر له حساب بالفعل» was a dead end. This is it. */}
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

      {message ? (
        <p className={`basis-full text-[11.5px] font-bold ${done ? "text-[#0f7a52]" : "text-[#c22850]"}`}>{message}</p>
      ) : null}
    </div>
  );
}
