"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import {
  closeCase, directCase, escalateCase, getSupervisionBoard, reassignCase, rescheduleCase,
  type Board, type BoardFilters, type BoardRow,
} from "@/lib/followups/supervision/actions";
import { LEVEL_LABEL, PRIORITY_LABEL, PROOF_LABEL, type Priority } from "@/lib/followups/supervision/core";

/**
 * «إشراف المتابعة» — the cases, the neediest first (at the management, then the
 * supervisor; high priority; the longest delay), with filters and the
 * supervisor's actions. The employee sees their own cases read-only; acting is
 * the supervisor's and the management's.
 */

const field = "rounded-lg border border-[#dbe6e1] bg-white p-2 text-sm";
const btn = "rounded-lg border border-[#dbe6e1] px-2.5 py-1 text-xs font-bold text-[#185045] hover:bg-[#f4f8f6] disabled:opacity-50";
const LEVEL_TONE = { manager: "bg-red-100 text-red-800", supervisor: "bg-amber-100 text-amber-800", employee: "bg-[#eef3f1] text-[#185045]" } as const;
const PRIO_TONE = { high: "text-red-700", normal: "text-[#185045]", low: "text-[#8ba09b]" } as const;

const duration = (m: number) => (m < 60 ? `${m} د` : m < 24 * 60 ? `${Math.floor(m / 60)} س ${m % 60} د` : `${Math.floor(m / 1440)} ي ${Math.floor((m % 1440) / 60)} س`);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ar-SA-u-ca-gregory-nu-latn", { timeZone: "Asia/Riyadh", dateStyle: "short", timeStyle: "short" }) : "—");

function Actions({ row, people, onDone }: { row: BoardRow; people: Board["people"]; onDone: () => void }) {
  const [mode, setMode] = useState<"direct" | "reschedule" | "reassign" | "escalate" | "close" | null>(null);
  const [text, setText] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [at, setAt] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function run() {
    setBusy(true); setMsg("");
    try {
      const r =
        mode === "direct" ? await directCase(row.id, text, minutes)
        : mode === "reschedule" ? await rescheduleCase(row.id, at ? new Date(at).toISOString() : "", text)
        : mode === "reassign" ? await reassignCase(row.id, to, text)
        : mode === "escalate" ? await escalateCase(row.id, text)
        : await closeCase(row.id, text);
      if (r.ok) { setMode(null); setText(""); onDone(); } else setMsg(r.error);
    } catch { setMsg("تعذّر الاتصال."); } finally { setBusy(false); }
  }

  const label: Record<NonNullable<typeof mode>, string> = { direct: "توجيه", reschedule: "إعادة جدولة", reassign: "إعادة إسناد", escalate: "تصعيد للمدير", close: "إغلاق الحالة" };
  return <div className="space-y-2">
    <div className="flex flex-wrap gap-1.5">
      {row.url && <a href={row.url} target="_blank" rel="noreferrer" className={`${btn} inline-flex items-center gap-1`}><ExternalLink size={12} /> المحادثة</a>}
      {row.followupId && <Link href={`/followups/${row.followupId}`} className={btn}>السجل</Link>}
      {(["direct", "reschedule", "reassign", "escalate", "close"] as const).filter((m) => m !== "escalate" || row.level !== "manager").map((m) =>
        <button key={m} type="button" onClick={() => { setMode(mode === m ? null : m); setMsg(""); }} className={`${btn} ${mode === m ? "border-[var(--tv-brand)] bg-[#eef3f1]" : ""}`}>{label[m]}</button>)}
    </div>
    {mode && <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[#f8fafa] p-2">
      {mode === "direct" && <label className="text-xs">المهلة (دقائق دوام) <input type="number" min={5} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className={`${field} w-20`} /></label>}
      {mode === "reschedule" && <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className={field} aria-label="الموعد الجديد" />}
      {mode === "reassign" && <select value={to} onChange={(e) => setTo(e.target.value)} className={field} aria-label="إلى">
        <option value="">إلى موظف متاح…</option>
        {people.filter((p) => p.id !== row.employeeId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>}
      <input value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} className={`${field} min-w-0 flex-1`}
        placeholder={mode === "direct" ? "التوجيه للموظف…" : mode === "close" ? "ما الذي عُولج؟ (يُغلق فقط بعد فعل حقيقي)" : "السبب…"} />
      <button type="button" disabled={busy} onClick={() => void run()} className="rounded-lg bg-[var(--tv-brand)] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
        {busy ? <Loader2 size={13} className="animate-spin" /> : "نفّذ"}
      </button>
    </div>}
    {msg && <p role="alert" className="text-xs text-red-700">{msg}</p>}
  </div>;
}

export function SupervisionBoard({ initial }: { initial: Board }) {
  const [board, setBoard] = useState(initial);
  const [filters, setFilters] = useState<BoardFilters>({ status: "open" });
  const [busy, setBusy] = useState(false);
  const canAct = board.manager || board.supervisor;

  async function reload(next = filters) {
    setBusy(true);
    try { const b = await getSupervisionBoard(next); if (b) setBoard(b); } finally { setBusy(false); }
  }
  const set = (patch: BoardFilters) => { const next = { ...filters, ...patch }; setFilters(next); void reload(next); };

  if (!board.enabled) return <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-[#5a4300]">الإشراف لم يُفعَّل بعد — ينتظر إنشاء جداوله في قاعدة البيانات.</p>;

  const cell = (children: ReactNode, cls = "") => <td className={`border-t border-[#eef3f1] p-2 align-top ${cls}`}>{children}</td>;
  return <section className="space-y-3">
    <div className="flex flex-wrap items-center gap-2">
      <select value={filters.status ?? "open"} onChange={(e) => set({ status: e.target.value as "open" | "closed" })} className={field} aria-label="الحالة">
        <option value="open">مفتوحة</option><option value="closed">مغلقة</option>
      </select>
      {filters.status === "closed" && <select value={filters.days ?? 7} onChange={(e) => set({ days: Number(e.target.value) })} className={field} aria-label="الفترة">
        {[1, 7, 30, 90].map((d) => <option key={d} value={d}>آخر {d} يوم</option>)}
      </select>}
      <select value={filters.priority ?? ""} onChange={(e) => set({ priority: (e.target.value || undefined) as Priority | undefined })} className={field} aria-label="الأولوية">
        <option value="">كل الأولويات</option>{(["high", "normal", "low"] as const).map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
      </select>
      {canAct && <select value={filters.employeeId ?? ""} onChange={(e) => set({ employeeId: e.target.value || undefined })} className={field} aria-label="الموظف">
        <option value="">كل الموظفين</option>{board.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>}
      {board.manager && <select value={filters.supervisorId ?? ""} onChange={(e) => set({ supervisorId: e.target.value || undefined })} className={field} aria-label="المشرف">
        <option value="">كل المشرفين</option>{board.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>}
      <button type="button" onClick={() => void reload()} className={`${btn} inline-flex items-center gap-1`}>{busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} تحديث</button>
      <span className="text-xs text-[#557d78]">{board.rows.length} حالة</span>
    </div>

    {!board.rows.length ? <p className="rounded-xl border border-[#dfe8e4] bg-white p-4 text-sm text-[#185045]">لا حالات {filters.status === "closed" ? "مغلقة في هذه الفترة" : "تحتاج إشرافاً الآن"} ✅</p> :
    <div className="overflow-x-auto rounded-xl border border-[#dfe8e4] bg-white">
      <table className="w-full min-w-[980px] text-start text-sm">
        <thead className="bg-[#f4f8f6] text-xs text-[#557d78]">
          <tr>{["العميل", "السبب", "التأخير", "الموظف / المشرف", "آخر رسالة للعميل", "آخر إجراء / الموعد", "الأولوية", canAct ? "الإجراء" : "الحالة"].map((h) => <th key={h} className="p-2 text-start font-bold">{h}</th>)}</tr>
        </thead>
        <tbody>
          {board.rows.map((r) => <tr key={r.id}>
            {cell(<><strong>{r.client}</strong><div className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold ${LEVEL_TONE[r.level]}`}>{LEVEL_LABEL[r.level]}</div></>)}
            {cell(<>{r.reasonLabel}{r.directive && <p className="mt-1 text-xs text-[#8a5a00]">📌 {r.directive} — حتى {when(r.directiveDueAt)}</p>}</>)}
            {cell(<span className="tabular-nums font-bold">{duration(r.delayMinutes)}</span>)}
            {cell(<><div>{r.employee}</div><div className="text-xs text-[#557d78]">{r.supervisor}</div></>)}
            {cell(<><p className="line-clamp-2 text-xs">{r.lastClientLine ?? "—"}</p><p className="text-[10px] text-[#8ba09b]">{when(r.lastClientAt)}</p></>)}
            {cell(<><p className="text-xs">{when(r.lastActionAt)}</p><p className="text-[10px] text-[#8ba09b]">الموعد: {when(r.nextFollowupAt)}</p></>)}
            {cell(<span className={`text-xs font-bold ${PRIO_TONE[r.priority]}`}>{PRIORITY_LABEL[r.priority]}</span>)}
            {cell(r.status === "closed"
              ? <p className="text-xs text-emerald-800">✓ {r.proof ? PROOF_LABEL[r.proof] : "أُغلقت"}{r.closeNote ? ` — ${r.closeNote}` : ""}</p>
              : canAct ? <Actions row={r} people={board.people} onDone={() => void reload()} />
              : <p className="text-xs text-[#557d78]">عالجها برسالة أو مكالمة موثّقة — تُغلق وحدها.</p>, "min-w-[260px]")}
          </tr>)}
        </tbody>
      </table>
    </div>}
  </section>;
}
