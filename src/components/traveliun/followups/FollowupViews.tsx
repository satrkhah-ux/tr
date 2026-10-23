"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Phone, Send, SkipForward } from "lucide-react";
import { archiveFollowups, assignWork, distributeFollowups, getWorkDetail, restartFollowups, saveFollowupPageSettings, sendFollowupReply, type FollowupWorkspaceData, type WorkDetail } from "@/lib/data/followups";
import { CLOSE_REASONS, STEP_LABELS, todayGroup, type FollowupSettings, type WorkResult, type WorkRow } from "@/lib/followups/rules";
import { NEXT_LABEL } from "@/lib/followups/summary-core";
import { btn, btnPrimary, card, CLAY, count, errors, field, FILES, GREEN, HeatChip, isToday, since, StepLabel, when } from "./followup-ui";

const DAY = 864e5;

/**
 * «المتابعة السريعة» (phone first): today's files one at a time, the client
 * who wrote back first — Murad's advice and draft, then تخطَّ · اتصال · أرسل.
 */
export function QuickFollowup({ rows, refresh, done }: { rows: WorkRow[]; refresh: () => Promise<void>; done: () => void }) {
  const [queue] = useState(() => [...rows].sort((a, b) => Number(b.client_waiting) - Number(a.client_waiting)));
  const [index, setIndex] = useState(0);
  const [sent, setSent] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [text, setText] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<{ text: string; id: string } | null>(null);
  const [detail, setDetail] = useState<WorkDetail | null>(null);
  const now = Date.now();
  const r = queue[index];
  // can anything reach him in writing: inside the 24 hours, or the step's approved template
  useEffect(() => {
    let live = true;
    setDetail(null);
    if (r) void getWorkDetail(r.id, 1).then((d) => { if (live) setDetail(d); }).catch(() => undefined);
    return () => { live = false; };
  }, [r]);
  const advance = (wasSent: boolean) => { if (wasSent) setSent(sent + 1); else setSkipped(skipped + 1); setIndex(index + 1); setText(null); setNotice(""); request.current = null; };
  if (!r) return <section className={`${card} p-8 text-center`}>
    <p className="text-xl font-extrabold">أنهيت متابعات اليوم</p>
    <p className="mt-2 text-slate-600">أُرسلت {sent}، وتخطيت {skipped}.</p>
    <button className={`${btnPrimary} mt-5`} onClick={() => { void refresh(); done(); }}>العودة للقائمة</button>
  </section>;
  const draft = text ?? r.summary?.draft ?? "";
  const writable = detail ? detail.canReply || Boolean(detail.template?.approved && !r.client_waiting) : null;
  const phone = r.contact_phone?.replace(/[^\d+]/g, "");
  async function send() {
    if (!request.current || request.current.text !== draft) request.current = { text: draft, id: crypto.randomUUID() };
    const id = request.current.id;
    setBusy(true);
    try {
      const result: WorkResult = await sendFollowupReply(r.id, draft, id);
      if (result.ok && !(result.duplicate && result.state !== "sent")) advance(true);
      else setNotice(result.ok ? errors.uncertain : errors[result.error] ?? result.error);
    } catch { setNotice(errors.uncertain); }
    finally { setBusy(false); }
  }
  const s = r.summary;
  return <section className="mx-auto max-w-xl space-y-3">
    <div><div className="flex justify-between text-sm font-bold"><span>{index + 1} من {queue.length} اليوم</span><button className="text-slate-500 underline" onClick={done}>خروج</button></div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#E3E8E4]"><div className="h-full rounded-full bg-[#185045]" style={{ width: `${Math.round((index / queue.length) * 100)}%` }} /></div></div>
    <div className={`${card} space-y-3 p-5`}>
      <div className="flex items-start justify-between gap-2"><h2 className="text-xl font-extrabold">{r.contact_name || `عميل #${r.conversation_id}`}</h2><HeatChip heat={s?.heat} /></div>
      <p className="text-sm text-slate-600">{[r.destination ?? s?.destination, s?.people].filter(Boolean).join(" · ") || "وجهة غير معروفة"} · <StepLabel r={r} now={now} /></p>
      {r.client_waiting && <p className="rounded-xl bg-[#E8EEFD] p-2 text-sm font-bold text-[#1D4ED8]">العميل كتب آخر رسالة: {r.client_line ?? r.last_line}</p>}
      {s ? <p className="rounded-xl bg-[#EEF5F1] p-3 text-sm"><b className="text-[#185045]">المقترح: {NEXT_LABEL[s.next]}</b> — {s.advice}</p> : <p className="text-sm text-slate-500">مُراد لم يقرأ المحادثة بعد.</p>}
      {s?.unheard && <p className="text-sm text-amber-900">🎤 رسالة صوتية لم تُسمع — استمع لها في Teletel أولًا.</p>}
      {writable === false ? <p className="rounded-xl bg-[#F4F6F3] p-3 text-sm">مرّت 24 ساعة على آخر رسالة من العميل ولا قالب معتمد لهذه الخطوة — اتصل به.</p>
        : detail && !detail.canReply ? <p className="rounded-xl bg-[#F4F6F3] p-3 text-sm">تُرسل كقالب «{detail.template?.label}» المعتمد.</p>
        : <textarea className={field} rows={6} value={draft} onChange={(e) => setText(e.target.value)} placeholder="الرسالة للعميل…" />}
      {notice && <p role="status" className="rounded-xl bg-amber-50 p-2 text-sm text-amber-950">{notice}</p>}
      <div className="grid grid-cols-3 gap-2">
        <button disabled={busy} className={`${btn} min-h-14`} onClick={() => advance(false)}><SkipForward size={18} /> تخطَّ</button>
        {phone ? <a className={`${writable === false ? btnPrimary : btn} min-h-14`} href={`tel:${phone}`}><Phone size={18} /> اتصال</a> : <span />}
        {writable === false ? <span /> : <button disabled={busy || writable === null || (detail?.canReply !== false && !draft.trim())} className={`${btnPrimary} min-h-14`} onClick={() => void send()}>{busy ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />} أرسل</button>}
      </div>
    </div>
  </section>;
}

type ReviewGroup = { key: string; title: string; advice: string; action: "distribute" | "restart" | "archive"; button: string; reason?: string };
const REVIEW: ReviewGroup[] = [
  { key: "waiting", title: "العميل كتب آخراً ولم يرد عليه أحد", advice: "وزّعها على البائعين", action: "distribute", button: "وزّع على المبيعات" },
  { key: "recent", title: "حديثة — أقل من 7 أيام", advice: "أدخلها خطوات المتابعة", action: "restart", button: "أدخلها في الخطوات" },
  { key: "silent", title: "آخر رسالة منا والعميل صامت 7 أيام أو أكثر", advice: "أرشفها «لم يكمل — لا رد»", action: "archive", button: "أرشف الكل", reason: "لا رد" },
  { key: "closed", title: "مغلقة في تيلي تيل", advice: "أرشفها", action: "archive", button: "أرشف الكل", reason: "أخرى" },
];
function reviewGroup(r: WorkRow, now: number): string {
  if (r.external_status && !["open", "transferred"].includes(r.external_status)) return "closed";
  if (r.client_waiting) return "waiting";
  const last = Math.max(...[r.last_client_at, r.last_attempt_at, r.request_started_at].map((t) => (t ? Date.parse(t) : 0)));
  return now - last < 7 * DAY ? "recent" : "silent";
}

/** «مراجعة قبل الأرشفة» (managers): the old open list in four groups — nothing is archived by itself. */
export function ArchiveReview({ data, refresh, open }: { data: FollowupWorkspaceData; refresh: () => Promise<void>; open: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const now = Date.now();
  const old = data.rows.filter((r) => r.status === "open" && r.step === null);
  const name = (id: string | null) => data.people.find((p) => p.id === id)?.name ?? null;
  async function run(work: () => Promise<WorkResult & { done?: number }>, label: string) {
    setBusy(true); setNotice("");
    try { const r = await work(); setNotice(r.ok ? `${label}: ${r.done ?? 1}` : errors[r.error] ?? r.error); await refresh(); }
    catch { setNotice(errors.failed); } finally { setBusy(false); }
  }
  const act = (g: ReviewGroup, ids: string[]) =>
    g.action === "distribute" ? run(() => distributeFollowups(ids), "وُزّعت") : g.action === "restart" ? run(() => restartFollowups(ids), "دخلت الخطوات") : run(() => archiveFollowups(ids, g.reason ?? "لا رد"), "أُرشفت");
  return <div className="space-y-4">
    <p className={`${card} p-4 text-sm text-slate-600`}>الملفات القديمة المفتوحة ({old.length}) قبل نظام العروض، مع ملخص مُراد لكل واحدة. أنت تقرر هنا، ولا يُؤرشف شيء وحده.</p>
    {notice && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-950">{notice}</p>}
    {REVIEW.map((g) => {
      const list = old.filter((r) => reviewGroup(r, now) === g.key);
      if (!list.length) return null;
      return <section key={g.key} className={`${card} p-4`}>
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-extrabold">{g.title} ({list.length})</h2><p className="text-sm text-slate-500">النصيحة: {g.advice}</p></div>
          <button disabled={busy} className={g.action === "archive" ? btn : btnPrimary} onClick={() => { if (g.action !== "archive" || confirm(`${g.button} — ${list.length} ملف؟`)) void act(g, list.map((r) => r.id)); }}>{busy ? <Loader2 className="animate-spin" size={15} /> : null}{g.button}</button></div>
        <ul className="mt-3 divide-y divide-[#EEF2EF]">{list.map((r) => <li key={r.id} className="space-y-2 py-3">
          <button className="block w-full text-right" onClick={() => open(r.id)}><span className="font-bold">#{r.conversation_id} · {r.contact_name}</span><span className="ms-2 text-xs text-slate-500">{when(r.request_started_at)}{name(r.assigned_to) ? ` · ${name(r.assigned_to)}` : ""}</span>
            <span className="mt-1 block text-sm text-slate-700">ماذا أراد: {r.summary?.wants ?? "لم يقرأها مُراد بعد"}</span>
            {r.summary && <span className="block text-sm font-bold text-[#185045]">المقترح: {NEXT_LABEL[r.summary.next]} — {r.summary.advice}</span>}</button>
          <div className="flex flex-wrap gap-2">
            <select disabled={busy} className={`${field} !w-auto min-h-11`} value="" onChange={(e) => e.target.value && void run(() => assignWork(r.id, e.target.value), "حُوّلت")}><option value="">حوّل لبائع…</option>{data.people.filter((p) => p.seller).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            <button disabled={busy} className={btn} onClick={() => void run(() => restartFollowups([r.id]), "أُعيدت")}>أعد للمتابعة</button>
            <button disabled={busy} className={btn} onClick={() => void run(() => archiveFollowups([r.id], g.reason ?? "لا رد"), "أُرشفت")}>أرشف</button>
          </div>
        </li>)}</ul>
      </section>;
    })}
    {!old.length && <p className={`${card} p-8 text-center text-slate-500`}>لا ملفات قديمة مفتوحة.</p>}
  </div>;
}

/** «لوحة المدير»: this week's tiles, the sellers' table (each number opens its files), why clients are lost, and the settings. */
export function ManagerBoard({ data, refresh, now, show }: { data: FollowupWorkspaceData; refresh: () => Promise<void>; now: number; show: (ids: string[], label: string) => void }) {
  const weekAgo = now - 7 * DAY;
  const inWeek = (at: string | null) => Boolean(at) && Date.parse(at!) >= weekAgo;
  const offers = data.rows.filter((r) => r.step !== null);
  const enrolled = offers.filter((r) => inWeek(r.created_at) && (r.first_followed_at || now - Date.parse(r.created_at) > DAY));
  const onTime = enrolled.filter((r) => r.first_followed_at && Date.parse(r.first_followed_at) - Date.parse(r.created_at) <= DAY);
  const waiting = data.rows.filter((r) => r.status === "open" && r.client_waiting);
  // the client wrote back after one of our sent follow-ups
  const sentAt = new Map<string, number>();
  for (const a of data.attempts) if (a.kind === "message" && a.delivery_state === "sent") sentAt.set(a.followup_id, Math.min(sentAt.get(a.followup_id) ?? Infinity, Date.parse(a.created_at)));
  const back = new Set(data.attempts.filter((a) => a.kind === "incoming" && Date.parse(a.created_at) > (sentAt.get(a.followup_id) ?? Infinity)).map((a) => a.followup_id));
  const won = data.confirmed;
  const wonIds = new Set([...won.map((b) => b.followup_id), ...data.rows.filter((r) => r.outcome === "completed" && inWeek(r.done_at)).map((r) => r.id)]);
  const amount = won.reduce((sum, b) => sum + (b.total ?? 0), 0);
  // the staff's own closes with a reason — not the old list the system closed
  const lost = data.rows.filter((r) => r.status === "done" && inWeek(r.done_at) && ["not_interested", "not_completed"].includes(r.outcome ?? "") && r.close_reason);
  const tiles: [string, string, string[]][] = [
    ["تُوبعت خلال 24 ساعة", enrolled.length ? `${Math.round((onTime.length / enrolled.length) * 100)}% · الهدف 90%` : "—", onTime.map((r) => r.id)],
    ["عملاء ينتظرون ردنا", String(waiting.length), waiting.map((r) => r.id)],
    ["عاد العميل بعد المتابعة", String(back.size), [...back]],
    ["تحوّلت إلى حجز", `${wonIds.size}${amount ? ` · ${Math.round(amount).toLocaleString("en-US")} ر.س` : ""}`, [...wonIds]],
  ];
  const sellers = data.people.filter((p) => data.rows.some((r) => r.assigned_to === p.id && (r.status === "open" || inWeek(r.done_at))));
  const cols: [string, (r: WorkRow) => boolean][] = [
    ["مستحقة اليوم", (r) => ["due", "replied"].includes(todayGroup(r, now) ?? "")],
    ["في وقتها", (r) => r.status === "open" && r.step !== null && !todayGroup(r, now)],
    ["متأخرة", (r) => todayGroup(r, now) === "late"],
    ["عاد العميل", (r) => back.has(r.id)],
    ["حجز مؤكد", (r) => wonIds.has(r.id)],
  ];
  const reasons = CLOSE_REASONS.map((reason) => [reason, lost.filter((r) => r.close_reason === reason)] as const);
  const unowned = data.rows.filter((r) => r.status === "open" && !r.assigned_to && r.source !== "sla");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function distribute() {
    setBusy(true); setNotice("");
    try { const r = await distributeFollowups(unowned.map((x) => x.id)); setNotice(r.ok ? `وُزّعت: ${(r as { done?: number }).done ?? 0}` : errors[r.error] ?? r.error); await refresh(); }
    catch { setNotice(errors.failed); } finally { setBusy(false); }
  }
  return <div className="space-y-4">
    {unowned.length > 0 && <section className={`${card} flex flex-wrap items-center justify-between gap-3 border-[#9A3412]/30 p-4`}>
      <button className="text-right" onClick={() => show(unowned.map((r) => r.id), "بلا مسؤول")}><b className="text-[#9A3412]">{count(unowned.length, FILES)} بلا مسؤول</b><span className="block text-sm text-slate-500">موظف Teletel غير مربوط بموظف في النظام، أو حساب فريق. اختر «مسؤول التأشيرات» و«من يتولى اليوم السابع» في الإعدادات، أو وزّعها الآن.</span></button>
      <button disabled={busy} className={btnPrimary} onClick={() => void distribute()}>{busy ? <Loader2 className="animate-spin" size={15} /> : null}وزّع</button>
      {notice && <p role="status" className="w-full text-sm">{notice}</p>}
    </section>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{tiles.map(([label, value, ids]) => <button key={label} className={`${card} p-5 text-right`} onClick={() => ids.length && show(ids, label)}><p className="text-sm text-slate-500">{label}</p><p className="mt-2 text-2xl font-extrabold">{value}</p></button>)}</div>
    <section className={`${card} overflow-x-auto p-4`}><h2 className="mb-3 font-extrabold">البائعون هذا الأسبوع</h2>
      <table className="w-full min-w-[34rem] text-right text-sm"><thead><tr><th className="border-b p-2">البائع</th>{cols.map(([label]) => <th key={label} className="border-b p-2">{label}</th>)}</tr></thead>
        <tbody>{sellers.map((p) => <tr key={p.id} className="border-b border-[#EEF2EF]"><td className="p-2 font-bold">{p.name}</td>{cols.map(([label, test]) => {
          const ids = data.rows.filter((r) => r.assigned_to === p.id && test(r)).map((r) => r.id);
          return <td key={label} className="p-1"><button className="min-h-11 min-w-11 rounded-lg px-2 font-bold hover:bg-[#F4F6F3] disabled:font-normal disabled:text-slate-400" disabled={!ids.length} onClick={() => show(ids, `${p.name} · ${label}`)} style={{ color: label === "متأخرة" && ids.length ? CLAY : undefined }}>{ids.length}</button></td>;
        })}</tr>)}</tbody></table></section>
    <section className={`${card} p-4`}><h2 className="mb-3 font-extrabold">لماذا نخسر العملاء؟ <span className="text-xs font-normal text-slate-500">هذا الأسبوع · {lost.length} مغلقة</span></h2>
      <div className="space-y-2">{reasons.map(([reason, list]) => <button key={reason} className="block w-full text-right" disabled={!list.length} onClick={() => show(list.map((r) => r.id), `أُغلقت: ${reason}`)}><div className="flex justify-between text-sm"><span>{reason}</span><span>{lost.length ? Math.round((list.length / lost.length) * 100) : 0}% ({list.length})</span></div><div className="mt-1 h-2 rounded-full bg-[#F4F6F3]"><div className="h-full rounded-full" style={{ width: `${lost.length ? (list.length / lost.length) * 100 : 0}%`, background: CLAY }} /></div></button>)}</div></section>
    <Settings data={data} refresh={refresh} />
    <p className="text-xs text-slate-500">آخر مزامنة: {when(data.lastSync?.at ?? null)} · {data.lastSync?.ok ? "الاتصال يعمل" : "لم تتأكد المزامنة الأخيرة"} · تُوبع اليوم: {data.rows.filter((r) => isToday(r.last_attempt_at, now)).length} · أقدم ملف مفتوح منذ {since([...data.rows].filter((r) => r.status === "open").sort((a, b) => Date.parse(a.request_started_at) - Date.parse(b.request_started_at))[0]?.request_started_at ?? null, now)}</p>
  </div>;
}

function Settings({ data, refresh }: { data: FollowupWorkspaceData; refresh: () => Promise<void> }) {
  const [s, setS] = useState<FollowupSettings>(data.settings);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(next: FollowupSettings) {
    setS(next); setBusy(true); setNotice("");
    try { const r = await saveFollowupPageSettings(next); setNotice(r.ok ? "تم الحفظ." : errors[r.error] ?? r.error); await refresh(); }
    catch { setNotice(errors.failed); } finally { setBusy(false); }
  }
  const status = (n: string) => ({ APPROVED: ["معتمد ✓", GREEN], PENDING: ["بانتظار اعتماد ميتا", "#a86a10"], REJECTED: ["رفضته ميتا", CLAY] } as Record<string, [string, string]>)[data.templates?.[n] ?? ""] ?? ["لم يُرفع بعد", "#a86a10"];
  return <section className={`${card} space-y-4 p-4`}>
    <h2 className="font-extrabold">الإعدادات</h2>
    <fieldset disabled={busy} className="space-y-2"><legend className="text-sm font-bold">من يتولى اليوم السابع والإغلاق</legend>
      <div className="flex flex-wrap items-center gap-2">{([["seller", "البائع نفسه"], ["employee", "موظف متابعة محدد"], ["manager", "المدير"]] as [FollowupSettings["closer"], string][]).map(([k, label]) => <button key={k} className={s.closer === k ? btnPrimary : btn} onClick={() => k === "employee" ? setS({ ...s, closer: k }) : void save({ ...s, closer: k, closerId: null })}>{label}</button>)}
        {s.closer === "employee" && <select className={`${field} !w-auto min-h-11`} value={s.closerId ?? ""} onChange={(e) => e.target.value && void save({ ...s, closer: "employee", closerId: e.target.value })}><option value="">اختر الموظف…</option>{data.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}</div>
    </fieldset>
    <fieldset disabled={busy} className="space-y-2"><legend className="text-sm font-bold">مسؤول التأشيرات</legend>
      <select className={`${field} !w-auto min-h-11`} value={s.visaOwner ?? ""} onChange={(e) => void save({ ...s, visaOwner: e.target.value || null })}><option value="">لا أحد — تبقى للفريق</option>{data.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
      <p className="text-xs text-slate-500">متابعات التأشيرات التي لا يقابل موظفُ Teletel فيها موظفاً في النظام. يحتاج صلاحية «المتابعة» في الأدوار.</p>
    </fieldset>
    <fieldset disabled={busy} className="space-y-2"><legend className="text-sm font-bold">اقتراح مُراد بعد ساعتين</legend>
      <div className="flex flex-wrap gap-2">{([["note", "ملاحظة داخلية للبائع في Teletel"], ["off", "إيقاف"]] as [FollowupSettings["murad"], string][]).map(([k, label]) => <button key={k} className={s.murad === k ? btnPrimary : btn} onClick={() => void save({ ...s, murad: k })}>{label}</button>)}</div>
      <p className="text-xs text-slate-500">ملاحظة خاصة يراها الفريق فقط، ولا تصل إلى العميل أبدًا. كل رسالة للعميل يرسلها الموظف بضغطة.</p>
    </fieldset>
    <div className="text-sm"><b>الخطوات:</b> {STEP_LABELS.join(" ← ")} — رد العميل يوقفها، وتعود بعد ردنا.</div>
    <div className="text-sm"><b>«تنبيهاتي»:</b> كل بائع يصله في 10:00 و16:00 ما يستحق اليوم، وفورًا عند رد العميل.</div>
    <div className="space-y-1 text-sm"><b>قوالب واتساب (بعد 24 ساعة):</b>{Object.entries({ traveliun_offer_followup_1: "اليوم الأول", traveliun_offer_followup_2: "اليوم الثالث", traveliun_offer_followup_3: "آخر متابعة" }).map(([n, label]) => { const [t, c] = status(n); return <p key={n}>{label}: <span className="font-bold" style={{ color: c }}>{t}</span></p>; })}</div>
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </section>;
}
