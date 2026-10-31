"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Save } from "lucide-react";
import { getStaffReport, saveStaffReport } from "@/lib/data/daily-report";
import type { Place } from "@/lib/leads/auto";
import type { Report } from "@/lib/leads/daily-report";
import { compareReports, parseStaffReport } from "@/lib/leads/staff-report";

/**
 * «مطابقة تقريري» (the owner, 2026-10-31): the employee pastes the report she wrote for the day; each figure is set beside
 * the system's with where the difference comes from (lib/leads/staff-report.ts), and «احفظ» keeps her text with the comparison
 * so the differences can be studied day after day until one way of counting is agreed.
 */
export function StaffCompare({ report, places }: { report: Report; places: Place[] }) {
  const day = report.period.from;
  const [text, setText] = useState("");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "idle" | "saving" | "saved">("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void getStaffReport(day).then((r) => {
      if (!live) return;
      setText(r?.saved?.text ?? "");
      setSavedAt(r?.saved?.at ?? null);
      setState("idle");
    });
    return () => {
      live = false;
    };
  }, [day]);

  const rows = useMemo(() => (text.trim() ? compareReports(parseStaffReport(text), report, places) : []), [text, report, places]);
  const differ = rows.filter((r) => r.hers !== r.system || r.reasons.length > 0).length;

  async function save() {
    setState("saving");
    setError(null);
    const r = await saveStaffReport(day, text, rows).catch(() => ({ ok: false, error: "تعذّر الحفظ" }));
    if (!r.ok) {
      setError(r.error ?? "تعذّر الحفظ");
      setState("idle");
      return;
    }
    setSavedAt(new Date().toISOString());
    setState("saved");
  }

  if (report.period.kind !== "day") return <p className="tv-card rounded-[12px] border p-3 text-[13px] font-bold text-[#557d78]">المطابقة ليوم واحد — اختر «يومي» ثم اليوم.</p>;

  return (
    <div className="tv-card space-y-3 rounded-[12px] border p-3">
      <p className="text-[12.5px] font-bold text-[#185045]">الصقي تقريرك لهذا اليوم كما أرسلتِه — يظهر كل رقم بجانب رقم النظام، وسبب الفرق إن وُجد.</p>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (state === "saved") setState("idle");
        }}
        disabled={state === "loading"}
        rows={10}
        placeholder={state === "loading" ? "…" : "📊 تقرير الطلبات اليومي …"}
        aria-label="تقريري اليومي"
        className="w-full resize-y rounded-[10px] border border-[#cfe0d9] bg-[#fbfdfc] p-3 text-[13px] font-semibold leading-7 text-[#103f37]"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void save()} disabled={!text.trim() || state === "saving" || state === "loading"} className="tv-btn-primary inline-flex h-10 items-center gap-2 rounded-[10px] px-4 text-[13px] font-extrabold disabled:opacity-50">
          {state === "saving" ? <Loader2 className="size-4 animate-spin" /> : state === "saved" ? <Check className="size-4" /> : <Save className="size-4" />}
          {state === "saved" ? "حُفظ ✓" : "احفظ تقريري لهذا اليوم"}
        </button>
        {savedAt ? <span className="text-[12px] font-semibold text-[#557d78]">آخر حفظ: {new Date(savedAt).toLocaleString("ar-SA-u-ca-gregory-nu-latn", { timeZone: "Asia/Riyadh", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</span> : null}
        {rows.length > 0 ? <span className="ms-auto text-[12px] font-bold text-[#557d78]">{differ === 0 ? "متطابق ✓" : `${differ} بنداً فيه فرق`}</span> : null}
      </div>
      {error ? <p className="rounded-[9px] bg-[#fff1f1] px-3 py-2 text-[12px] font-bold text-[#c43d3d]">{error}</p> : null}

      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-[12.5px]">
            <thead>
              <tr className="text-[11px] font-extrabold text-[#557d78]">
                <th className="p-1.5 text-start">البند</th>
                <th className="p-1.5 text-start">تقريرك</th>
                <th className="p-1.5 text-start">النظام</th>
                <th className="p-1.5 text-start">سبب الفرق</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const same = r.hers === r.system;
                return (
                  <tr key={r.label} className={`border-t border-[#eef3f1] align-top ${same ? "" : "bg-[#fffaf0]"}`}>
                    <td className="whitespace-nowrap p-1.5 font-bold text-[#185045]">{r.label}</td>
                    <td className="tv-tnum p-1.5 font-extrabold">{r.hers ?? "—"}</td>
                    <td className="tv-tnum p-1.5 font-extrabold">{r.system}</td>
                    <td className="p-1.5 font-semibold leading-6 text-[#3d5f59]">{r.reasons.length ? r.reasons.join(" ") : same ? "متطابق" : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="text-[11.5px] font-semibold text-tv-text-faint">التقرير المحفوظ يراه المسؤول عن النظام ليفهم سبب كل فرق، حتى تُعتمد طريقة عدّ واحدة. لا يُرسل لأحد ولا يغيّر شيئاً في العملاء.</p>
    </div>
  );
}
