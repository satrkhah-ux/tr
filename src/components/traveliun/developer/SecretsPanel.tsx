"use client";

import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { checkSecret, clearSecret, listSecrets, saveSecret, type SecretRow } from "@/lib/secrets/actions";
import type { CheckResult } from "@/lib/developer/health";

/**
 * «المفاتيح والتوكنات» (the owner, 2026-10-29: «مكان لاضافة التوكن او الـAPI
 * الجديد عند انشائه»): per allowed name — set or not, from where, the last
 * four characters, who changed it when; a write-only field to save or replace
 * (the value is never shown back), clear, and «افحص الآن» that runs the
 * integration's own check.
 */

type Data = NonNullable<Awaited<ReturnType<typeof listSecrets>>>;
const field = "rounded-lg border border-[#dbe6e1] bg-white p-2 text-sm";
const btn = "rounded-lg border border-[#dbe6e1] px-2.5 py-1.5 text-xs font-bold text-[#185045] hover:bg-[#f4f8f6] disabled:opacity-50";
const SOURCE = { vault: "محفوظ هنا", env: "من الخادم" } as const;
const TONE: Record<string, string> = { ok: "text-emerald-700", warn: "text-amber-700", down: "text-red-700", idle: "text-[#557d78]", unconfigured: "text-[#557d78]" };

function Row({ row, vault, onChanged }: { row: SecretRow; vault: boolean; onChanged: () => Promise<void> }) {
  const { t } = useTraveliunUI();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState<"save" | "clear" | "check" | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [msg, setMsg] = useState("");
  const [check, setCheck] = useState<CheckResult | null>(null);

  async function save() {
    setBusy("save"); setMsg(""); setCheck(null);
    try {
      const r = await saveSecret(row.name, value);
      // the field is emptied either way: a value is never kept in the page after it was sent
      setValue("");
      setMsg(r.ok ? `حُفظ (ينتهي بـ ${r.last4}) — يعمل فوراً بلا إعادة نشر.` : r.error);
      if (r.ok) await onChanged();
    } catch { setMsg("تعذّر الاتصال."); } finally { setBusy(null); }
  }
  async function clear() {
    setBusy("clear"); setMsg(""); setConfirmClear(false);
    try { const r = await clearSecret(row.name); setMsg(r.ok ? "مُسح — يعود لقيمة الخادم إن وُجدت." : r.error); if (r.ok) await onChanged(); }
    catch { setMsg("تعذّر الاتصال."); } finally { setBusy(null); }
  }
  async function test() {
    setBusy("check"); setMsg(""); setCheck(null);
    try { const r = await checkSecret(row.name); if ("ok" in r) setMsg(r.error); else setCheck(r); }
    catch { setMsg("تعذّر الاتصال."); } finally { setBusy(null); }
  }

  return <div className="rounded-xl border border-[#e3e9e6] bg-white p-3">
    <div className="flex flex-wrap items-center gap-2">
      <code dir="ltr" className="text-sm font-bold text-[#185045]">{row.name}</code>
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${row.set ? "bg-emerald-50 text-emerald-800" : "bg-[#f4f6f3] text-tv-text-faint"}`}>
        {row.set ? `${SOURCE[row.source!]} · …${row.last4 ?? "????"}` : "غير مضبوط"}
      </span>
      {row.updatedAt && <span className="text-[11px] text-tv-text-faint">آخر تغيير: {row.updatedBy ?? "—"} · {new Date(row.updatedAt).toLocaleString("ar-SA-u-ca-gregory-nu-latn", { timeZone: "Asia/Riyadh", dateStyle: "short", timeStyle: "short" })}</span>}
    </div>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {/* write-only: a password field, never filled from the server, emptied after sending */}
      <input type="password" autoComplete="new-password" value={value} onChange={(e) => setValue(e.target.value)} disabled={!vault || busy !== null}
        placeholder={row.set ? "قيمة جديدة لاستبدالها…" : "الصق القيمة…"} aria-label={`قيمة ${row.name}`} dir="ltr" className={`${field} min-w-0 flex-1`} />
      <button type="button" disabled={!vault || !value.trim() || busy !== null} onClick={() => void save()} className="rounded-lg bg-[var(--tv-brand)] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
        {busy === "save" ? <Loader2 size={13} className="animate-spin" /> : row.source === "vault" ? "استبدل" : "احفظ"}
      </button>
      {row.source === "vault" && (!confirmClear
        ? <button type="button" disabled={busy !== null} onClick={() => setConfirmClear(true)} className={btn}>امسح</button>
        : <span className="flex items-center gap-1 text-xs">متأكد؟ <button type="button" onClick={() => void clear()} className="rounded bg-red-600 px-2 py-1 font-bold text-white">امسح</button><button type="button" onClick={() => setConfirmClear(false)} className={btn}>لا</button></span>)}
      {row.checkId && <button type="button" disabled={busy !== null} onClick={() => void test()} className={btn}>{busy === "check" ? <Loader2 size={13} className="animate-spin" /> : "افحص الآن"}</button>}
    </div>
    {msg && <p role="status" className="mt-1.5 text-xs text-[#185045]">{msg}</p>}
    {check && <p className={`mt-1.5 text-xs font-bold ${TONE[check.status] ?? ""}`}>
      {check.status === "ok" ? "✓ " : check.status === "down" ? "✗ " : ""}{t(check.detail.key, check.detail.params)}
      {check.extra?.map((m, i) => <span key={i} className="block font-normal">{t(m.key, m.params)}</span>)}
    </p>}
  </div>;
}

export function SecretsPanel({ initial }: { initial: Data }) {
  const [data, setData] = useState(initial);
  async function reload() { const d = await listSecrets(); if (d) setData(d); }
  return <section dir="rtl" className="space-y-3 text-[#185045]">
    <header>
      <h1 className="flex items-center gap-2 text-2xl font-extrabold"><KeyRound /> المفاتيح والتوكنات</h1>
      <p className="mt-1 text-sm">أضف المفتاح أو التوكن الجديد هنا — يُشفَّر ويعمل فوراً بلا إعادة نشر. لا تظهر القيمة بعد حفظها أبداً، فقط آخر أربعة أحرف. الأسماء من «الربط الخارجي».</p>
    </header>
    {!data.enabled && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-[#5a4300]">الخزنة لم تُفعَّل بعد — ينتظر إنشاء جدولها. الأسماء تُعرض من الخادم فقط.</p>}
    {!data.vault && <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-[#5a4300]">مفتاح التشفير على الخادم (SETTINGS_ENCRYPTION_KEY) غير مضبوط — الحفظ هنا متوقف.</p>}
    <div className="space-y-2">{data.rows.map((r) => <Row key={r.name} row={r} vault={data.vault && data.enabled} onChanged={reload} />)}</div>
  </section>;
}
