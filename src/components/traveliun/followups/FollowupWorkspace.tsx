"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, CheckCircle2, Clock, Loader2, MessageCircle, Phone, RefreshCw, Search, Send, Settings, Users } from "lucide-react";
import { assignWork, claimFollowup, getFollowupSettings, getFollowupWorkspace, getWorkDetail, recordFollowupResult, refreshFollowupSync, reviewFollowupSend, saveFollowupMapping, saveFollowupTeam, sendFollowupReply, transferFollowup, type FollowupWorkspaceData, type WorkDetail } from "@/lib/data/followups";
import { OUTCOMES, STAGES, type WorkResult, type WorkRow } from "@/lib/followups/rules";

const button = "inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-900/15 bg-white px-3 py-2 text-sm font-bold text-emerald-950 disabled:opacity-40";
const input = "w-full rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-900";
const when = (at: string | null) => at ? new Date(at).toLocaleString("ar-SA-u-ca-gregory-nu-latn", { timeZone: "Asia/Riyadh", dateStyle: "short", timeStyle: "short" }) : "—";
const errors: Record<string, string> = {
  forbidden: "ليس لديك صلاحية لهذا الملف. قد يكون أُسند لموظف آخر.", claimed: "استلم موظف آخر هذا الملف. تم تحديث القائمة.",
  due: "حدد موعدًا قادمًا للمتابعة.", note: "اكتب سبب الإغلاق أو النتيجة.", busy: "يوجد إرسال قيد المعالجة. تحقّق من نتيجته أولًا.",
  uncertain: "لم تتأكد نتيجة العملية. لا نكرر الإرسال. استخدم «تحقق من الإرسال» أو اطلب مراجعة المشرف.",
  window: "نافذة الرد غير متاحة في Teletel. يمكن الاتصال وتسجيل النتيجة، أو استخدام قالب معتمد من Teletel.",
  invalid: "راجع البيانات المطلوبة.", unreachable: "تعذر الاتصال بـTeletel. لم نؤكد نجاح العملية.", done: "هذه المتابعة مغلقة.", failed: "تعذر حفظ العملية.", conflict: "تغير الملف أثناء العمل. حدّث الصفحة.",
};
type Tab = "new" | "mine" | "today" | "late" | "done" | "all";
const tabs: [Tab, string][] = [["new", "الجديدة"], ["mine", "متابعاتي"], ["today", "مواعيد اليوم"], ["late", "المتأخرة"], ["done", "المكتملة"], ["all", "كل الملفات المتاحة"]];
function filterRows(rows: WorkRow[], tab: Tab, me: string, now: number) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(now);
  return rows.filter((r) => {
    if (tab === "done") return r.status === "done";
    if (r.status !== "open") return false;
    if (tab === "new") return r.stage === "new";
    if (tab === "mine") return r.assigned_to === me;
    if (tab === "late") return r.next_followup_at && Date.parse(r.next_followup_at) < now;
    if (tab === "today") return r.next_followup_at && new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date(r.next_followup_at)) === day;
    return true;
  });
}
export function FollowupWorkspace({ initial, initialId }: { initial: FollowupWorkspaceData; initialId?: string }) {
  const [data, setData] = useState(initial);
  const [tab, setTab] = useState<Tab>(initialId ? "all" : "new");
  const [selected, setSelected] = useState<string | null>(initialId ?? null);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(50);
  const [mode, setMode] = useState<"work" | "report" | "settings">("work");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const refresh = useCallback(async () => {
    const updated = await getFollowupWorkspace();
    if (updated) { setData(updated); setNow(Date.now()); }
    else { setNotice("انتهت صلاحية الوصول إلى المتابعة."); setSelected(null); }
  }, []);
  useEffect(() => {
    const timer = setInterval(() => { void refresh().catch(() => setNotice("تعذر التحديث التلقائي؛ البيانات الظاهرة آخر نسخة ناجحة.")); }, 30000);
    return () => clearInterval(timer);
  }, [refresh]);
  const rows = filterRows(data.rows, tab, data.employeeId, now).filter((r) => `${r.contact_name} ${r.contact_phone} ${r.conversation_id}`.includes(search.trim()));
  const selectedRow = data.rows.find((r) => r.id === selected);
  async function sync() {
    setBusy(true);
    try { const result = await refreshFollowupSync(); setNotice(result.ok ? "اكتملت المزامنة." : errors[result.error] ?? result.error); await refresh(); }
    catch { setNotice(errors.failed); } finally { setBusy(false); }
  }
  return <div dir="rtl" className="space-y-4 text-emerald-950">
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-900/10 bg-white p-5">
      <div><h1 className="flex items-center gap-2 text-2xl font-extrabold"><MessageCircle /> المتابعة</h1><p className="mt-1 text-sm text-slate-500">طلبات العملاء من الأحدث إلى الأقدم · المواعيد بتوقيت الرياض</p></div>
      <div className="flex flex-wrap gap-2"><button className={button} onClick={() => setMode("work")}><Users size={16} /> قائمة العمل</button>
        {data.manager && <><button className={button} onClick={() => setMode("report")}>لوحة الإشراف</button><button className={button} onClick={() => setMode("settings")}><Settings size={16} /> إعداد الفريق</button><button disabled={busy} className={button} onClick={() => void sync()}><RefreshCw size={16} /> مزامنة</button></>}
      </div>
    </section>
    <div className="flex flex-wrap gap-3 text-xs text-slate-500"><span>آخر مزامنة: {when(data.lastSync?.at ?? null)}</span><span>{data.lastSync?.ok ? "الاتصال يعمل" : "لم تتأكد المزامنة الأخيرة؛ راجع المشرف"}</span><span>التحديث التلقائي كل 30 ثانية</span></div>
    {notice && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">{notice}</p>}
    {mode === "settings" ? <TeamSettings /> : mode === "report" ? <Report data={data} now={now} /> : <>
      <div className="flex flex-wrap gap-2">{tabs.map(([key, label]) => <button key={key} onClick={() => { setTab(key); setLimit(50); }} className={`${button} ${tab === key ? "!bg-emerald-900 !text-white" : ""}`}>{label}<span>{filterRows(data.rows, key, data.employeeId, now).length}</span></button>)}</div>
      <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <section className="rounded-2xl border border-slate-200 bg-white p-3">
          <label className="flex items-center gap-2"><Search size={18} /><input className={input} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="اسم العميل أو رقم الهاتف" /></label>
          <div className="mt-3 max-h-[75vh] space-y-2 overflow-y-auto">{rows.slice(0, limit).map((r) => <button key={r.id} onClick={() => setSelected(r.id)} className={`w-full rounded-xl border p-3 text-right ${r.id === selected ? "border-emerald-700 bg-emerald-50" : "border-slate-100 hover:bg-slate-50"}`}>
            <span className="flex justify-between gap-2 font-bold"><span>{r.contact_name || `عميل #${r.conversation_id}`}</span><span className="text-xs text-emerald-700">{STAGES[r.stage]}</span></span>
            <span dir="ltr" className="block text-right text-sm text-slate-500">{r.contact_phone}</span>
            <span className="mt-2 block text-xs text-slate-500">الطلب: {when(r.request_started_at)}</span>
            <span className="block text-xs text-slate-500">التحويل: {when(r.created_at)} · {data.people.find((p) => p.id === r.assigned_to)?.name ?? "بانتظار الاستلام"}</span>
            {r.next_followup_at && <span className={`mt-1 block text-xs font-bold ${Date.parse(r.next_followup_at) < now ? "text-red-700" : "text-amber-700"}`}><Clock className="inline" size={12} /> {when(r.next_followup_at)}</span>}
            {r.last_client_at && (!r.last_attempt_at || r.last_client_at > r.last_attempt_at) && r.stage !== "new" && <span className="mt-1 block text-xs font-bold text-blue-700"><BellRing className="inline" size={12} /> رد جديد من العميل</span>}
          </button>)}</div>
          {!rows.length && <p className="p-8 text-center text-sm text-slate-500">لا توجد ملفات في هذه القائمة.</p>}
          {rows.length > limit && <button className={`${button} mt-3 w-full`} onClick={() => setLimit(limit + 50)}>عرض المزيد ({rows.length - limit})</button>}
        </section>
        {selectedRow ? <WorkPanel key={selectedRow.id} row={selectedRow} data={data} refresh={refresh} next={() => {
          const index = rows.findIndex((r) => r.id === selectedRow.id);
          setSelected(rows[index + 1]?.id ?? rows.find((r) => r.id !== selectedRow.id)?.id ?? null);
        }} /> : <section className="flex min-h-80 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-slate-500">اختر عميلًا لقراءة طلبه وبدء المتابعة.</section>}
      </div>
    </>}
  </div>;
}

function WorkPanel({ row, data, refresh, next }: { row: WorkRow; data: FollowupWorkspaceData; refresh: () => Promise<void>; next: () => void }) {
  const [detail, setDetail] = useState<WorkDetail | null>(null);
  const [pages, setPages] = useState(2);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState("no_answer");
  const [channel, setChannel] = useState("call");
  const [due, setDue] = useState("");
  const [teamId, setTeamId] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [historyLimit, setHistoryLimit] = useState(20);
  const request = useRef<{ text: string; id: string } | null>(null);
  const transferRequest = useRef<{ text: string; id: string } | null>(null);
  const load = useCallback(async () => {
    const value = await getWorkDetail(row.id, pages);
    setDetail(value);
    if (!value) setNotice(errors.forbidden);
  }, [row.id, pages]);
  useEffect(() => {
    let live = true;
    const read = async () => {
      try { const value = await getWorkDetail(row.id, pages); if (live) { setDetail(value); if (!value) setNotice(errors.forbidden); } }
      catch { if (live) setNotice(errors.failed); }
    };
    void read();
    const timer = setInterval(() => void read(), 30000);
    return () => { live = false; clearInterval(timer); };
  }, [row.id, pages]);
  const f = detail?.row ?? row;
  const editable = f.status === "open" && (data.manager || f.assigned_to === data.employeeId);
  async function perform(work: () => Promise<WorkResult>, advance = false, clearText = false) {
    setBusy(true); setNotice("");
    try {
      const result = await work();
      if (!result.ok) setNotice(errors[result.error] ?? result.error);
      else if (result.duplicate && result.state !== "sent") setNotice(errors.uncertain);
      else { setNotice("تم حفظ العملية."); if (clearText) { setText(""); request.current = null; } if (advance) next(); }
      await Promise.all([refresh(), load()]);
    } catch { setNotice("لم تتأكد نتيجة العملية. حدّث الملف قبل إعادة الإرسال."); }
    finally { setBusy(false); }
  }
  function send() {
    if (!request.current || request.current.text !== text) request.current = { text, id: crypto.randomUUID() };
    const id = request.current.id;
    return perform(() => sendFollowupReply(row.id, text, id), false, true);
  }
  function result(advance: boolean) {
    if (outcome === "transferred") {
      const key = `${teamId}:${note}`;
      if (!transferRequest.current || transferRequest.current.text !== key) transferRequest.current = { text: key, id: crypto.randomUUID() };
      const id = transferRequest.current.id;
      return perform(() => transferFollowup(row.id, Number(teamId), note, id), advance);
    }
    return perform(() => recordFollowupResult(row.id, { outcome, note, channel, dueAt: due && !["completed", "not_interested"].includes(outcome) ? new Date(`${due}:00+03:00`).toISOString() : null }), advance);
  }
  return <section className="space-y-4">
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-extrabold">{f.contact_name || `عميل #${f.conversation_id}`}</h2><p className="mt-1 text-sm text-slate-500">{detail?.destination ?? "وجهة غير محددة"} · {detail?.inquiry ?? "نوع الطلب غير محدد"}</p><p className="mt-1 text-xs text-slate-500">{f.transfer_reason ?? "تحويل من SLA"} · {STAGES[f.stage]}</p></div>
        <div className="flex gap-2">{f.contact_phone && <a className={button} href={`tel:${f.contact_phone.replace(/[^\d+]/g, "")}`}><Phone size={16} /> اتصال</a>}{detail?.draftId && <Link className={button} href={`/basic/${detail.draftId}`}>ملف العرض</Link>}</div>
      </div>
      {f.external_status && f.external_status !== "open" && <p className="mt-2 text-xs text-amber-800">حالة المحادثة في Teletel: {f.external_status} · حالة المتابعة مستقلة عن إغلاق المحادثة.</p>}
      <div className="mt-3 flex flex-wrap items-center gap-3">{!f.assigned_to && f.status === "open" && <button disabled={busy} className={`${button} !bg-emerald-900 !text-white`} onClick={() => void perform(() => claimFollowup(f.id))}>استلام هذا العميل</button>}
        {data.manager && f.status === "open" && <label className="flex items-center gap-2 text-xs">المسؤول<select disabled={busy || Boolean(f.send_lock)} className={input} value={f.assigned_to ?? ""} onChange={(e) => void perform(() => assignWork(f.id, e.target.value || null))}><option value="">غير مسند</option>{data.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
        <span className="text-xs text-slate-500">المحاولات: {f.attempt_count} · آخر تواصل: {when(f.last_attempt_at)}</span>
      </div>
    </div>
    {notice && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">{notice}</p>}
    {!detail ? <div className="rounded-xl bg-white p-8"><Loader2 className="animate-spin" /> تحميل المحادثة…</div> : <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <h3 className="mb-3 font-bold">المحادثة</h3>
      {!detail.historyComplete && pages < 50 && <button className={`${button} mb-2`} disabled={busy} onClick={() => setPages(Math.min(50, pages + 3))}>تحميل رسائل أقدم</button>}
      {detail.messages === null ? <p className="text-sm text-red-700">تعذر تحميل المحادثة. لا يمكن الإرسال الآن.</p> : <div className="max-h-96 space-y-2 overflow-y-auto">{detail.messages.map((m) => <div key={m.id} className={`max-w-[90%] rounded-xl p-3 text-sm ${m.fromClient ? "me-auto bg-slate-100" : "ms-auto bg-emerald-50"}`}><p className="whitespace-pre-wrap leading-7">{m.text}</p><p className="mt-1 text-xs text-slate-500">{m.fromClient ? "العميل" : m.sender || "الموظف"} · {when(new Date(m.at * 1000).toISOString())}</p></div>)}</div>}
      {editable && <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
        {f.send_lock ? <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm"><p>هناك عملية لم تتأكد نتيجتها. لا تعِد إرسالها.</p><button disabled={busy} className={button} onClick={() => void perform(() => reviewFollowupSend(f.id))}>تحقق من الإرسال</button>{data.manager && <><input className={input} placeholder="اكتب نتيجة مراجعتك في Teletel وسبب تأكيد عدم التنفيذ" value={note} onChange={(e) => setNote(e.target.value)} /><button disabled={busy || note.trim().length < 5} className={button} onClick={() => void perform(() => reviewFollowupSend(f.id, true, note))}>أكدت عدم التنفيذ — فتح الملف</button></>}</div> : <>
          <div className="flex flex-wrap gap-2"><button className={button} onClick={() => setText("أهلًا بك، معك فريق المتابعة في ترافليون. حابين نطمئن إن تفاصيل العرض وصلتكم، وهل عندكم أي استفسار نساعدكم فيه؟")}>متابعة العرض</button><button className={button} onClick={() => setText("أهلًا بك، ما الوقت المناسب للتواصل معك بخصوص طلبك؟")}>تحديد موعد</button></div>
          <textarea disabled={!detail.canReply || busy} className={input} rows={3} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} placeholder="اكتب ردك للعميل…" />
          {!detail.canReply && <p className="text-xs text-amber-800">{errors.window}</p>}
          <button disabled={busy || !detail.canReply || !text.trim()} className={`${button} !bg-emerald-900 !text-white`} onClick={() => void send()}><Send size={15} /> إرسال للعميل</button>
        </>}
      </div>}
    </div>}
    {editable && !f.send_lock && <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4"><h3 className="font-bold">نتيجة المتابعة والخطوة التالية</h3>
      <div className="grid gap-3 md:grid-cols-2"><label className="text-xs">نتيجة التواصل<select className={input} value={outcome} onChange={(e) => setOutcome(e.target.value)}>{Object.entries(OUTCOMES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="text-xs">وسيلة التواصل<select className={input} value={channel} onChange={(e) => setChannel(e.target.value)}><option value="call">اتصال</option><option value="message">رسالة</option><option value="note">ملاحظة داخلية</option></select></label></div>
      {outcome === "transferred" ? <label className="block text-xs">القسم المستلم<select className={input} value={teamId} onChange={(e) => setTeamId(e.target.value)}><option value="">اختر القسم</option>{data.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label> : !["completed", "not_interested"].includes(outcome) && <label className="block text-xs">موعد المحاولة التالية — توقيت الرياض {["no_answer", "later"].includes(outcome) ? "(مطلوب)" : "(اختياري)"}<input type="datetime-local" className={input} value={due} onChange={(e) => setDue(e.target.value)} /></label>}
      <textarea className={input} rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="ماذا حدث؟ وما المطلوب في الخطوة التالية؟" />
      <div className="flex flex-wrap gap-2"><button disabled={busy} className={button} onClick={() => void result(false)}><CheckCircle2 size={16} /> حفظ النتيجة</button><button disabled={busy} className={`${button} !bg-emerald-900 !text-white`} onClick={() => void result(true)}>حفظ والانتقال للعميل التالي</button></div>
    </div>}
    <section className="rounded-2xl border border-slate-200 bg-white p-4"><h3 className="font-bold">سجل المتابعة</h3><ol className="mt-3 space-y-3">{detail?.attempts.slice(0, historyLimit).map((a) => <li key={a.id} className="border-s-2 border-emerald-200 ps-3 text-sm"><p className="font-bold">{a.outcome && a.outcome in OUTCOMES ? OUTCOMES[a.outcome as keyof typeof OUTCOMES] : ({ message: "رسالة", transfer: "تحويل", assign: "إسناد", claim: "استلام", received: "وصول للمتابعة", call: "اتصال", note: "ملاحظة", send_review: "مراجعة الإرسال", incoming: "رد العميل" } as Record<string, string>)[a.kind] ?? a.kind}</p><p className="whitespace-pre-wrap text-slate-600">{a.note}</p><p className="mt-1 text-xs text-slate-500">{data.people.find((p) => p.id === a.employee_id)?.name ?? (a.employee_id ? "موظف سابق" : "النظام")} · {when(a.created_at)}{a.due_at ? ` · الموعد: ${when(a.due_at)}` : ""}{a.delivery_state !== "recorded" ? ` · ${({ sent: "أُرسل", pending: "قيد الإرسال", uncertain: "نتيجة غير مؤكدة", failed: "لم ينفذ" } as Record<string, string>)[a.delivery_state]}` : ""}</p></li>)}</ol>{(detail?.attempts.length ?? 0) > historyLimit && <button className={`${button} mt-3`} onClick={() => setHistoryLimit(historyLimit + 20)}>عرض محاولات أقدم</button>}</section>
  </section>;
}

function Report({ data, now }: { data: FollowupWorkspaceData; now: number }) {
  const open = data.rows.filter((r) => r.status === "open");
  const cards = [["مفتوحة", open.length], ["غير مسندة", open.filter((r) => !r.assigned_to).length], ["متأخرة", open.filter((r) => r.next_followup_at && Date.parse(r.next_followup_at) < now).length], ["حجوزات مؤكدة مرتبطة", new Set(data.confirmed.map((r) => r.serial)).size]];
  return <div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{cards.map(([name, count]) => <div key={name} className="rounded-2xl border border-slate-200 bg-white p-5"><p className="text-sm text-slate-500">{name}</p><p className="mt-2 text-3xl font-extrabold">{count}</p></div>)}</div>
    <section className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-4"><h2 className="mb-3 font-bold">أداء الفريق — كامل سجل المتابعة</h2><table className="w-full text-right text-sm"><thead><tr>{["الموظف", "ملفات مفتوحة", "محاولات موثقة", "مهتم", "غير مهتم", "متوسط بدء المتابعة"].map((label) => <th key={label} className="border-b p-3">{label}</th>)}</tr></thead><tbody>{data.people.map((p) => {
      const owned = data.rows.filter((r) => r.assigned_to === p.id);
      const attempts = data.attempts.filter((a) => a.employee_id === p.id && (a.delivery_state === "recorded" && ["call", "note", "message"].includes(a.kind) || a.delivery_state === "sent"));
      const times = owned.filter((r) => r.first_followed_at).map((r) => Math.max(0, Date.parse(r.first_followed_at!) - Date.parse(r.created_at)) / 60000);
      return <tr key={p.id}><td className="p-3 font-bold">{p.name}</td><td className="p-3">{owned.filter((r) => r.status === "open").length}</td><td className="p-3">{attempts.length}</td><td className="p-3">{attempts.filter((a) => a.outcome === "interested").length}</td><td className="p-3">{attempts.filter((a) => a.outcome === "not_interested").length}</td><td className="p-3">{times.length ? `${Math.round(times.reduce((a, b) => a + b, 0) / times.length)} دقيقة` : "—"}</td></tr>;
    })}</tbody></table><p className="mt-3 text-xs text-slate-500">الحجز المؤكد مأخوذ من حالة العرض المرتبط فعليًا. إغلاق المتابعة أو إرسال رسالة لا يُحتسب حجزًا.</p></section>
  </div>;
}

function TeamSettings() {
  const [data, setData] = useState<Awaited<ReturnType<typeof getFollowupSettings>>>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; void getFollowupSettings().then((v) => { if (live) setData(v); }).catch(() => { if (live) setNotice(errors.failed); }); return () => { live = false; }; }, []);
  async function save(work: () => Promise<WorkResult>) {
    setBusy(true);
    try { const r = await work(); setNotice(r.ok ? "تم الحفظ." : errors[r.error] ?? r.error); if (r.ok) setData(await getFollowupSettings()); }
    catch { setNotice(errors.failed); } finally { setBusy(false); }
  }
  if (!data) return <p>{notice || "تحميل إعدادات الفريق…"}</p>;
  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5"><h2 className="text-lg font-extrabold">ربط فريق المتابعة</h2><p className="text-sm text-slate-500">امنح الموظف دور «موظف المتابعة» أو «مشرف المتابعة» من إدارة الموظفين أولًا. ربط الحسابات هنا يعتمد على معرّفاتها، ولا يمنح صلاحيات إضافية.</p>
    <label className="block max-w-md text-sm">فريق Teletel الذي يستقبل التحويلات<select disabled={busy} className={input} value={data.teamId} onChange={(e) => void save(() => saveFollowupTeam(Number(e.target.value)))}>{data.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
    <h3 className="font-bold">ربط موظفي Teletel بموظفي النظام</h3><p className="text-xs text-slate-500">الحساب غير المربوط يدخل قائمة «غير مسند» حتى يستلمه الفريق أو يسنده المشرف.</p>
    <div className="grid gap-3 md:grid-cols-2">{data.agents.map((a) => <label key={a.id} className="rounded-xl border border-slate-100 p-3 text-sm">{a.name} <span className="text-xs text-slate-400">#{a.id}</span><select disabled={busy} className={`${input} mt-2`} value={data.mappings.find((m) => m.agent_id === a.id)?.employee_id ?? ""} onChange={(e) => void save(() => saveFollowupMapping(a.id, e.target.value || null))}><option value="">غير مربوط</option>{data.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>)}</div>
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </section>;
}
