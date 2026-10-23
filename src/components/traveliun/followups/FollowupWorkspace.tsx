"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, BellRing, CalendarClock, ExternalLink, FileText, Loader2, MessageCircle, Phone, RefreshCw, Search, Send, Sparkles, Zap } from "lucide-react";
import { claimFollowup, assignWork, getFollowupWorkspace, getWorkDetail, recordFollowupResult, refreshFollowupSync, remakeSummary, reviewFollowupSend, sendFollowupReply, type FollowupWorkspaceData, type WorkDetail } from "@/lib/data/followups";
import { duplicateDraft } from "@/lib/data/drafts";
import { CLOSE_REASONS, handlerOf, isOldIntake, offerLine, OUTCOMES, readable, todayGroup, type TodayGroup, type WorkResult, type WorkRow } from "@/lib/followups/rules";
import { NEXT_LABEL } from "@/lib/followups/summary-core";
import { btn, btnPrimary, card, errors, field, GROUP, HeatChip, isToday, Row, since, StepChips, StepLabel, when } from "./followup-ui";
import { ArchiveReview, ManagerBoard, QuickFollowup } from "./FollowupViews";

type Tab = "today" | "all" | "closed";
type Filter = "all" | "hot" | "replied";
type View = "list" | "quick" | "review" | "board";
const HEAT_RANK = { hot: 0, warm: 1, cold: 2 } as const;

/** Mine to act on today: the viewer's own files (a manager: everyone's), day seven going to whoever the setting names. */
export function mineToday(data: FollowupWorkspaceData, now: number) {
  const mine = (r: WorkRow) => {
    if (data.manager) return true;
    const h = handlerOf(r, data.settings);
    return h === data.employeeId || (h === null && data.claim);
  };
  return data.rows.filter((r) => mine(r) && todayGroup(r, now));
}
function listFor(rows: WorkRow[], tab: Tab, now: number) {
  if (tab === "closed") return rows.filter((r) => r.status === "done").sort((a, b) => Date.parse(b.done_at ?? "") - Date.parse(a.done_at ?? ""));
  if (tab === "all") return rows.filter((r) => r.status === "open");
  return rows.filter((r) => todayGroup(r, now));
}

/**
 * «المتابعة» (the owner's approved mockup, 2026-10-23): today's files in three
 * groups — the client wrote back, due today, late — each with Murad's summary,
 * his suggested message, and one press for what happened; the quick round on a
 * phone, the old list's review, and the managers' board beside it.
 */
export function FollowupWorkspace({ initial, initialId }: { initial: FollowupWorkspaceData; initialId?: string }) {
  const [data, setData] = useState(initial);
  const [view, setView] = useState<View>("list");
  const [tab, setTab] = useState<Tab>(() => {
    const row = initial.rows.find((r) => r.id === initialId);
    return !row ? "today" : row.status === "done" ? "closed" : todayGroup(row, Date.now()) ? "today" : "all";
  });
  const [filter, setFilter] = useState<Filter>("all");
  const [focus, setFocus] = useState<{ ids: string[]; label: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(initialId ?? null);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(60);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const refresh = useCallback(async () => {
    const updated = await getFollowupWorkspace();
    if (updated) { setData(updated); setNow(Date.now()); }
    else { setNotice("انتهت صلاحية الوصول إلى المتابعة."); setSelected(null); }
  }, []);
  useEffect(() => {
    const timer = setInterval(() => { void refresh().catch(() => setNotice("تعذر التحديث؛ البيانات الظاهرة آخر نسخة ناجحة.")); }, 60000);
    return () => clearInterval(timer);
  }, [refresh]);
  const name = (id: string | null) => data.people.find((p) => p.id === id)?.name ?? null;
  const today = mineToday(data, now);
  const handled = data.rows.filter((r) => (data.manager || r.assigned_to === data.employeeId) && isToday(r.last_attempt_at, now));
  const doneToday = handled.filter((r) => !today.includes(r)).length;
  const goal = doneToday + today.length;
  const q = search.trim();
  let rows = focus ? data.rows.filter((r) => focus.ids.includes(r.id)) : tab === "today" ? today : listFor(data.rows, tab, now);
  if (filter === "replied") rows = rows.filter((r) => r.client_waiting);
  if (filter === "hot") rows = [...rows].sort((a, b) => HEAT_RANK[a.summary?.heat ?? "cold"] - HEAT_RANK[b.summary?.heat ?? "cold"]);
  if (q) rows = rows.filter((r) => `${r.contact_name} ${r.contact_phone} ${r.conversation_id} ${r.destination ?? ""} ${r.offer_line ?? ""}`.includes(q));
  const selectedRow = data.rows.find((r) => r.id === selected);
  async function sync() {
    setBusy(true);
    try { const result = await refreshFollowupSync(); setNotice(result.ok ? "اكتملت المزامنة." : errors[result.error] ?? result.error); await refresh(); }
    catch { setNotice(errors.failed); } finally { setBusy(false); }
  }
  const open = (id: string) => { setView("list"); setFocus(null); setSelected(id); setTab(data.rows.find((r) => r.id === id)?.status === "done" ? "closed" : "all"); };
  const fileCard = (r: WorkRow) => {
    const s = r.summary;
    const faded = isToday(r.last_attempt_at, now) && !r.client_waiting;
    // the first files kept only the client's line; ours read like the offer line
    const byClient = r.last_line ? r.last_by === "client" : true;
    const line = byClient ? readable(r.last_line ?? r.client_line) : offerLine(r.last_line ?? "") || r.last_line;
    return <button key={r.id} onClick={() => setSelected(r.id)} className={`w-full rounded-2xl border p-3.5 text-right transition-opacity ${r.id === selected ? "border-[#185045] bg-[#EEF5F1]" : "border-[#E3E8E4] bg-white hover:bg-[#F8FAF8]"} ${faded ? "opacity-55" : ""}`}>
      <span className="flex items-start justify-between gap-2"><span className="font-extrabold text-[#12332c]">{r.contact_name || `عميل #${r.conversation_id}`}</span><HeatChip heat={s?.heat} /></span>
      <span className="mt-1 block truncate text-sm text-slate-700">{[r.destination ?? s?.destination, s?.people].filter(Boolean).join(" · ") || "وجهة غير معروفة"}</span>
      <span className="mt-0.5 block truncate text-sm text-slate-600">{r.offer_line ?? "لم يُرسل عرض بعد"}</span>
      {line && <span className={`mt-1 block truncate text-xs ${r.client_waiting ? "font-bold text-[#1D4ED8]" : "text-slate-500"}`}>{byClient ? "آخر رسالة من العميل" : "آخر رسالة منا"}: {line}</span>}
      <span className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><StepLabel r={r} now={now} /><span>{name(r.assigned_to) ?? "بلا بائع"} · {since(r.offer_at ?? r.request_started_at, now)}</span></span>
    </button>;
  };
  return <div dir="rtl" className="space-y-4 rounded-3xl bg-[#F4F6F3] p-2 text-[#12332c] sm:p-3">
    <section className={`${card} flex flex-wrap items-center justify-between gap-4 p-5`}>
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold"><MessageCircle /> المتابعة</h1>
        <p className="mt-1 text-sm text-slate-500">عروض أُرسلت ولم يقرر العميل بعد · بعد ساعتين ثم اليوم 1 و3 و7</p>
        <div className="mt-3 w-64 max-w-full"><div className="flex justify-between text-xs font-bold"><span>إنجاز اليوم</span><span>{doneToday} من {goal}</span></div><div className="mt-1 h-2 overflow-hidden rounded-full bg-[#E3E8E4]"><div className="h-full rounded-full bg-[#185045] transition-all" style={{ width: `${goal ? Math.round((doneToday / goal) * 100) : 0}%` }} /></div></div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className={view === "quick" ? btnPrimary : btn} onClick={() => setView(view === "quick" ? "list" : "quick")}><Zap size={16} /> المتابعة السريعة</button>
        {data.manager && <><button className={view === "review" ? btnPrimary : btn} onClick={() => setView(view === "review" ? "list" : "review")}>مراجعة قبل الأرشفة</button>
          <button className={view === "board" ? btnPrimary : btn} onClick={() => setView(view === "board" ? "list" : "board")}>لوحة المدير والإعدادات</button></>}
      </div>
    </section>
    {notice && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">{notice}</p>}
    {view === "quick" ? <QuickFollowup rows={today} refresh={refresh} done={() => setView("list")} />
    : view === "review" ? <ArchiveReview data={data} refresh={refresh} open={open} />
    : view === "board" ? <ManagerBoard data={data} refresh={refresh} now={now} show={(ids, label) => { setFocus({ ids, label }); setView("list"); setSelected(null); }} />
    : <>
      {focus ? <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-white px-4 py-2.5 text-sm font-bold">{focus.label} ({focus.ids.length})</span><button className={btn} onClick={() => setFocus(null)}>إلغاء التصفية</button></div>
      : <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">{([["today", "اليوم", today.length], ["all", "الكل", listFor(data.rows, "all", now).length], ["closed", "المغلقة", null]] as [Tab, string, number | null][]).map(([key, label, count]) => <button key={key} onClick={() => { setTab(key); setLimit(60); }} className={tab === key ? btnPrimary : btn}>{label}{count !== null && <span className="opacity-80">{count}</span>}</button>)}</div>
        <div className="flex flex-wrap gap-1.5">{([["all", "الكل"], ["hot", "الساخن أولاً"], ["replied", "رد العميل"]] as [Filter, string][]).map(([key, label]) => <button key={key} onClick={() => setFilter(key)} className={`min-h-11 rounded-full px-4 text-sm font-bold ${filter === key ? "bg-[#12332c] text-white" : "bg-white text-[#185045]"}`}>{label}</button>)}</div>
      </div>}
      <div className="@container">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 @min-[720px]:grid-cols-[minmax(250px,320px)_minmax(0,1fr)]">
          <section className={`${card} min-w-0 p-3`}>
            <label className="flex items-center gap-2"><Search size={18} className="text-slate-400" /><input className={field} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="العميل أو الهاتف أو الوجهة" /></label>
            <div className="mt-3 max-h-[75vh] space-y-2 overflow-y-auto">
              {tab === "today" && !focus ? (["replied", "due", "late"] as TodayGroup[]).map((g) => {
                const list = rows.filter((r) => todayGroup(r, now) === g);
                return list.length ? <div key={g} className="space-y-2"><h2 className="px-1 pt-2 text-xs font-extrabold" style={{ color: GROUP[g].color }}>{GROUP[g].label} ({list.length})</h2>{list.map(fileCard)}</div> : null;
              }) : rows.slice(0, limit).map(fileCard)}
            </div>
            {!rows.length && <p className="p-8 text-center text-sm text-slate-500">{tab === "today" && !focus ? "لا متابعات مطلوبة اليوم." : "لا توجد ملفات هنا."}</p>}
            {(tab !== "today" || focus) && rows.length > limit && <button className={`${btn} mt-3 w-full`} onClick={() => setLimit(limit + 60)}>عرض المزيد ({rows.length - limit})</button>}
          </section>
          {selectedRow ? <WorkPanel key={selectedRow.id} row={selectedRow} data={data} refresh={refresh} close={() => setSelected(null)} name={name} now={now} next={() => {
            const index = rows.findIndex((r) => r.id === selectedRow.id);
            setSelected(rows[index + 1]?.id ?? null);
          }} /> : <section className={`${card} hidden min-h-80 min-w-0 items-center justify-center p-8 text-slate-500 @min-[720px]:flex`}>اختر عميلًا لترى ملخص مُراد ورسالته المقترحة.</section>}
        </div>
      </div>
      {data.manager && <p className="text-xs text-slate-500">آخر مزامنة: {when(data.lastSync?.at ?? null)} · {data.lastSync?.ok ? "الاتصال يعمل" : "لم تتأكد المزامنة الأخيرة"} · <button className="underline" disabled={busy} onClick={() => void sync()}><RefreshCw className="inline" size={12} /> مزامنة الآن</button></p>}
    </>}
  </div>;
}

function WorkPanel({ row, data, refresh, next, close, name, now }: { row: WorkRow; data: FollowupWorkspaceData; refresh: () => Promise<void>; next: () => void; close: () => void; name: (id: string | null) => string | null; now: number }) {
  const router = useRouter();
  const [detail, setDetail] = useState<WorkDetail | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [closing, setClosing] = useState<"not_interested" | "not_completed" | null>(null);
  const [later, setLater] = useState(false);
  const [due, setDue] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<{ text: string; id: string } | null>(null);
  const load = useCallback(async () => {
    const value = await getWorkDetail(row.id);
    setDetail(value);
    if (!value) setNotice(errors.forbidden);
  }, [row.id]);
  useEffect(() => {
    let live = true;
    const read = async () => {
      try { const value = await getWorkDetail(row.id); if (live) { setDetail(value); if (!value) setNotice(errors.forbidden); } }
      catch { if (live) setNotice(errors.failed); }
    };
    void read();
    const timer = setInterval(() => void read(), 30000);
    return () => { live = false; clearInterval(timer); };
  }, [row.id]);
  const f = detail?.row ?? row;
  const s = f.summary;
  const editable = f.status === "open" && (data.manager || f.assigned_to === data.employeeId || (Boolean(data.closer) && (f.step ?? 0) >= 3));
  const outside = detail ? !detail.canReply : false;
  const draft = text ?? s?.draft ?? "";
  const tpl = detail?.template;
  async function perform(work: () => Promise<WorkResult>, after?: string, advance = false) {
    setBusy(true); setNotice("");
    try {
      const result = await work();
      if (!result.ok) setNotice(errors[result.error] ?? result.error);
      else if (result.duplicate && result.state === "failed") { request.current = null; setNotice("تأكد عدم تنفيذ المحاولة السابقة. يمكنك المحاولة الآن."); }
      else if (result.duplicate && result.state !== "sent") setNotice(errors.uncertain);
      else { setNotice(after ?? "تم الحفظ."); setClosing(null); setLater(false); setNote(""); setText(null); request.current = null; if (advance) next(); }
      await Promise.all([refresh(), load()]);
    } catch { setNotice("لم تتأكد نتيجة العملية. حدّث الملف قبل إعادة الإرسال."); }
    finally { setBusy(false); }
  }
  function send() {
    const body = outside ? "" : draft;
    if (!request.current || request.current.text !== body) request.current = { text: body, id: crypto.randomUUID() };
    const id = request.current.id;
    return perform(() => sendFollowupReply(row.id, body, id), "تم الإرسال. تعود هذه المحادثة وحدها في موعد الخطوة التالية، أو فوراً إذا رد العميل.");
  }
  const outcome = (key: string, extra: { reason?: string; dueAt?: string | null } = {}) =>
    perform(() => recordFollowupResult(row.id, { outcome: key, note, channel: key === "no_answer" ? "call" : "note", dueAt: extra.dueAt ?? null, reason: extra.reason ?? null }), undefined, !extra.dueAt);
  async function alternative() {
    if (!detail?.draftId) { router.push("/basic"); return; }
    setBusy(true);
    const copy = await duplicateDraft(detail.draftId).catch(() => null);
    setBusy(false);
    if (copy?.ok) router.push(`/basic/${copy.id}`);
    else setNotice("تعذّر نسخ ملف العرض. افتحه وعدّله من «ملف العرض».");
  }
  return <section className="fixed inset-0 z-[100] min-w-0 space-y-3 overflow-y-auto bg-[#F4F6F3] p-3 @min-[720px]:static @min-[720px]:z-auto @min-[720px]:overflow-visible @min-[720px]:bg-transparent @min-[720px]:p-0">
    <button className={`${btn} @min-[720px]:hidden`} onClick={close}><ArrowRight size={16} /> رجوع</button>
    <div className={`${card} p-4`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0"><h2 className="text-xl font-extrabold">{f.contact_name || `عميل #${f.conversation_id}`}</h2>
          <p className="mt-1 text-sm text-slate-600">{[detail?.destination ?? s?.destination ?? "وجهة غير معروفة", s?.people, s?.dates].filter(Boolean).join(" · ")}</p>
          <p className="mt-1 text-xs text-slate-500">البائع: {name(f.assigned_to) ?? "بلا بائع"}{f.offer_at ? ` · العرض منذ ${since(f.offer_at, now)}` : ""}</p></div>
        <HeatChip heat={s?.heat} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {f.contact_phone && <a className={btn} href={`tel:${f.contact_phone.replace(/[^\d+]/g, "")}`}><Phone size={16} /> اتصال</a>}
        {detail?.teletelUrl && <a className={btn} href={detail.teletelUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} /> المحادثة كاملة</a>}
        {detail?.draftId && <Link className={btn} href={`/basic/${detail.draftId}`}><FileText size={16} /> ملف العرض</Link>}
        {editable && <button className={btn} disabled={busy} onClick={() => void alternative()}>عرض بديل</button>}
      </div>
      {f.status === "open" && !f.assigned_to && data.claim && <button disabled={busy} className={`${btnPrimary} mt-3`} onClick={() => void perform(() => claimFollowup(f.id))}>استلام هذا العميل</button>}
      {data.manager && f.status === "open" && <label className="mt-3 flex items-center gap-2 text-xs">البائع<select disabled={busy || Boolean(f.send_lock)} className={field} value={f.assigned_to ?? ""} onChange={(e) => void perform(() => assignWork(f.id, e.target.value || null))}><option value="">غير مسند</option>{data.people.filter((p) => p.seller || p.id === f.assigned_to).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
      {f.status === "done" && <p className="mt-3 rounded-xl bg-[#F4F6F3] p-3 text-sm">أُغلقت {when(f.done_at)} · {f.outcome && f.outcome in OUTCOMES ? OUTCOMES[f.outcome as keyof typeof OUTCOMES] : "مغلقة"}{f.close_reason ? ` · ${f.close_reason}` : ""}</p>}
      {isOldIntake(f) && <p className="mt-3 text-xs text-slate-500">من القائمة القديمة — تُراجع في «مراجعة قبل الأرشفة».</p>}
    </div>
    {f.client_waiting && f.status === "open" && <p className="flex items-center gap-2 rounded-2xl bg-[#E8EEFD] p-3 text-sm font-bold text-[#1D4ED8]"><BellRing size={16} /> العميل كتب آخر رسالة وينتظر ردنا منذ {since(f.last_client_at, now)}</p>}
    {f.status === "open" && <StepChips r={f} now={now} />}
    {notice && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">{notice}</p>}
    <div className={`${card} p-4`}>
      <h3 className="flex items-center gap-2 font-extrabold"><Sparkles size={16} className="text-[#185045]" /> ملخص مُراد</h3>
      {s ? <div className="mt-2 divide-y divide-[#EEF2EF]">
        <Row label="ماذا يريد العميل">{s.wants}</Row>
        <Row label="ماذا عرضنا">{s.offered || f.offer_line || "لم يُرسل عرض بعد"}</Row>
        <Row label="أين توقّف">{s.stopped}</Row>
        <Row label="درجة الاهتمام"><span className="flex flex-wrap items-center gap-2"><HeatChip heat={s.heat} />{s.heat_why}</span></Row>
        <Row label="المقترح" strong>{NEXT_LABEL[s.next]} — {s.advice}</Row>
      </div> : <p className="mt-2 text-sm text-slate-500">مُراد لم يقرأ هذه المحادثة بعد — يصلها خلال دقائق، أو اضغط «اقتراح آخر من مُراد».</p>}
      <p className="mt-2 text-xs text-slate-400">يتجدد مع كل رسالة جديدة{s ? ` · ${when(s.at)}` : ""}</p>
      {s?.unheard && <p className="mt-2 rounded-xl bg-amber-50 p-2 text-sm text-amber-900">🎤 في المحادثة رسالة صوتية من العميل لم يسمعها مُراد — استمع لها في Teletel قبل الرد.</p>}
    </div>
    {editable && <div className={`${card} space-y-3 p-4`}>
      {f.send_lock ? <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm"><p>هناك رسالة لم تتأكد نتيجتها. لا تعِد إرسالها.</p><button disabled={busy} className={btn} onClick={() => void perform(() => reviewFollowupSend(f.id))}>تحقق من الإرسال</button>{data.manager && <><input className={field} placeholder="نتيجة مراجعتك في Teletel وسبب تأكيد عدم الإرسال" value={note} onChange={(e) => setNote(e.target.value)} /><button disabled={busy || note.trim().length < 5} className={btn} onClick={() => void perform(() => reviewFollowupSend(f.id, true, note))}>أكدت عدم الإرسال — فتح الملف</button></>}</div> : <>
        <h3 className="font-extrabold">الرسالة المقترحة</h3>
        {outside ? <p className="rounded-xl bg-[#F4F6F3] p-3 text-sm">{tpl && !f.client_waiting ? <>مرّت 24 ساعة على آخر رسالة من العميل، فتُرسل كقالب «{tpl.label}»{tpl.approved ? " المعتمد." : <span className="font-bold text-[#9A3412]"> — لم تعتمده واتساب بعد، فاتصل بالعميل وسجّل النتيجة.</span>}</> : "مرّت 24 ساعة على آخر رسالة من العميل ولا قالب لهذه الخطوة: اتصل بالعميل ثم سجّل النتيجة."}</p>
          : <><textarea disabled={busy || !detail} className={field} rows={5} maxLength={4000} value={draft} onChange={(e) => setText(e.target.value)} placeholder={s ? "اكتب ردك للعميل…" : "بانتظار مُراد… أو اكتب رسالتك"} /><p className="text-xs text-slate-500">داخل نافذة 24 ساعة: تُرسل نصًا حرًا كما هو.</p></>}
        <div className="flex flex-wrap gap-2">
          {outside && !(tpl?.approved && !f.client_waiting) ? (f.contact_phone && <a className={btnPrimary} href={`tel:${f.contact_phone.replace(/[^\d+]/g, "")}`}><Phone size={15} /> اتصل بالعميل</a>)
            : <button disabled={busy || !detail || (!outside && !draft.trim())} className={btnPrimary} onClick={() => void send()}><Send size={15} /> أرسل للعميل</button>}
          <button disabled={busy} className={btn} onClick={() => void perform(() => remakeSummary(f.id), "كتب مُراد اقتراحًا جديدًا.")}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} اقتراح آخر من مُراد</button>
        </div>
        <div className="border-t border-[#EEF2EF] pt-3">
          <h3 className="mb-2 font-extrabold">ماذا حدث؟ <span className="text-xs font-normal text-slate-500">— ضغطة واحدة، والموعد التالي يُحدد وحده</span></h3>
          <div className="flex flex-wrap gap-2">
            <button disabled={busy} className={btn} onClick={() => void outcome("no_answer")}>لم يرد</button>
            <button disabled={busy} className={btn} onClick={() => void outcome("interested")}>مهتم</button>
            <button disabled={busy} className={btn} onClick={() => void outcome("revise_offer")}>يريد تعديل</button>
            <button disabled={busy} className={`${btn} ${closing === "not_interested" ? "!bg-[#FCE9E1]" : ""}`} onClick={() => setClosing(closing === "not_interested" ? null : "not_interested")}>غير مهتم</button>
            <button disabled={busy} className={`${btn} ${closing === "not_completed" ? "!bg-[#FCE9E1]" : ""}`} onClick={() => setClosing(closing === "not_completed" ? null : "not_completed")}>أغلق — لم يكمل</button>
            <button disabled={busy} className={`${btn} !border-transparent !bg-transparent !text-slate-500`} onClick={() => setLater(!later)}><CalendarClock size={15} /> موعد آخر</button>
          </div>
          <p className="mt-2 text-xs text-slate-500">لم يرد: الخطوة التالية · مهتم: يعود إليك غدًا 10:00 · يريد تعديل: جهّز «عرض بديل» وتبدأ الخطوات من جديد بعد إرساله</p>
          {closing && <div className="mt-3 space-y-2 rounded-xl bg-[#FDF4F0] p-3">
            <p className="text-xs font-bold">لماذا؟</p>
            <div className="flex flex-wrap gap-2">
              {CLOSE_REASONS.map((r) => <button key={r} disabled={busy} className={btn} onClick={() => void outcome(closing, { reason: r })}>{r}</button>)}
              {closing === "not_completed" && <button disabled={busy} className={`${btn} !text-[#185045]`} onClick={() => void outcome("completed")}>بل حجز ✓</button>}
            </div>
            <input className={field} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="ملاحظة (اختياري)" />
          </div>}
          {later && <div className="mt-3 flex flex-wrap items-end gap-2"><label className="text-xs">الموعد — بتوقيت الرياض<input type="datetime-local" className={field} value={due} onChange={(e) => setDue(e.target.value)} /></label><button disabled={busy || !due} className={btn} onClick={() => void outcome("later", { dueAt: new Date(`${due}:00+03:00`).toISOString() })}>حفظ الموعد</button></div>}
        </div>
      </>}
    </div>}
    <details className={`${card} p-4`}><summary className="min-h-11 cursor-pointer content-center font-extrabold">آخر الرسائل</summary>
      {!detail ? <p className="mt-3 text-sm text-slate-500"><Loader2 className="inline animate-spin" size={14} /> تحميل…</p> : detail.messages === null ? <p className="mt-3 text-sm text-red-700">تعذر تحميل المحادثة من Teletel.</p> :
        <div className="mt-3 max-h-96 space-y-2 overflow-y-auto">{detail.messages.map((m) => <div key={m.id} className={`max-w-[90%] rounded-xl p-3 text-sm ${m.fromClient ? "me-auto bg-slate-100" : "ms-auto bg-[#EEF5F1]"}`}><p className="whitespace-pre-wrap leading-7">{m.text}</p><p className="mt-1 text-xs text-slate-500">{m.fromClient ? "العميل" : m.sender || "نحن"} · {when(new Date(m.at * 1000).toISOString())}</p></div>)}</div>}
    </details>
    <details className={`${card} p-4`} open><summary className="min-h-11 cursor-pointer content-center font-extrabold">السجل ({detail?.attempts.length ?? 0})</summary><ol className="mt-3 space-y-2">{detail?.attempts.map((a) => <li key={a.id} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2 border-s-2 border-[#CFE0D8] ps-3 text-sm"><span className="text-xs text-slate-500">{when(a.created_at)}</span><span><b>{a.outcome && a.outcome in OUTCOMES ? OUTCOMES[a.outcome as keyof typeof OUTCOMES] : ({ message: "رسالة", transfer: "تحويل", assign: "إسناد", claim: "استلام", received: "دخل المتابعة", call: "اتصال", note: "ملاحظة", send_review: "مراجعة الإرسال", incoming: "رد العميل" } as Record<string, string>)[a.kind] ?? a.kind}</b>{a.note ? ` — ${a.kind === "assign" ? name(a.note) ?? a.note : a.note}` : ""}<span className="text-xs text-slate-500"> · {name(a.employee_id) ?? (a.employee_id ? "موظف سابق" : "النظام")}{a.due_at ? ` · التالي ${when(a.due_at)}` : ""}{a.delivery_state !== "recorded" ? ` · ${({ sent: "أُرسل", pending: "قيد الإرسال", uncertain: "غير مؤكد", failed: "لم يُرسل" } as Record<string, string>)[a.delivery_state]}` : ""}</span></span></li>)}</ol></details>
  </section>;
}
