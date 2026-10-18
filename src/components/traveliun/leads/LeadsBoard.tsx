"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { BarChart3, ChevronLeft, ChevronRight, ExternalLink, Loader2, MessageCircle, Plus, RefreshCw, Search, Users, X } from "lucide-react";
import { DirText } from "@/components/DirText";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { addLead, leadThread, pullLeadsNow, startProgramme, updateLead, type Lead, type LeadPatch, type LeadsPage, type LeadThread } from "@/lib/data/leads";
import { fold, HEADERS, INQUIRIES, riyadhDay } from "@/lib/leads/sheet";
import { TraveliunShell } from "../TraveliunShell";

const SENT = ["تم إرسال التفاصيل", "تم إرسال البرنامج", "تم إرسال المعلومات"];
const TONE = new Map<string, (typeof INQUIRIES)[number]>(INQUIRIES.map((i) => [i.label, i]));

type Tab = "open" | "mine" | "returning" | "closed" | "all";
const TABS: [Tab, string][] = [
  ["open", "مفتوحة"],
  ["mine", "محادثاتي"],
  ["returning", "عميل سابق"],
  ["closed", "مغلقة"],
  ["all", "الكل"],
];
type Range = 1 | 7 | 30 | 0;
const RANGES: [Range, string][] = [
  [1, "اليوم"],
  [7, "آخر 7 أيام"],
  [30, "آخر 30 يوماً"],
  [0, "الكل"],
];

const CELL = "h-8 w-full rounded-[8px] border border-[#cfe0d9] bg-white px-2 text-[12px] font-semibold text-[#185045]";

/** «عميل سابق» — a colour none of the kinds wears */
const RETURNING = { color: "#1e3a8a", ink: "#ffffff" };

/** a span of time as the delay column always said it: minutes, hours, days */
const span = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m} دقيقة`;
  if (m < 1440) return `${Math.round(m / 60)} ساعة`;
  return `${Math.round(m / 1440)} يوم`;
};
const ms = (iso: string | null) => (iso ? Date.parse(iso) : NaN);

/**
 * The three timing columns, computed from the times the system holds (0098) —
 * never typed, the same for every role (the owner, 2026-10-18). Without the
 * time: «—», or «ينتظر منذ …» while it is still awaited.
 */
function timing(l: Lead, now: number) {
  const first = ms(l.first_message_at);
  const open = l.status === "open";
  const awaited = (from: number) => (open ? { text: `ينتظر منذ ${span(now - from)}`, waiting: true } : { text: "—", waiting: false });
  const done = (text: string) => ({ text, waiting: false });
  const reply = ms(l.first_reply_at);
  const assigned = ms(l.assigned_at);
  const assigneeReply = ms(l.assignee_reply_at);
  return {
    firstReply: Number.isNaN(first) ? done("—") : Number.isNaN(reply) ? awaited(first) : done(span(reply - first)),
    toAssign: Number.isNaN(assigned) || Number.isNaN(first) ? done("—") : done(span(assigned - first)),
    assigneeReply: Number.isNaN(assigned) ? done("—") : Number.isNaN(assigneeReply) ? awaited(assigned) : done(span(assigneeReply - assigned)),
  };
}

/** a turn's span in epoch seconds */
const secs = (from: number, to: number) => span((to - from) * 1000);

/** «مسار المحادثة»: each agent's turn — how long to answer, how long before handing it on */
function Turns({ l, now }: { l: Lead; now: number }) {
  if (!l.handoffs?.length) return <span className="text-[#93aaa3]">—</span>;
  return (
    <ol className="space-y-0.5 text-[11px] font-semibold leading-5" suppressHydrationWarning>
      {l.handoffs.map((s, i) => (
        <li key={i} className="whitespace-nowrap">
          <b className="text-[#003c3a]">{s.agent}</b>
          {": "}
          {s.reply ? (
            <span className="text-[#185045]">ردّ بعد {secs(s.from, s.reply)}</span>
          ) : l.status === "open" && s.handed == null ? (
            <span className="text-[#a86a10]">لم يردّ — منذ {secs(s.from, now / 1000)}</span>
          ) : (
            <span className="text-[#93aaa3]">لم يردّ</span>
          )}
          {s.handed ? <span className="text-[#557d78]"> · أسندها بعد {secs(s.from, s.handed)}</span> : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * «أداء الموظفين» (the owner, 2026-10-18): per agent, over the chosen range —
 * the conversations that reached them, how long they took to answer, and how
 * long before they handed one on.
 */
function Performance({ rows }: { rows: Lead[] }) {
  const per = new Map<string, { agent: string; received: number; replies: number[]; handed: number[]; waiting: number }>();
  for (const l of rows) {
    for (const s of l.handoffs ?? []) {
      const p = per.get(fold(s.agent)) ?? { agent: s.agent, received: 0, replies: [], handed: [], waiting: 0 };
      p.received += 1;
      if (s.reply) p.replies.push(s.reply - s.from);
      else if (l.status === "open" && s.handed == null) p.waiting += 1;
      if (s.handed) p.handed.push(s.handed - s.from);
      per.set(fold(s.agent), p);
    }
  }
  const avg = (xs: number[]) => (xs.length ? span((xs.reduce((a, b) => a + b, 0) / xs.length) * 1000) : "—");
  const list = [...per.values()].sort((a, b) => b.received - a.received);
  return (
    <div className="mt-3 overflow-x-auto rounded-[12px] border border-[#e3ece8]">
      <table className="w-full min-w-[640px] text-start text-[12px]">
        <thead className="bg-[#f8fbfa] text-[11px] font-extrabold text-[#78948f]">
          <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:text-start">
            <th>الموظف</th>
            <th>وصلته</th>
            <th>متوسط وقت الرد</th>
            <th>لم يردّ بعد</th>
            <th>أسندها لغيره</th>
            <th>متوسط الوقت حتى الإسناد</th>
          </tr>
        </thead>
        <tbody>
          {list.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-3 py-4 text-center font-semibold text-[#93aaa3]">
                لا بيانات بعد — يُقرأ مسار كل محادثة من Teletel مع السحب
              </td>
            </tr>
          ) : null}
          {list.map((p) => (
            <tr key={p.agent} className="border-t border-[#eef3f1] font-semibold text-[#185045] [&>td]:px-3 [&>td]:py-1.5">
              <td className="font-extrabold text-[#003c3a]">{p.agent}</td>
              <td className="tv-tnum">{p.received}</td>
              <td>{avg(p.replies)}</td>
              <td className={`tv-tnum ${p.waiting ? "text-[#a86a10]" : ""}`}>{p.waiting}</td>
              <td className="tv-tnum">{p.handed.length}</td>
              <td>{avg(p.handed)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Timing({ value }: { value: { text: string; waiting: boolean } }) {
  return (
    <span suppressHydrationWarning className={`block whitespace-nowrap font-semibold ${value.waiting ? "text-[#a86a10]" : "text-[#185045]"}`}>
      {value.text}
    </span>
  );
}

const shiftDay = (day: string, by: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
};

/** the most-asked values of one field, spellings folded together («الدوله» = «الدولة») */
function top(rows: Lead[], pick: (l: Lead) => string | null | undefined, n = 8): { label: string; count: number }[] {
  const groups = new Map<string, { label: string; count: number }>();
  for (const l of rows) {
    const v = pick(l)?.trim();
    if (!v) continue;
    const g = groups.get(fold(v)) ?? { label: v, count: 0 };
    g.count += 1;
    groups.set(fold(v), g);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, n);
}

function Bars({ title, rows, tone }: { title: string; rows: { label: string; count: number }[]; tone?: (label: string) => string | undefined }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="rounded-[12px] border border-[#e3ece8] p-3">
      <h3 className="mb-2 text-[12px] font-extrabold text-[#185045]">{title}</h3>
      {rows.length === 0 ? <p className="text-[11.5px] font-semibold text-[#93aaa3]">لا بيانات</p> : null}
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.label} className="grid grid-cols-[6.5rem_minmax(0,1fr)_2rem] items-center gap-2 text-[11.5px] font-semibold text-[#185045]">
            <span className="truncate">{r.label}</span>
            <span className="h-2.5 rounded-full bg-[#eef4f1]">
              <span className="block h-full rounded-full" style={{ width: `${(r.count / max) * 100}%`, background: tone?.(r.label) ?? "#0f7a52" }} />
            </span>
            <span className="tv-tnum text-end">{r.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LeadsBoard({ leads, team, meId, pullError, twoWay, live }: LeadsPage) {
  const router = useRouter();
  const today = riyadhDay(Date.now());
  const [day, setDay] = useState(today);
  const [kind, setKind] = useState<string | null>(null);
  const [returningOnly, setReturningOnly] = useState(false);
  const [thread, setThread] = useState<{ lead: Lead; result: LeadThread | null } | null>(null);
  const now = Date.now();
  const [tab, setTab] = useState<Tab>("open");
  const [range, setRange] = useState<Range>(1);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(pullError ? `تعذّر السحب من الشيت: ${pullError}` : null);
  const [draft, setDraft] = useState({ phone: "", name: "", inquiry: "", destination: "" });
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number } | null>(null);
  const nameOf = useMemo(() => new Map(team.map((e) => [e.id, e.arabic_name])), [team]);
  const dayOf = useMemo(() => new Map(leads.map((l) => [l.id, riyadhDay(l.created_at)])), [leads]);
  const receiver = (l: Lead) => nameOf.get(l.received_by ?? "") ?? l.received_by_name;

  // the daily classification: the chosen day's conversations by kind
  const ofDay = leads.filter((l) => dayOf.get(l.id) === day);
  const dayCount = (label: string) => ofDay.filter((l) => l.inquiry === label).length;
  const dayReturning = ofDay.filter((l) => l.returning).length;

  // «رؤية للإعلانات»: the chosen range
  const inRange = range === 0 ? leads : leads.filter((l) => (dayOf.get(l.id) ?? "") > shiftDay(today, -range));
  const phones = new Set(inRange.map((l) => l.phone));
  const returningPhones = new Set(inRange.filter((l) => l.returning).map((l) => l.phone));
  const withFile = inRange.filter((l) => l.file).length;
  const trend = Array.from({ length: 14 }, (_, i) => {
    const d = shiftDay(today, i - 13);
    return { day: d, count: leads.filter((l) => dayOf.get(l.id) === d).length };
  });
  const trendMax = Math.max(1, ...trend.map((t) => t.count));

  const list = leads.filter((l) => {
    if (kind && (l.inquiry !== kind || dayOf.get(l.id) !== day)) return false;
    if (returningOnly && (!l.returning || dayOf.get(l.id) !== day)) return false;
    if (tab === "open" && l.status !== "open") return false;
    if (tab === "closed" && l.status !== "closed") return false;
    if (tab === "mine" && l.assigned_to !== meId && l.received_by !== meId) return false;
    if (tab === "returning" && !l.returning) return false;
    if (!q.trim()) return true;
    const hay = [l.phone, l.name, l.inquiry, l.destination, l.file?.destination, receiver(l), l.assigned_to_name, nameOf.get(l.assigned_to ?? ""), l.contact_owner].join(" ");
    return hay.includes(q.trim());
  });
  const count = (t: Tab) =>
    t === "all" ? leads.length
    : t === "open" ? leads.filter((l) => l.status === "open").length
    : t === "closed" ? leads.filter((l) => l.status === "closed").length
    : t === "returning" ? leads.filter((l) => l.returning).length
    : leads.filter((l) => l.assigned_to === meId || l.received_by === meId).length;

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(key);
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) setError(r.error === "phone" ? "رقم الهاتف غير صحيح" : `لم يُحفظ: ${r.error ?? ""}`);
      else {
        // saved here; the sheet said no — say so, the next edit tries again
        if (r.error) setError(`حُفظ في النظام، ولم يُكتب في الشيت: ${r.error}`);
        router.refresh();
      }
      return r.ok;
    } finally {
      setBusy(null);
    }
  }
  const save = (l: Lead, patch: LeadPatch) => void run(l.id, () => updateLead(l.id, patch));
  const text = (l: Lead, field: "name" | "destination" | "done_text" | "next_action" | "contact_owner" | "result", placeholder = "") => (
    <input
      key={`${l.id}-${field}-${l[field] ?? ""}`}
      defaultValue={l[field] ?? ""}
      placeholder={placeholder}
      onBlur={(e) => e.target.value !== (l[field] ?? "") && save(l, { [field]: e.target.value })}
      className={CELL}
    />
  );

  /** «ما كتبه العميل»: the conversation from Teletel, read-only */
  async function readThread(l: Lead) {
    setThread({ lead: l, result: null });
    const result = await leadThread(l.id).catch((): LeadThread => ({ ok: false, error: "تعذّر الوصول إلى Teletel" }));
    setThread((t) => (t?.lead.id === l.id ? { lead: l, result } : t));
  }

  async function open(l: Lead) {
    if (l.file) return router.push(`/basic/${l.file.id}`);
    setBusy(`p-${l.id}`);
    const r = await startProgramme(l.id);
    setBusy(null);
    if (r.ok && r.draftId) router.push(`/basic/${r.draftId}`);
    else setError(`لم يُفتح البرنامج: ${r.error ?? ""}`);
  }

  return (
    <TraveliunShell title="nav.customers">
      <div className="tv-fade-up space-y-4">
        {/* ---------- the daily classification («اجماليات المحادثات») ---------- */}
        <section className="rounded-[16px] border border-[#d8e6e0] bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="inline-flex items-center gap-2 text-lg font-extrabold text-[#003c3a]">
              <Users className="size-5 text-[#0f7a52]" />
              العملاء والمحادثات
            </h1>
            <div className="flex items-center gap-1.5">
              <button type="button" aria-label="اليوم السابق" onClick={() => setDay(shiftDay(day, -1))} className="inline-flex size-8 items-center justify-center rounded-[8px] border border-[#cfe0d9] text-[#185045] hover:bg-[#f4f8f6]">
                <ChevronRight className="size-4" />
              </button>
              <input type="date" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} className={`${CELL} w-36`} />
              <button type="button" aria-label="اليوم التالي" disabled={day >= today} onClick={() => setDay(shiftDay(day, 1))} className="inline-flex size-8 items-center justify-center rounded-[8px] border border-[#cfe0d9] text-[#185045] hover:bg-[#f4f8f6] disabled:opacity-40">
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void run("pull", pullLeadsNow)}
                className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-[8px] border border-[#cfe0d9] px-3 text-[12px] font-bold text-[#185045] hover:bg-[#f4f8f6] disabled:opacity-60"
              >
                {busy === "pull" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                {live ? "تحديث الآن" : "تحديث من الشيت"}
              </button>
            </div>
          </div>
          <p className="mt-1 text-[12px] font-semibold text-[#78948f]">
            {live
              ? "تلقائي بالكامل: كل محادثة واتساب في Teletel تظهر هنا وحدها كل ٥ دقائق — اسم العميل ورقمه، الموظف، التاريخ، نوع الطلب والدولة من كلامه، وتُغلق حين تُغلق هناك."
              : twoWay
                ? "متزامن مع شيت المحادثات في الاتجاهين: ما يُكتب هناك يظهر هنا، وما يُسجَّل هنا يُكتب هناك."
                : "ما يُسجَّل في شيت المحادثات يظهر هنا وحده."}
          </p>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5 xl:grid-cols-10">
            <div className="rounded-[10px] border border-[#cfe0d9] bg-[#f6f9f8] px-2 py-2 text-center">
              <div className="text-[11px] font-extrabold text-[#557d78]">محادثات {day === today ? "اليوم" : day}</div>
              <div className="tv-tnum text-xl font-extrabold text-[#003c3a]">{ofDay.length}</div>
            </div>
            {INQUIRIES.map((i) => (
              <button
                key={i.label}
                type="button"
                aria-pressed={kind === i.label}
                onClick={() => setKind(kind === i.label ? null : i.label)}
                className={`rounded-[10px] px-2 py-2 text-center ${kind === i.label ? "ring-2 ring-[#003c3a] ring-offset-1" : ""}`}
                style={{ background: i.color, color: i.ink }}
              >
                <div className="text-[11px] font-extrabold">{i.label}</div>
                <div className="tv-tnum text-xl font-extrabold">{dayCount(i.label)}</div>
              </button>
            ))}
            <button
              type="button"
              aria-pressed={returningOnly}
              onClick={() => setReturningOnly(!returningOnly)}
              title="كتب من قبل: محادثته السابقة أُغلقت أو مضى عليها أكثر من 24 ساعة"
              className={`rounded-[10px] px-2 py-2 text-center ${returningOnly ? "ring-2 ring-[#003c3a] ring-offset-1" : ""}`}
              style={{ background: RETURNING.color, color: RETURNING.ink }}
            >
              <div className="text-[11px] font-extrabold">عميل سابق</div>
              <div className="tv-tnum text-xl font-extrabold">{dayReturning}</div>
            </button>
          </div>
          {kind ? <p className="mt-1.5 text-[11.5px] font-semibold text-[#78948f]">الجدول يعرض «{kind}» ليوم {day} — اضغط الخانة مرة أخرى للإلغاء.</p> : null}
          {returningOnly ? <p className="mt-1.5 text-[11.5px] font-semibold text-[#78948f]">الجدول يعرض «عميل سابق» ليوم {day} — اضغط الخانة مرة أخرى للإلغاء.</p> : null}
        </section>

        {/* ---------- «رؤية للإعلانات» ---------- */}
        <section className="rounded-[16px] border border-[#d8e6e0] bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="inline-flex items-center gap-2 text-[15px] font-extrabold text-[#003c3a]">
              <BarChart3 className="size-4 text-[#0f7a52]" />
              رؤية للإعلانات
            </h2>
            <div className="flex flex-wrap gap-1.5">
              {RANGES.map(([r, label]) => (
                <button key={r} type="button" onClick={() => setRange(r)} className={`h-7 rounded-full px-3 text-[11.5px] font-bold ${range === r ? "bg-[#185045] text-white" : "border border-[#cfe0d9] text-[#185045]"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-5">
            {[
              ["عدد العملاء", phones.size],
              ["عدد المحادثات", inRange.length],
              ["عملاء جدد", phones.size - returningPhones.size],
              ["عملاء سابقون", returningPhones.size],
              ["تحوّلت إلى برنامج", `${inRange.length ? Math.round((withFile / inRange.length) * 100) : 0}%`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-[12px] border border-[#e3ece8] bg-[#f8fbfa] p-3">
                <div className="text-[11px] font-extrabold text-[#78948f]">{label}</div>
                <div className="tv-tnum text-2xl font-extrabold text-[#003c3a]">{value}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Bars title="الدول الأكثر طلباً" rows={top(inRange, (l) => l.file?.destination || l.destination)} />
            <Bars title="نوع الاستفسار" rows={top(inRange, (l) => l.inquiry, 10)} tone={(label) => TONE.get(label)?.color} />
            <Bars title="المستلم" rows={top(inRange, receiver)} tone={() => "#2f7fc0"} />
            <Bars title="ما تم مع العميل" rows={top(inRange, (l) => l.result || l.sent_status)} tone={() => "#a86a10"} />
          </div>
          <div className="mt-3 rounded-[12px] border border-[#e3ece8] p-3">
            <h3 className="mb-2 text-[12px] font-extrabold text-[#185045]">المحادثات يومياً — آخر 14 يوماً</h3>
            <div className="flex h-28 items-end gap-1" dir="ltr">
              {trend.map((t) => (
                <button key={t.day} type="button" title={`${t.day}: ${t.count}`} onClick={() => setDay(t.day)} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                  <span className="tv-tnum text-[10px] font-bold text-[#557d78]">{t.count || ""}</span>
                  <span className={`w-full rounded-t-[4px] ${t.day === day ? "bg-[#003c3a]" : "bg-[#0f7a52]/70"}`} style={{ height: `${(t.count / trendMax) * 100}%`, minHeight: t.count ? 4 : 1 }} />
                  <span className="tv-tnum text-[9.5px] font-semibold text-[#93aaa3]">{t.day.slice(8)}</span>
                </button>
              ))}
            </div>
          </div>
          <h3 className="mt-4 text-[13px] font-extrabold text-[#003c3a]">أداء الموظفين</h3>
          <p className="text-[11px] font-semibold text-[#93aaa3]">
            لكل موظف: كم محادثة وصلته، وكم احتاج حتى ردّ عليها، وكم احتاج حتى أسندها لغيره — من سجل الإسناد في Teletel، للمدة المختارة أعلاه.
          </p>
          <Performance rows={inRange} />
          <p className="mt-2 text-[11px] font-semibold text-[#93aaa3]">
            {live ? "يوم المحادثة يوم بدئها في واتساب" : "يوم المحادثة يوم وصولها إلى النظام (الشيت لا يحمل تاريخاً)"}، والدولة من البرنامج المصدَر إن وُجد وإلا من خانة الدولة.
          </p>
        </section>

        {/* ---------- a new conversation, and the conversations ---------- */}
        <section className="rounded-[16px] border border-[#d8e6e0] bg-white p-3 sm:p-4">
          <form
            className="grid gap-2 sm:grid-cols-[10rem_minmax(0,1fr)_9rem_minmax(0,1fr)_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              void run("add", () => addLead(draft)).then((ok) => ok && setDraft({ phone: "", name: "", inquiry: "", destination: "" }));
            }}
          >
            <input required inputMode="tel" placeholder={HEADERS.phone} value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} className={CELL} />
            <input placeholder="اسم العميل" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={CELL} />
            <select value={draft.inquiry} onChange={(e) => setDraft({ ...draft, inquiry: e.target.value })} className={CELL}>
              <option value="">{HEADERS.inquiry}</option>
              {INQUIRIES.map((i) => <option key={i.label}>{i.label}</option>)}
            </select>
            <input placeholder={HEADERS.destination} value={draft.destination} onChange={(e) => setDraft({ ...draft, destination: e.target.value })} className={CELL} />
            <button type="submit" disabled={busy !== null} className="inline-flex h-8 items-center justify-center gap-1 rounded-[8px] bg-[#185045] px-3 text-[12px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60">
              {busy === "add" ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
              تسجيل محادثة
            </button>
          </form>
          {error ? <p className="mt-2 text-[12px] font-bold text-[#c22850]">{error}</p> : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {TABS.map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={`h-8 rounded-full px-3 text-[12px] font-bold ${tab === k ? "bg-[#185045] text-white" : "border border-[#cfe0d9] text-[#185045] hover:bg-[#f4f8f6]"}`}
              >
                {label} <span className="tv-tnum opacity-70">{count(k)}</span>
              </button>
            ))}
            <label className="relative ms-auto w-full sm:w-64">
              <Search className="pointer-events-none absolute start-2 top-2 size-4 text-[#93aaa3]" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث: رقم، اسم، دولة، موظف" className={`${CELL} ps-8`} />
            </label>
          </div>

          {/* the table is wider than the screen: arrows, or drag it with the mouse; the name stays in place */}
          <div className="mt-3 flex items-center justify-end gap-1.5">
            <span className="me-auto text-[11px] font-semibold text-[#93aaa3]">اسحب الجدول بالماوس أو استخدم الأسهم لرؤية بقية الأعمدة</span>
            {([
              ["الأعمدة السابقة", -1, <ChevronRight key="r" className="size-4" />],
              ["الأعمدة التالية", 1, <ChevronLeft key="l" className="size-4" />],
            ] as const).map(([label, step, icon]) => (
              <button
                key={label}
                type="button"
                aria-label={label}
                title={label}
                // the next columns lie to the left in Arabic, to the right in English
                onClick={() => scroller.current?.scrollBy({ left: step * 480 * (getComputedStyle(scroller.current).direction === "rtl" ? -1 : 1), behavior: "smooth" })}
                className="inline-flex size-8 items-center justify-center rounded-[8px] border border-[#cfe0d9] text-[#185045] hover:bg-[#f4f8f6]"
              >
                {icon}
              </button>
            ))}
          </div>
          <div
            ref={scroller}
            className="mt-1.5 max-h-[70vh] cursor-grab overflow-auto active:cursor-grabbing"
            onPointerDown={(e) => {
              // a drag on the table moves it; a press on a field or a button is still a press
              if ((e.target as HTMLElement).closest("input, select, button, a, textarea") || !scroller.current) return;
              e.preventDefault(); // no text selection while dragging
              drag.current = { x: e.clientX, left: scroller.current.scrollLeft };
            }}
            onPointerMove={(e) => {
              if (!drag.current || !scroller.current) return;
              scroller.current.scrollLeft = drag.current.left - (e.clientX - drag.current.x);
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerLeave={() => (drag.current = null)}
          >
            <table className="w-full min-w-[2650px] border-separate border-spacing-y-1 text-start text-[12px]">
              <thead className="sticky top-0 z-20 bg-white text-[10.5px] font-extrabold text-[#78948f]">
                <tr className="[&>th]:px-2 [&>th]:py-1 [&>th]:text-start">
                  {/* the owner's order (2026-10-18); the three times are computed, never typed */}
                  <th className="sticky start-0 z-10 bg-white">اسم العميل</th>
                  <th>رقم العميل</th>
                  <th>{HEADERS.received_by}</th>
                  <th title="من أول رسالة للعميل حتى أول رد منّا">تأخير أول رد</th>
                  <th>{HEADERS.inquiry}</th>
                  <th>{HEADERS.destination}</th>
                  <th>{HEADERS.assigned_to}</th>
                  <th title="من أول رسالة للعميل حتى إسنادها لشخص آخر">كم احتاجت حتى أُسندت</th>
                  <th title="من الإسناد حتى أول رد من الشخص المُسنَد إليه">كم الوقت حتى استلمها الشخص الآخر</th>
                  <th title="كل موظف وصلته المحادثة بالترتيب: متى ردّ ومتى أسندها">مسار المحادثة</th>
                  <th>ماذا أُرسل للعميل؟</th>
                  <th>ماذا تم للعميل</th>
                  <th>{HEADERS.status}</th>
                  <th>{HEADERS.next_action}</th>
                  <th>{HEADERS.contact_owner}</th>
                  <th>{HEADERS.result}</th>
                  <th>البرنامج</th>
                </tr>
              </thead>
              <tbody>
                {list.map((l) => {
                  const tone = TONE.get(l.inquiry ?? "");
                  const times = timing(l, now);
                  return (
                    <tr key={l.id} className={`[&>td]:px-2 [&>td]:py-1.5 ${l.status === "closed" ? "bg-[#f5f7fa] text-[#78948f]" : "bg-[#f8fbfa]"}`}>
                      <td className="sticky start-0 z-10 w-44 min-w-[11rem] rounded-s-[10px] border-s-4 bg-inherit" style={{ borderInlineStartColor: tone?.color ?? "#cfe0d9" }}>
                        {text(l, "name", "اسم العميل")}
                      </td>
                      <td className="min-w-[10rem]">
                        <span className="inline-flex items-center gap-1">
                          <a href={`https://wa.me/${l.phone}`} target="_blank" rel="noreferrer" aria-label="واتساب" title="واتساب" className="text-[#0f7a52]">
                            <MessageCircle className="size-3" />
                          </a>
                          {/* the number opens what the client wrote, from Teletel */}
                          <button type="button" onClick={() => void readThread(l)} title="عرض المحادثة من Teletel" className="font-semibold text-[#0f7a52] hover:underline">
                            <DirText>{l.phone}</DirText>
                          </button>
                        </span>
                        <span className="block text-[10px] font-semibold text-[#93aaa3]">
                          <DirText>{dayOf.get(l.id)}</DirText>
                          {l.returning ? (
                            <span className="ms-1 rounded-full px-1.5 font-bold" style={{ background: RETURNING.color, color: RETURNING.ink }}>
                              عميل سابق{l.returning_since ? <> · <DirText>{l.returning_since.slice(0, 10)}</DirText></> : null}
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="w-28 truncate font-semibold">{receiver(l) ?? "—"}</td>
                      <td className="w-28"><Timing value={times.firstReply} /></td>
                      <td className="w-32">
                        <select value={l.inquiry ?? ""} onChange={(e) => save(l, { inquiry: e.target.value })} className={CELL} style={tone ? { background: tone.color, color: tone.ink } : undefined}>
                          <option value="">—</option>
                          {[...new Set([...INQUIRIES.map((i) => i.label), l.inquiry ?? ""])].filter(Boolean).map((i) => <option key={i}>{i}</option>)}
                        </select>
                      </td>
                      <td className="min-w-[9rem]">{text(l, "destination")}</td>
                      <td className="w-40">
                        <select value={l.assigned_to ?? ""} onChange={(e) => save(l, { assigned_to: e.target.value })} className={CELL}>
                          <option value="">{l.assigned_to_name ? `${l.assigned_to_name} (من الشيت)` : "لم يتم الإسناد"}</option>
                          {team.map((e) => <option key={e.id} value={e.id}>{e.arabic_name}</option>)}
                        </select>
                      </td>
                      <td className="w-32"><Timing value={times.toAssign} /></td>
                      <td className="w-36"><Timing value={times.assigneeReply} /></td>
                      <td className="min-w-[14rem]"><Turns l={l} now={now} /></td>
                      <td className="w-40">
                        <select value={l.sent_status ?? ""} onChange={(e) => save(l, { sent_status: e.target.value })} className={CELL}>
                          <option value="">لم يُرسل شيء</option>
                          {[...new Set([...SENT, l.sent_status ?? ""])].filter(Boolean).map((s) => <option key={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="min-w-[10rem]">{text(l, "done_text")}</td>
                      <td className="w-28">
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => save(l, { status: l.status === "open" ? "closed" : "open" })}
                          className={`h-8 w-full rounded-[8px] text-[11.5px] font-bold ${l.status === "open" ? "bg-[#2f7fc0] text-white hover:bg-[#256aa3]" : "border border-[#cfe0d9] bg-white text-[#557d78]"}`}
                        >
                          {l.status === "open" ? "مفتوحة · أغلق" : "مغلقة · افتح"}
                        </button>
                      </td>
                      <td className="min-w-[9rem]">{text(l, "next_action")}</td>
                      <td className="w-32">{text(l, "contact_owner")}</td>
                      <td className="min-w-[9rem]">{text(l, "result")}</td>
                      <td className="w-36 rounded-e-[10px]">
                        {/* the programme made for the client classifies them: «ماليزيا» */}
                        <button
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void open(l)}
                          className={`inline-flex h-8 w-full items-center justify-center gap-1 rounded-[8px] px-2 text-[11.5px] font-bold ${l.file ? "border border-[#bfe5d4] bg-[#e9f7f0] text-[#0f7a52]" : "bg-[#185045] text-white hover:bg-[#0f4439]"}`}
                        >
                          {busy === `p-${l.id}` ? <Loader2 className="size-3.5 animate-spin" /> : null}
                          {l.file ? l.file.destination || "فتح البرنامج" : "ابدأ برنامج"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {list.length === 0 ? <p className="py-8 text-center text-[12px] font-semibold text-[#93aaa3]">لا محادثات هنا.</p> : null}
          </div>
          <p className="mt-2 text-[11px] font-semibold text-[#93aaa3]">
            {list.length} من {leads.length}
          </p>
        </section>
      </div>

      <Dialog open={thread !== null} onOpenChange={(v) => !v && setThread(null)}>
        <DialogContent className="max-h-[calc(85vh/var(--tv-zoom))] max-w-[560px] overflow-y-auto" showClose={false}>
          <div className="mb-3 flex items-center justify-between gap-2 border-b border-[#e1e9e5] pb-3">
            <h2 className="text-base font-extrabold text-[#003c3a]">
              {thread?.lead.name || "العميل"} · <DirText>{thread?.lead.phone}</DirText>
            </h2>
            <button type="button" aria-label="إغلاق" onClick={() => setThread(null)} className="rounded-md p-2 text-[#557d78] hover:bg-[#edf3f0]">
              <X className="size-5" />
            </button>
          </div>
          {!thread?.result ? (
            <p className="flex items-center justify-center gap-2 py-10 text-sm font-bold text-[#557d78]">
              <Loader2 className="size-4 animate-spin" /> جاري جلب المحادثة من Teletel…
            </p>
          ) : !thread.result.ok ? (
            <p className="rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] px-3 py-3 text-[13px] font-bold text-[#c22850]">{thread.result.error}</p>
          ) : (
            <>
              <ul className="space-y-2">
                {thread.result.messages.length === 0 ? <li className="py-6 text-center text-[12px] font-semibold text-[#93aaa3]">لا رسائل</li> : null}
                {thread.result.messages.map((m) => (
                  <li key={m.id} className={`flex ${m.fromClient ? "justify-start" : "justify-end"}`}>
                    <div
                      className={`max-w-[85%] rounded-[12px] px-3 py-2 text-[12.5px] leading-6 ${
                        m.isPrivate ? "border border-dashed border-[#e6d39a] bg-[#fffbea] text-[#6b5a1e]" : m.fromClient ? "bg-[#f1f5f4] text-[#0f3d38]" : "bg-[#e3f3ec] text-[#0f3d38]"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{m.text || "—"}</p>
                      <p className="mt-1 text-[10px] font-semibold text-[#93aaa3]">
                        {m.fromClient ? "العميل" : m.isPrivate ? `ملاحظة داخلية · ${m.sender ?? ""}` : (m.sender ?? "نحن")} ·{" "}
                        <DirText>{new Date(m.at * 1000).toLocaleString("en-GB", { timeZone: "Asia/Riyadh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</DirText>
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
              {thread.result.link ? (
                <a href={thread.result.link} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-[12px] font-bold text-[#185045] hover:underline">
                  فتح في Teletel <ExternalLink className="size-3.5" />
                </a>
              ) : null}
            </>
          )}
        </DialogContent>
      </Dialog>
    </TraveliunShell>
  );
}
