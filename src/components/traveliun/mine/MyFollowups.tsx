"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, Check, Clock, ExternalLink, NotebookPen, Settings, UserRound } from "lucide-react";
import { markMyDone, remindMe, saveMyNote, saveMySettings, type MyFollowupItem, type MyFollowupsView } from "@/lib/data/my-followups";
import { dayCounts, KIND_LABEL, KIND_ORDER, type DayKind, type DaySettings } from "@/lib/mine/rank";
import { NEXT_LABEL } from "@/lib/followups/summary-core";
import { btn, btnPrimary, card, field, HeatChip, since } from "@/components/traveliun/followups/followup-ui";

/** «متابعتي» — the seller's own list for today, the follow-up page's look (white cards on #F4F6F3). */

const KIND_TONE: Record<DayKind, string> = {
  waiting: "bg-[#E7EEFB] text-[#1D4ED8]",
  silent: "bg-[#F1F5F9] text-slate-700",
  hot: "bg-[#FCE9E1] text-[#9A3412]",
  offer: "bg-[#E4F0EA] text-[#185045]",
  reminder: "bg-[#FBF1D6] text-[#5C4300]",
};
const SINCE_WORD: Record<DayKind, string> = { waiting: "ينتظر منذ", silent: "آخر رسالة منك قبل", hot: "آخر نشاط قبل", offer: "مستحقة منذ", reminder: "حان موعده منذ" };
const ERRORS: Record<string, string> = { forbidden: "لا تملك هذا الإجراء.", bad_date: "اختر موعداً خلال الشهرين القادمين.", empty: "اكتب نص التذكير.", failed: "تعذّر الحفظ، أعد المحاولة." };
const PAGE = 20;

const iso = (ms: number) => new Date(ms).toISOString();
/** 09:00 Riyadh tomorrow */
function tomorrowMorning(now = Date.now()): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(now + 86_400_000);
  return new Date(`${day}T09:00:00+03:00`).toISOString();
}
/** a datetime-local value (Riyadh wall clock) to ISO */
const fromLocal = (v: string) => (v ? new Date(`${v}:00+03:00`).toISOString() : "");

export function MyFollowups({ view }: { view: MyFollowupsView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState<DayKind | null>(null);
  const [more, setMore] = useState<Set<DayKind>>(new Set());
  const [showSettings, setShowSettings] = useState(false);
  const [newReminder, setNewReminder] = useState(false);
  // the page's clock: when the server read the list (router.refresh() brings a new one) — the same text on both sides
  const now = view.at;
  const counts = useMemo(() => dayCounts(view.items), [view.items]);

  const run = (task: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await task().catch(() => ({ ok: false, error: "failed" }));
      setNotice(r.ok ? ok : (ERRORS[r.error ?? "failed"] ?? ERRORS.failed));
      if (r.ok) router.refresh();
    });

  const kinds = KIND_ORDER.filter((k) => counts[k] && (!filter || filter === k));
  return (
    <div dir="rtl" className="space-y-4 rounded-3xl bg-[#F4F6F3] p-2 text-[#12332c] sm:p-3">
      <section className={`${card} flex flex-wrap items-center justify-between gap-4 p-5`}>
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-extrabold">
            <UserRound /> متابعتي{view.readOnly ? ` — ${view.name}` : ""}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {view.readOnly ? "قائمة الموظف كما يراها، للاطلاع فقط." : "ما عليك اليوم من محادثاتك أنت فقط، الأهم أولاً."} {counts.total ? `${counts.total} عميل/تذكير` : ""}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {KIND_ORDER.map((k) => (
              <button
                key={k}
                onClick={() => setFilter(filter === k ? null : k)}
                className={`rounded-full px-3 py-1.5 text-xs font-extrabold ${KIND_TONE[k]} ${filter === k ? "ring-2 ring-[#185045]" : ""} ${counts[k] ? "" : "opacity-40"}`}
              >
                {KIND_LABEL[k]} · {counts[k]}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {view.team && (
            <select className={`${field} w-auto min-h-11`} value={view.employeeId} onChange={(e) => router.push(`/my-followups?employee=${e.target.value}`)} aria-label="متابعة موظف">
              {!view.people.some((p) => p.id === view.employeeId) && <option value={view.employeeId}>{view.name || "أنا"}</option>}
              {view.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          {view.board && (
            <Link href="/my-followups/team" className={btn}>
              لوحة الفريق
            </Link>
          )}
          {!view.readOnly && (
            <>
              <button className={btn} onClick={() => setNewReminder(!newReminder)}>
                <Bell size={16} /> تذكير جديد
              </button>
              <button className={btn} onClick={() => setShowSettings(!showSettings)} aria-label="إعدادات التذكير">
                <Settings size={16} /> الإعدادات
              </button>
            </>
          )}
        </div>
      </section>

      {!view.teletel && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">تعذّر الوصول إلى تيلي تيل الآن: تظهر متابعات العروض والتذكيرات فقط.</p>}
      {notice && (
        <p role="status" className="rounded-xl bg-[#EEF5F1] p-3 text-sm text-[#185045]">
          {notice}
        </p>
      )}
      {showSettings && !view.readOnly && <SettingsPanel settings={view.settings} busy={pending} onSave={(s) => run(() => saveMySettings(s), "حُفظت إعداداتك.")} />}
      {newReminder && !view.readOnly && (
        <ReminderForm
          busy={pending}
          onSave={(dueAt, text) => {
            setNewReminder(false);
            run(() => remindMe({ conversationId: null, dueAt, text }), "سأذكّرك في موعده.");
          }}
        />
      )}

      {!counts.total && <section className={`${card} p-8 text-center text-slate-600`}>لا شيء عليك الآن. أحسنت 👏</section>}

      {kinds.map((k) => {
        const list = view.items.filter((i) => i.kind === k);
        const shown = more.has(k) ? list : list.slice(0, PAGE);
        return (
          <section key={k} className="space-y-2">
            <h2 className="flex items-center gap-2 px-1 text-sm font-extrabold">
              <span className={`rounded-full px-2.5 py-0.5 ${KIND_TONE[k]}`}>{KIND_LABEL[k]}</span>
              <span className="text-slate-500">{list.length}</span>
            </h2>
            <div className="grid gap-2 lg:grid-cols-2">
              {shown.map((i) => (
                <ItemCard key={i.key} item={i} now={now} readOnly={view.readOnly} busy={pending} run={run} />
              ))}
            </div>
            {list.length > shown.length && (
              <button className={btn} onClick={() => setMore(new Set([...more, k]))}>
                عرض الكل ({list.length})
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ItemCard({ item: i, now, readOnly, busy, run }: { item: MyFollowupItem; now: number; readOnly: boolean; busy: boolean; run: (task: () => Promise<{ ok: boolean; error?: string }>, ok: string) => void }) {
  const [panel, setPanel] = useState<"" | "later" | "note">("");
  const [note, setNote] = useState(i.note ?? "");
  const [at, setAt] = useState("");
  const later = (dueAt: string) => {
    setPanel("");
    run(() => remindMe({ conversationId: i.conversationId, dueAt, text: i.reminder?.text ?? "", doneKey: i.reminder ? i.key : undefined }), "سأذكّرك في موعده.");
  };
  return (
    <article className={`${card} space-y-1.5 p-3.5`}>
      <div className="flex items-start justify-between gap-2">
        <span className="font-extrabold text-[#12332c]">{i.name}</span>
        <span className="flex shrink-0 flex-wrap justify-end gap-1">
          <HeatChip heat={i.heat ?? undefined} />
          {i.tags.map((t) => (
            <span key={t} className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${KIND_TONE[t]}`}>
              {KIND_LABEL[t]}
            </span>
          ))}
        </span>
      </div>
      {i.reminder && <p className="text-sm font-bold text-[#5C4300]">⏰ {i.reminder.text || "ذكّرني بهذا العميل"}</p>}
      {i.since !== null && (
        <p className="text-xs text-slate-500">
          {SINCE_WORD[i.kind]} {since(iso(i.since), now)}
        </p>
      )}
      {(i.destination || i.offerLine) && <p className="truncate text-sm text-slate-700">{[i.destination, i.offerLine].filter(Boolean).join(" · ")}</p>}
      {i.wants || i.next ? (
        <p className="rounded-xl bg-[#EEF5F1] p-2.5 text-sm">
          {i.wants && <span className="block text-slate-700">أراد: {i.wants}</span>}
          {i.next && (
            <b className="text-[#185045]">
              المقترح: {NEXT_LABEL[i.next]}
              {i.advice ? ` — ${i.advice}` : ""}
            </b>
          )}
        </p>
      ) : (
        i.conversationId !== null && <p className="text-xs text-slate-400">لم يقرأ مُراد هذه المحادثة بعد.</p>
      )}
      {i.preview && <p className="truncate text-xs text-slate-500">آخر رسالة: {i.preview}</p>}
      {i.note && panel !== "note" && <p className="text-xs text-slate-600">📝 {i.note}</p>}
      {i.canReply === false && <p className="text-xs text-[#9A3412]">مرّ أكثر من ٢٤ ساعة على آخر رسالة من العميل: لا يصله إلا قالب معتمد أو اتصال.</p>}

      <div className="flex flex-wrap gap-2 pt-1">
        {i.url && (
          <a href={i.url} target="_blank" rel="noreferrer" className={btnPrimary}>
            <ExternalLink size={15} /> فتح في تيلي تيل
          </a>
        )}
        {i.followupId && (
          <Link href={`/followups/${i.followupId}`} className={btn}>
            افتح المتابعة
          </Link>
        )}
        {!readOnly && (
          <>
            <button className={btn} disabled={busy} onClick={() => run(() => markMyDone(i.key), "أُزيل من قائمتك حتى يجدّ جديد.")}>
              <Check size={15} /> تمّت
            </button>
            {i.conversationId !== null && (
              <button className={btn} onClick={() => setPanel(panel === "later" ? "" : "later")}>
                <Clock size={15} /> ذكّرني بعد…
              </button>
            )}
            {i.conversationId !== null && (
              <button className={btn} onClick={() => setPanel(panel === "note" ? "" : "note")}>
                <NotebookPen size={15} /> ملاحظة
              </button>
            )}
          </>
        )}
      </div>
      {panel === "later" && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[#F8FAF8] p-2">
          <button className={btn} disabled={busy} onClick={() => later(iso(Date.now() + 3600_000))}>
            بعد ساعة
          </button>
          <button className={btn} disabled={busy} onClick={() => later(iso(Date.now() + 3 * 3600_000))}>
            بعد ٣ ساعات
          </button>
          <button className={btn} disabled={busy} onClick={() => later(tomorrowMorning())}>
            غداً صباحاً
          </button>
          <input type="datetime-local" className={`${field} w-auto`} value={at} onChange={(e) => setAt(e.target.value)} aria-label="موعد التذكير" />
          <button className={btnPrimary} disabled={busy || !at} onClick={() => later(fromLocal(at))}>
            ذكّرني
          </button>
        </div>
      )}
      {panel === "note" && i.conversationId !== null && (
        <div className="space-y-2 rounded-xl bg-[#F8FAF8] p-2">
          <textarea className={field} rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="ملاحظة لك وحدك عن هذا العميل" />
          <button
            className={btnPrimary}
            disabled={busy}
            onClick={() => {
              setPanel("");
              run(() => saveMyNote(i.conversationId as number, note), "حُفظت الملاحظة.");
            }}
          >
            حفظ الملاحظة
          </button>
        </div>
      )}
    </article>
  );
}

function ReminderForm({ busy, onSave }: { busy: boolean; onSave: (dueAt: string, text: string) => void }) {
  const [text, setText] = useState("");
  const [at, setAt] = useState("");
  return (
    <section className={`${card} flex flex-wrap items-end gap-2 p-4`}>
      <label className="min-w-60 flex-1 text-xs font-bold">
        ذكّرني بـ
        <input className={`${field} mt-1`} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder="مثال: الاتصال بعميل ماليزيا" />
      </label>
      <label className="text-xs font-bold">
        الموعد
        <input type="datetime-local" className={`${field} mt-1`} value={at} onChange={(e) => setAt(e.target.value)} />
      </label>
      <button className={btnPrimary} disabled={busy || !text.trim() || !at} onClick={() => onSave(fromLocal(at), text)}>
        حفظ التذكير
      </button>
    </section>
  );
}

function SettingsPanel({ settings, busy, onSave }: { settings: DaySettings; busy: boolean; onSave: (s: DaySettings) => void }) {
  const [s, setS] = useState(settings);
  const num = (key: keyof DaySettings, label: string, min: number, max: number, unit: string) => (
    <label className="text-xs font-bold">
      {label}
      <span className="mt-1 flex items-center gap-2">
        <input type="number" min={min} max={max} className={`${field} w-24`} value={s[key]} onChange={(e) => setS({ ...s, [key]: Number(e.target.value) })} />
        <span className="font-normal text-slate-500">{unit}</span>
      </span>
    </label>
  );
  return (
    <section className={`${card} space-y-3 p-4`}>
      <h2 className="font-extrabold">إعدادات تذكيراتي</h2>
      <div className="flex flex-wrap gap-4">
        {num("silentHours", "أظهر العميل الساكت بعد", 1, 336, "ساعة من آخر رسالة مني")}
        {num("waitMinutes", "ذكّرني إذا انتظر عميل أكثر من", 5, 120, "دقيقة")}
        {num("repeatMinutes", "وكرّر التذكير مرة واحدة بعد", 10, 180, "دقيقة (العميل الساخن يُذكَّر به بعد 5 دقائق)")}
        {num("quietFrom", "ساعات الهدوء من الساعة", 0, 23, "")}
        {num("quietTo", "إلى الساعة", 0, 23, "(لا رسائل من البوت بينهما)")}
      </div>
      <button className={btnPrimary} disabled={busy} onClick={() => onSave(s)}>
        حفظ الإعدادات
      </button>
    </section>
  );
}
