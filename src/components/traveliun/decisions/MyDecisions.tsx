"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  acknowledgeMyDecision,
  type MyDecision,
} from "@/lib/data/admin-decisions";

import { buttonTone } from "@/components/ui/button-variants";
/**
 * «قراراتي وخطاباتي» — every decision and official letter that reached this employee, newest first: when it reached
 * them, when they pressed «استلمت», the text and the PDF. A decision is acknowledged here or in «تنبيهاتي»; a sales
 * letter is signed in the bot («✍️ اعتمدت الخطاب»).
 */

const card =
  "tv-card rounded-2xl border p-4";
const primary =
  `${buttonTone({ variant: "default" })} inline-flex min-h-10 items-center justify-center rounded-xl px-4 text-sm font-bold disabled:opacity-40`;
const btn =
  `${buttonTone({ variant: "secondary" })} inline-flex min-h-10 items-center justify-center rounded-xl border px-3 text-sm font-bold`;
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    timeZone: "Asia/Riyadh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function MyDecisions({
  name,
  items,
  open,
}: {
  name: string;
  items: MyDecision[];
  open?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const waiting = items.filter(
    (i) => i.source === "decision" && !i.acknowledgedAt,
  ).length;
  return (
    <div
      dir="rtl"
      className="space-y-3 rounded-3xl bg-[#F4F6F3] p-2 text-[#12332c] sm:p-3 dark:bg-transparent dark:text-[#eaf3ef]"
    >
      <section className={card}>
        <h1 className="text-2xl font-extrabold">قراراتي وخطاباتي</h1>
        <p className="mt-1 text-sm text-slate-500">
          {name} —{" "}
          {items.length
            ? `${items.length} قرار وخطاب${waiting ? `، ${waiting} بانتظار «استلمت»` : ""}`
            : "لم يصلك قرار ولا خطاب بعد."}
        </p>
        {error && (
          <p className="mt-2 rounded-xl bg-red-50 p-2.5 text-sm text-red-800">
            {error}
          </p>
        )}
      </section>
      {items.map((i) => (
        <details
          key={i.ref}
          open={
            i.ref === open || (i.source === "decision" && !i.acknowledgedAt)
          }
          className={`${card} ${i.ref === open ? "ring-2 ring-[#185045]" : ""}`}
        >
          <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
            <b dir="ltr">{i.serial}</b>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-bold ${i.kind === "إنذار" ? "bg-red-100 text-red-800" : "bg-[#EEF5F1] text-[#185045]"}`}
            >
              {i.kind}
            </span>
            <span className="font-bold">{i.title}</span>
            <span
              className={`ms-auto text-xs font-bold ${i.acknowledgedAt ? "text-[#185045]" : "text-amber-700"}`}
            >
              {i.acknowledgedAt
                ? `✅ ${i.source === "letter" ? "اعتمدته" : "استلمته"} ${when(i.acknowledgedAt)}`
                : "⏳ لم تضغط «استلمت» بعد"}
            </span>
          </summary>
          <p className="mt-2 text-xs text-slate-500">
            صدر {when(i.issuedAt)} · {i.issuer}
            {i.deliveredAt
              ? ` · وصلك في «تنبيهاتي» ${when(i.deliveredAt)}`
              : ""}
          </p>
          {i.text && (
            <p className="mt-2 whitespace-pre-line rounded-xl bg-[#F4F6F3] p-3 text-sm leading-7 dark:bg-[#0f1c19]">
              {i.text}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {i.source === "decision" && !i.acknowledgedAt && (
              <button
                type="button"
                className={primary}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await acknowledgeMyDecision(i.ref).catch(() => ({
                      ok: false as const,
                      error: "تعذّر الحفظ، أعد المحاولة.",
                    }));
                    setError(r.ok ? "" : r.error);
                    if (r.ok) router.refresh();
                  })
                }
              >
                ✅ استلمت
              </button>
            )}
            {i.source === "letter" && !i.acknowledgedAt && (
              <span className="text-sm text-slate-500">
                يُعتمد من «تنبيهاتي»: «✍️ اعتمدت الخطاب» تحت الخطاب.
              </span>
            )}
            <a
              className={btn}
              href={`/my-decisions/${i.ref}/pdf`}
              target="_blank"
              rel="noreferrer"
            >
              📄 PDF
            </a>
          </div>
        </details>
      ))}
    </div>
  );
}
