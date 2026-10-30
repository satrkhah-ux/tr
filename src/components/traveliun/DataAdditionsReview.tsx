"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { reviewCatalogAddition, type AdditionForReview } from "@/lib/data/catalog-additions";
import type { AdditionKind } from "@/lib/catalog/additions";

const KIND: Record<AdditionKind, string> = { country: "دولة", city: "مدينة", hotel: "فندق", room: "غرفة", view: "إطلالة" };
const STATUS = { pending: "بانتظار المراجعة", approved: "معتمدة لكل الموظفين", rejected: "مرفوضة" } as const;
const OPEN: Partial<Record<AdditionKind, string>> = { hotel: "/hotels?id=", city: "/cities?id=", country: "/countries?id=" };

/**
 * The data team's queue: each addition with who added it, where, and what they
 * typed. The name is corrected in place; «اعتمد» shows it to every employee
 * (and renames the hotel / city / country row), «ارفض» hides it from lists.
 */
export function DataAdditionsReview({ initial, enabled }: { initial: AdditionForReview[]; enabled: boolean }) {
  const [rows, setRows] = useState(initial);
  const [names, setNames] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!enabled) {
    return <p className="rounded-2xl bg-[#fff8e6] p-4 text-[13px] font-bold text-[#8a6400]">هذه الصفحة تعمل بعد تفعيل جدول الإضافات في قاعدة البيانات.</p>;
  }

  const decide = async (row: AdditionForReview, status: "approved" | "rejected") => {
    setBusy(row.id);
    setError(null);
    const name = names[row.id] ?? row.name;
    const res = await reviewCatalogAddition(row.id, { status, name }).catch(() => ({ ok: false, error: "تعذّر الحفظ" }));
    setBusy(null);
    if (!res.ok) return setError(res.error ?? "تعذّر الحفظ");
    setRows((all) => all.map((r) => (r.id === row.id ? { ...r, status, name: name.trim() || r.name } : r)));
  };

  const pending = rows.filter((r) => r.status === "pending").length;
  return (
    <div className="space-y-3">
      <p className="text-[13px] font-bold text-[#557d78]">
        {pending ? `${pending} إضافة بانتظار المراجعة — صحّح الاسم إن لزم ثم اعتمده لكل الموظفين.` : "لا توجد إضافات بانتظار المراجعة."}
      </p>
      {error ? <p className="text-[12.5px] font-bold text-[#c22850]">{error}</p> : null}
      <div className="overflow-x-auto rounded-2xl border border-[#dbe6e1] bg-white dark:border-[#294039] dark:bg-[#14231f]">
        <table className="w-full min-w-[720px] text-[12.5px]">
          <thead className="bg-[#f2f7f5] text-[#557d78] dark:bg-[#1b2d27]">
            <tr>
              <th className="p-2 text-start">النوع</th>
              <th className="p-2 text-start">الاسم (صحّحه هنا)</th>
              <th className="p-2 text-start">كتبه الموظف</th>
              <th className="p-2 text-start">المكان</th>
              <th className="p-2 text-start">أضافه</th>
              <th className="p-2 text-start">الحالة</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-[#eef3f1] dark:border-[#294039]">
                <td className="p-2 font-extrabold text-[#185045] dark:text-[#d6e5df]">{KIND[r.kind]}</td>
                <td className="p-2">
                  {r.status === "pending" ? (
                    <input
                      dir="auto"
                      maxLength={80}
                      value={names[r.id] ?? r.name}
                      onChange={(e) => setNames((n) => ({ ...n, [r.id]: e.target.value }))}
                      aria-label="الاسم"
                      className="h-8 w-full rounded-[8px] border border-[#dbe6e1] px-2 dark:border-[#294039] dark:bg-[#14231f]"
                    />
                  ) : OPEN[r.kind] && r.ref_id ? (
                    <a href={`${OPEN[r.kind]}${r.ref_id}`} className="font-bold text-[#0f7a52] underline" dir="auto">{r.name}</a>
                  ) : (
                    <span dir="auto">{r.name}</span>
                  )}
                </td>
                <td className="p-2 text-tv-text-faint" dir="auto">{r.typed_text}</td>
                <td className="p-2 text-tv-text-faint">{[r.city, r.country].filter(Boolean).join(" — ") || "—"}</td>
                <td className="p-2 text-tv-text-faint">
                  {r.author ?? "—"}
                  <div className="tv-tnum text-[11px]">{new Date(r.created_at).toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" })}</div>
                </td>
                <td className="p-2 font-bold">{STATUS[r.status]}</td>
                <td className="p-2">
                  {r.status === "pending" ? (
                    <span className="flex gap-1">
                      <button type="button" disabled={busy === r.id} onClick={() => void decide(r, "approved")} className="inline-flex items-center gap-1 rounded-[8px] bg-[#185045] px-2 py-1 font-bold text-white disabled:opacity-60">
                        <Check className="size-3.5" /> اعتمد
                      </button>
                      <button type="button" disabled={busy === r.id} onClick={() => void decide(r, "rejected")} className="inline-flex items-center gap-1 rounded-[8px] border border-[#f0c9d2] px-2 py-1 font-bold text-[#c22850] disabled:opacity-60">
                        <X className="size-3.5" /> ارفض
                      </button>
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
