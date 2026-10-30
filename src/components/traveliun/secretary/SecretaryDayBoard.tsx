"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, Clock, Copy, ExternalLink, Loader2, Search } from "lucide-react";
import { markMyDone, remindMe, type DoneItem, type MyFollowupItem, type SecretaryBoard } from "@/lib/data/my-followups";
import { type DayKind } from "@/lib/mine/rank";

/**
 * «خطة اليوم» as a WORK SCREEN, not a message (the owner, 2026-10-26): ordered
 * groups — the hot clients first and numbered, then who replied, then due offer
 * follow-ups, then the silent (collapsed behind a counter, searchable, oldest
 * first) — each row with Murad's one-line summary and suggestion, and buttons:
 * open the conversation, copy the prepared reply, «تمّت», «ذكّرني». Nothing is
 * ever sent to a client from here.
 */

const GROUPS: { kind: DayKind | "hot"; title: string; emoji: string }[] = [
  { kind: "hot", title: "العملاء الساخنون — الأولوية", emoji: "🔥" },
  { kind: "waiting", title: "ردّوا وينتظرونك", emoji: "💬" },
  { kind: "offer", title: "متابعات عروض مستحقة", emoji: "📋" },
  { kind: "reminder", title: "تذكيراتك", emoji: "⏰" },
  { kind: "silent", title: "سكتوا بعد رسالتك", emoji: "🤐" },
];

const since = (ms: number | null, nowMs: number) => {
  if (!ms) return "";
  const m = Math.max(1, Math.round((nowMs - ms) / 60_000));
  return m < 120 ? `${m} دقيقة` : m < 48 * 60 ? `${Math.round(m / 60)} ساعة` : `${Math.round(m / (24 * 60))} يوماً`;
};

function Row({ item, index, nowMs, readOnly, onDone, busyKey }: {
  item: MyFollowupItem; index: number | null; nowMs: number; readOnly: boolean;
  onDone: (key: string) => void; busyKey: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const [remindOpen, setRemindOpen] = useState(false);
  const [remindBusy, setRemindBusy] = useState(false);
  const [error, setError] = useState("");
  const busy = busyKey === item.key;

  async function copyDraft() {
    if (!item.draft) return;
    try { await navigator.clipboard.writeText(item.draft); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch {
      try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
      setError("انسخ يدوياً من النص أدناه.");
    }
  }

  async function remind(hours: number) {
    setRemindBusy(true); setError("");
    try {
      const r = await remindMe({ conversationId: item.conversationId, dueAt: new Date(Date.now() + hours * 3600_000).toISOString(), text: item.name, doneKey: item.key });
      if (r.ok) { setRemindOpen(false); onDone(item.key); } else setError("تعذّر الحفظ.");
    } catch { setError("تعذّر الاتصال."); } finally { setRemindBusy(false); }
  }

  return <div className="rounded-xl border border-[#e3e9e6] bg-white p-3">
    <div className="flex flex-wrap items-baseline gap-2">
      {index !== null && <span className="rounded-full bg-[#b3261e] px-2 py-0.5 text-xs font-extrabold text-white tabular-nums">{index + 1}</span>}
      <strong className="text-sm">{item.name}</strong>
      {item.destination && <span className="text-xs text-[#557d78]">· {item.destination}</span>}
      {item.since != null && <span className="text-xs text-[#8a5a0c] tabular-nums">· منذ {since(item.since, nowMs)}</span>}
      {item.canReply === false && <span className="text-[10px] font-bold text-[#9A3412]">خارج الـ24 ساعة: قالب أو اتصال</span>}
    </div>
    {item.wants && <p className="mt-1 text-sm leading-6 text-[#2f4f49]">يريد: {item.wants}</p>}
    {item.reminder?.text && <p className="mt-1 text-sm font-bold text-[#5C4300]">⏰ {item.reminder.text}</p>}
    {item.advice && <p className="mt-1 rounded-lg bg-[#f4f8f6] p-2 text-xs leading-6 text-[#185045]">💡 اقتراح مُراد: {item.advice}</p>}
    {item.draft && <details className="mt-1 text-xs text-[#557d78]"><summary className="cursor-pointer">الرد المقترح الجاهز</summary><p className="mt-1 whitespace-pre-wrap rounded-lg border border-dashed border-[#dbe6e1] p-2 leading-6">{item.draft}</p></details>}
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {item.url && <a href={item.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg bg-[var(--tv-brand)] px-3 py-1.5 text-xs font-bold text-white"><ExternalLink size={13} /> افتح المحادثة</a>}
      {item.followupId && <a href={`/followups/${item.followupId}`} className="inline-flex items-center gap-1 rounded-lg border border-[#dbe6e1] px-3 py-1.5 text-xs font-bold text-[#185045]">ملف المتابعة</a>}
      {item.draft && <button type="button" onClick={() => void copyDraft()} className="inline-flex items-center gap-1 rounded-lg border border-[#dbe6e1] px-3 py-1.5 text-xs font-bold text-[#185045]"><Copy size={13} /> {copied ? "نُسخ ✓" : "انسخ الرد المقترح"}</button>}
      {!readOnly && <>
        <button type="button" disabled={busy} onClick={() => onDone(item.key)} className="inline-flex items-center gap-1 rounded-lg border border-emerald-600 px-3 py-1.5 text-xs font-bold text-emerald-700">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} تمّت
        </button>
        <div className="relative">
          <button type="button" disabled={remindBusy} onClick={() => setRemindOpen((v) => !v)} className="inline-flex items-center gap-1 rounded-lg border border-[#dbe6e1] px-3 py-1.5 text-xs font-bold text-[#185045]"><Clock size={13} /> ذكّرني</button>
          {remindOpen && <div className="absolute z-10 mt-1 flex gap-1 rounded-lg border border-[#dbe6e1] bg-white p-1 shadow">
            {[["ساعة", 1], ["غداً", 24], ["3 أيام", 72]].map(([label, h]) => <button key={label as string} type="button" disabled={remindBusy}
              onClick={() => void remind(h as number)} className="rounded px-2 py-1 text-xs font-bold text-[#185045] hover:bg-[#f4f8f6]">{label as string}</button>)}
          </div>}
        </div>
      </>}
    </div>
    {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
  </div>;
}

export function SecretaryDayBoard({ board, compact = false }: { board: SecretaryBoard; compact?: boolean }) {
  const { view, doneToday, yesterdayDone } = board;
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [silentOpen, setSilentOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const [q, setQ] = useState("");
  const [message, setMessage] = useState("");
  const nowMs = view.at;

  const items = useMemo(() => view.items.filter((i) => !gone.has(i.key)), [view.items, gone]);
  const of = (kind: string) => (kind === "hot"
    ? items.filter((i) => i.heat === "hot" && i.kind !== "silent")
    : kind === "silent" ? items.filter((i) => i.kind === "silent")
    : items.filter((i) => i.kind === kind && !(i.heat === "hot")));

  async function done(key: string) {
    if (view.readOnly) return;
    setBusyKey(key); setMessage("");
    try {
      const r = await markMyDone(key);
      if (r.ok) setGone((g) => new Set([...g, key]));
      else setMessage("تعذّر الحفظ.");
    } catch { setMessage("تعذّر الاتصال."); } finally { setBusyKey(null); }
  }

  const total = items.length + doneToday.length;
  const silent = of("silent").filter((i) => !q.trim() || i.name.includes(q.trim())).sort((a, b) => (a.since ?? 0) - (b.since ?? 0));
  const max = compact ? 3 : 50;

  return <div className="space-y-4">
    {/* progress: Murad follows what got done on its own — a reply, an acted follow-up, a «تمّت» */}
    <div className="rounded-xl border border-[#dfe8e4] bg-white p-3">
      <div className="flex flex-wrap items-center gap-3">
        <strong className="text-sm">أنجزت {doneToday.length} من {total} اليوم</strong>
        <div className="h-2 min-w-24 flex-1 overflow-hidden rounded-full bg-[#eef3f1]">
          <div className="h-full rounded-full bg-emerald-600" style={{ width: `${total ? Math.round((doneToday.length / total) * 100) : 0}%` }} />
        </div>
        {yesterdayDone > 0 && <span className="text-xs text-[#557d78]">أمس أنجزت {yesterdayDone}</span>}
      </div>
      {!compact && doneToday.length > 0 && <button type="button" onClick={() => setDoneOpen((v) => !v)} className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-emerald-700">
        <ChevronDown size={13} className={doneOpen ? "rotate-180" : ""} /> المنجز اليوم ({doneToday.length})
      </button>}
      {!compact && doneOpen && <ul className="mt-2 space-y-1 text-xs text-[#2f4f49]">
        {doneToday.map((d: DoneItem) => <li key={d.conversationId}>✓ {d.name} — {d.how === "replied" ? "رددت عليه" : d.how === "acted" ? "تحرّكت على متابعته" : "علّمتها «تمّت»"}</li>)}
      </ul>}
    </div>

    {!view.teletel && <p className="rounded-lg bg-amber-50 p-2 text-xs text-[#8a5a0c]">تعذّرت قراءة تيلي تيل الآن — القائمة قد تنقص المحادثات المنتظرة.</p>}
    {message && <p role="alert" className="text-xs text-red-700">{message}</p>}

    {GROUPS.map(({ kind, title, emoji }) => {
      const list = kind === "silent" ? silent : of(kind);
      if (!list.length) return null;
      if (kind === "silent" && !compact) {
        return <section key={kind}>
          <button type="button" onClick={() => setSilentOpen((v) => !v)} className="flex w-full items-center gap-2 rounded-xl border border-[#e3e9e6] bg-[#f8fafa] p-3 text-start">
            <span className="text-sm font-bold">{emoji} {title}</span>
            <span className="rounded-full bg-[#eef3f1] px-2 py-0.5 text-xs font-bold tabular-nums">{of("silent").length}</span>
            <span className="flex-1" />
            <span className="text-xs font-bold text-[#557d78]">{silentOpen ? "أخفِ" : "عرض الكل"}</span>
            <ChevronDown size={14} className={silentOpen ? "rotate-180" : ""} />
          </button>
          {silentOpen && <div className="mt-2 space-y-2">
            <label className="flex items-center gap-2 rounded-lg border border-[#dbe6e1] bg-white px-3 py-1.5 text-sm"><Search size={14} className="text-tv-text-faint" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث بالاسم…" className="min-w-0 flex-1 bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus" />
            </label>
            {silent.map((i) => <Row key={i.key} item={i} index={null} nowMs={nowMs} readOnly={view.readOnly} onDone={(k) => void done(k)} busyKey={busyKey} />)}
          </div>}
        </section>;
      }
      return <section key={kind}>
        <h3 className="mb-2 text-sm font-bold">{emoji} {title} <span className="tabular-nums">({list.length})</span></h3>
        <div className="space-y-2">
          {list.slice(0, max).map((i, k) => <Row key={i.key} item={i} index={kind === "hot" ? k : null} nowMs={nowMs} readOnly={view.readOnly} onDone={(k2) => void done(k2)} busyKey={busyKey} />)}
          {list.length > max && <p className="text-xs text-[#557d78]">و{list.length - max} أخرى في الصفحة الكاملة…</p>}
        </div>
      </section>;
    })}
    {!items.length && <p className="rounded-xl border border-[#dfe8e4] bg-white p-4 text-sm text-[#185045]">لا شيء مستحق عليك الآن — يوم هادئ ✅</p>}
  </div>;
}
