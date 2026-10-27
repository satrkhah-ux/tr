"use client";

import { useState, type ReactNode } from "react";
import { BookOpen, BotMessageSquare, Check, GitBranch, Loader2, MapPin, RotateCcw, Save, Settings2, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { saveMuradControl, type getMuradControl } from "@/lib/data/murad-control";
import { KIND_MODES, TASK_LABELS, kindMode, validControl, visaForAll, type KindMode, type MuradControl } from "@/lib/murad/control";
import { ROUTE_KEYS } from "@/lib/murad/reception";
import { cn } from "@/lib/utils";

type Setup = NonNullable<Awaited<ReturnType<typeof getMuradControl>>>;
const field = "min-h-11 w-full min-w-0 rounded-xl border border-[#dbe6e1] bg-white px-3 py-2.5 text-sm text-[#185045] outline-none focus:border-[#185045] focus:ring-2 focus:ring-[#185045]/10 dark:border-[#294039] dark:bg-[#12241f] dark:text-[#eaf3ef]";
const card = "min-w-0 rounded-2xl border border-[#dbe6e1] bg-white p-4 sm:p-6 dark:border-[#294039] dark:bg-[#12241f]";
const hint = "text-sm leading-6 text-[#67847c] dark:text-[#9db8ae]";
const lines = (v: string) => v.split(/[\n,،]+/).map(x => x.trim()).filter(Boolean);
const editable = (c: MuradControl) => ({ ...c, admins: c.admins ?? [], noHandoff: c.noHandoff ?? [] });
const sections = [
  { id: "tasks", title: "المهام والردود", icon: SlidersHorizontal },
  { id: "routing", title: "التواجد والتحويل", icon: GitBranch },
  { id: "knowledge", title: "التعليمات والمعرفة", icon: BookOpen },
  { id: "offers", title: "البكجات والأسعار", icon: MapPin },
  { id: "management", title: "الإدارة والتشغيل", icon: Settings2 },
] as const;
const taskHints: Record<keyof typeof TASK_LABELS, string> = {
  reception: "يجمع الطلب ويوجهه إلى القسم المختص.", suggest: "يقترح إجابة يراجعها الموظف قبل إرسالها.",
  auto: "يرد مباشرة ضمن نطاق التشغيل المحدد.", offers: "يجمع تفاصيل الرحلة ويجهّز برنامجها.",
  visas: "يستلم طلب التأشيرة ويتابع المعلومات والمستندات.", holding: "يطمئن العميل إلى أن يتولى الموظف المحادثة.",
};

function Toggle({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className={cn("flex min-w-0 cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors", checked ? "border-[#9dc7b8] bg-[#f1f8f4] dark:bg-[#18372e]" : "border-[#e2ebe7] dark:border-[#294039]")}>
    <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[#185045]" />
    <span className="min-w-0"><span className="block text-sm font-bold">{title}</span><span className={cn(hint, "mt-1 block text-xs")}>{description}</span></span>
  </label>;
}

export function MuradSettings({ setup, routingDefaults, knowledge, offers, monitoring }: { setup: Setup; routingDefaults?: ReactNode; knowledge?: ReactNode; offers?: ReactNode; monitoring?: ReactNode }) {
  const [active, setActive] = useState<(typeof sections)[number]["id"]>("tasks");
  const [c, setC] = useState(() => editable(setup.control));
  const [saved, setSaved] = useState(() => editable(setup.control));
  const [loaded, setLoaded] = useState(JSON.stringify(setup.control));
  const [admins, setAdmins] = useState((setup.control.admins ?? []).join("\n"));
  const [noHandoff, setNoHandoff] = useState((setup.control.noHandoff ?? []).join("\n"));
  const [minutes, setMinutes] = useState(String(setup.control.late?.minutes ?? 15));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const draft = { ...c, admins: lines(admins), noHandoff: lines(noHandoff), ...(c.late ? { late: { ...c.late, minutes: Number(minutes) } } : {}) };
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const changedElsewhere = loaded !== JSON.stringify(setup.control);
  const current = changedElsewhere ? setup.control : saved;
  const editing = active === "tasks" || active === "routing" || active === "management";

  function reset(control: MuradControl) {
    setC(editable(control)); setSaved(editable(control));
    setAdmins((control.admins ?? []).join("\n")); setNoHandoff((control.noHandoff ?? []).join("\n"));
    setMinutes(String(control.late?.minutes ?? 15)); setMessage(null);
  }
  async function save() {
    if (busy || !dirty || changedElsewhere) return;
    if (!validControl(draft)) { setMessage({ ok: false, text: "تحقّق من أرقام الهاتف ورمز التجربة ومدة الانتظار (من 1 إلى 1440 دقيقة)." }); return; }
    setBusy(true); setMessage(null);
    try {
      const r = await saveMuradControl(draft);
      if (r.ok) { setC(draft); setSaved(draft); }
      setMessage({ ok: r.ok, text: r.ok ? "تم حفظ إعدادات مُراد" : r.error ?? "تعذّر الحفظ" });
    } catch { setMessage({ ok: false, text: "تعذّر الاتصال. التعديلات ما زالت محفوظة في هذه الصفحة." }); }
    finally { setBusy(false); }
  }

  return <div dir="rtl" className="min-w-0 space-y-5 text-[#185045] dark:text-[#eaf3ef]">
    <header className={card}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#185045] text-white"><BotMessageSquare size={25} /></span><div><h1 className="text-2xl font-extrabold">إعدادات مُراد</h1><p className={cn(hint, "mt-1")}>حدّد مهامه، أين يرد، ومن يتولى الطلب بعده.</p></div></div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#eef5f1] px-3 py-1.5 text-xs font-bold text-[#557d78]"><ShieldCheck size={15} />للإدارة والمطور</span>
      </div>
      <div className="mt-5 grid gap-3 border-t border-[#e2ebe7] pt-4 sm:grid-cols-3">
        <div><p className={hint}>المهام المحددة</p><p className="mt-1 font-extrabold">{Object.values(current.tasks).filter(Boolean).length} من {Object.keys(TASK_LABELS).length} مهام</p></div>
        <div><p className={hint}>نطاق التأشيرات المحفوظ</p><p className="mt-1 font-extrabold">{!current.tasks.visas ? "مهمة التأشيرات متوقفة" : visaForAll(current) ? "جميع العملاء" : "أرقام التجربة"}</p></div>
        <div><p className={hint}>الأسعار في الردود</p><p className="mt-1 font-extrabold">{current.includePrice ? "تُعرض مع التفاصيل" : "تفاصيل بدون سعر"}</p></div>
      </div>
    </header>

    <nav aria-label="أقسام إعدادات مُراد" className="grid grid-cols-2 gap-2 rounded-2xl border border-[#dbe6e1] bg-white p-2 sm:grid-cols-3 xl:grid-cols-5 dark:border-[#294039] dark:bg-[#12241f]">
      {sections.map(({ id, title, icon: Icon }) => <button key={id} type="button" aria-current={active === id ? "page" : undefined} aria-controls={`murad-${id}`} disabled={busy} onClick={() => setActive(id)} className={cn("flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition-colors disabled:opacity-60", active === id ? "bg-[#185045] text-white shadow-sm" : "text-[#557d78] hover:bg-[#f1f7f4]")}><Icon size={17} className="shrink-0" />{title}</button>)}
    </nav>
    {changedElsewhere ? <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p>تغيّرت الإعدادات المحفوظة، مثلاً بعد تنفيذ تعليمات الإدارة. حمّل النسخة الحالية قبل إجراء تعديل جديد.</p><button type="button" disabled={busy} onClick={() => { reset(setup.control); setLoaded(JSON.stringify(setup.control)); }} className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-2 font-bold">تحميل الإعدادات الحالية</button></div> : null}

    {/* Keep every panel mounted: switching sections must not discard an edit. */}
    <div id="murad-tasks" hidden={active !== "tasks"}>
      <fieldset disabled={busy} className={card}>
        <h2 className="text-lg font-extrabold">ما الذي يتولاه مُراد؟</h2><p className={cn(hint, "mt-1")}>تُنفّذ المهام المحددة ضمن نطاق التشغيل والأقسام المسموح بها.</p>
        <div className="mt-4 grid gap-3 md:grid-cols-2">{(Object.keys(TASK_LABELS) as (keyof typeof TASK_LABELS)[]).map(key => <Toggle key={key} title={TASK_LABELS[key]} description={taskHints[key]} checked={c.tasks[key]} onChange={value => setC({ ...c, tasks: { ...c.tasks, [key]: value } })} />)}</div>
        <div className="mt-6 border-t border-[#e2ebe7] pt-5"><h2 className="text-lg font-extrabold">طريقة الرد ومتابعة الطلب</h2>
          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <Toggle title="التأشيرات لجميع العملاء" description="استلام الطلب ومتابعة النواقص وصور المستندات." checked={c.visaAll === true} onChange={value => setC({ ...c, visaAll: value })} />
            <Toggle title="إظهار السعر في الإجابة" description="عند إيقافه تُرسل التفاصيل دون عرض أو رابط يحتوي على السعر." checked={c.includePrice} onChange={value => setC({ ...c, includePrice: value })} />
            <Toggle title="التعلّم من المحادثات السابقة" description="يراجع المحادثات تدريجياً، بدءاً بالأحدث." checked={c.learn === true} onChange={value => setC({ ...c, learn: value })} />
          </div>
          {c.visaAll && !c.tasks.visas ? <p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">تفعيل النطاق لجميع العملاء يتطلب تحديد مهمة «{TASK_LABELS.visas}» أيضاً.</p> : null}
        </div>
      </fieldset>
    </div>

    <div id="murad-routing" hidden={active !== "routing"} className="space-y-5">
      <fieldset disabled={busy} className={card}><h2 className="text-lg font-extrabold">أين يرد مُراد؟</h2><p className={cn(hint, "mt-1")}>حدّد صناديق المحادثات والأقسام. عند تحديد الاثنين، يجب أن تكون المحادثة ضمن كليهما.</p>
        <div className="mt-4 grid gap-5 lg:grid-cols-2">{(["inboxIds", "teamIds"] as const).map(key => <fieldset key={key} className="min-w-0 rounded-xl border border-[#e2ebe7] p-4"><legend className="px-2 text-sm font-bold">{key === "inboxIds" ? "صناديق المحادثات" : "الأقسام التي يرد فيها"}</legend><p className={cn(hint, "mb-3 text-xs")}>{c[key].length ? `${c[key].length} محدد` : "الكل ضمن نطاق التشغيل — لم تُفرض قيود هنا"}</p><div className="grid gap-2 sm:grid-cols-2">{(key === "inboxIds" ? setup.inboxes : setup.teams).map(x => <label key={x.id} className="flex min-w-0 cursor-pointer items-start gap-2 rounded-lg bg-[#f5f8f6] p-3 text-sm dark:bg-[#18372e]"><input type="checkbox" checked={c[key].includes(x.id)} onChange={e => setC({ ...c, [key]: e.target.checked ? [...c[key], x.id] : c[key].filter(id => id !== x.id) })} className="mt-0.5 h-4 w-4 shrink-0 accent-[#185045]" /><span className="break-words">{x.name}</span></label>)}</div>{!(key === "inboxIds" ? setup.inboxes : setup.teams).length ? <p role="alert" className={hint}>تعذّر تحميل القائمة من تليتيل.</p> : null}</fieldset>)}</div>
      </fieldset>
      <fieldset disabled={busy} className={card}><h2 className="text-lg font-extrabold">من يتولى كل نوع طلب؟</h2><p className={cn(hint, "mt-1")}>اختر تصرّف مُراد والقسم والموظف. الاختيار التلقائي يبحث عن موظف متاح، وإلا يبقى الطلب في القسم.</p>
        <div className="mt-4 space-y-3">{ROUTE_KEYS.map(key => { const h = c.handoffs[key] ?? { teamId: null, agentId: null }; return <div key={key} className="grid min-w-0 gap-3 rounded-xl border border-[#e2ebe7] bg-[#f8faf9] p-4 lg:grid-cols-[minmax(7rem,.7fr)_repeat(3,minmax(0,1fr))] dark:bg-[#18372e]">
          <strong className="self-center text-sm">{key === "موظف" ? "طلب موظف" : key === "غير واضح" ? "طلب غير واضح" : key}</strong>
          <label className="min-w-0 space-y-1"><span className={cn(hint, "text-xs")}>تصرّف مُراد</span><select aria-label={`ماذا يفعل مُراد مع ${key}`} className={field} value={kindMode(c, key)} onChange={e => setC({ ...c, kinds: { ...c.kinds, [key]: e.target.value as KindMode } })}>{Object.entries(KIND_MODES).map(([m, label]) => <option key={m} value={m}>{label}</option>)}</select></label>
          <label className="min-w-0 space-y-1"><span className={cn(hint, "text-xs")}>القسم المستلم</span><select aria-label={`قسم تحويل ${key}`} className={field} value={h.teamId ?? ""} onChange={e => setC({ ...c, handoffs: { ...c.handoffs, [key]: { ...h, teamId: e.target.value ? Number(e.target.value) : null } } })}><option value="">حسب جدول التحويل الافتراضي</option>{setup.teams.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label className="min-w-0 space-y-1"><span className={cn(hint, "text-xs")}>الموظف المستلم</span><select aria-label={`موظف تحويل ${key}`} className={field} value={h.agentId ?? ""} onChange={e => setC({ ...c, handoffs: { ...c.handoffs, [key]: { ...h, agentId: e.target.value ? Number(e.target.value) : null } } })}><option value="">تلقائي — موظف متاح في القسم</option>{setup.agents.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        </div>; })}</div>
      </fieldset>
      <fieldset disabled={busy} className={card}><h2 className="text-lg font-extrabold">المتابعة عند تأخر الرد</h2><p className={cn(hint, "mt-1")}>إذا لم يرد الموظف بعد التحويل، يُعاد إسناد المحادثة إلى الموظف المحدد هنا.</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="space-y-1 text-sm font-bold">الموظف البديل<select aria-label="موظف الرسائل المتأخرة" className={field} value={c.late?.agentId ?? ""} onChange={e => setC({ ...c, late: e.target.value ? { minutes: Number(minutes), agentId: Number(e.target.value) } : null })}><option value="">متوقف — لا تحويل تلقائي</option>{setup.agents.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label><label className="space-y-1 text-sm font-bold">مدة الانتظار بالدقائق<input type="number" min={1} max={1440} className={field} value={minutes} onChange={e => setMinutes(e.target.value)} /></label></div>
        <details className="mt-5 border-t border-[#e2ebe7] pt-4"><summary className="cursor-pointer text-sm font-bold">إيقاف التحويل مؤقتاً لموظفين ({c.paused?.length ?? 0})</summary><p className={cn(hint, "my-3")}>الموظفون المحددون هنا لا يستلمون تحويلات مُراد، وتبقى الطلبات في القسم.</p><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{setup.agents.map(x => <label key={x.id} className="flex items-start gap-2 rounded-lg bg-[#f5f8f6] p-3 text-sm dark:bg-[#18372e]"><input type="checkbox" checked={(c.paused ?? []).includes(x.id)} onChange={e => setC({ ...c, paused: e.target.checked ? [...(c.paused ?? []), x.id] : (c.paused ?? []).filter(id => id !== x.id) })} className="mt-0.5 h-4 w-4 shrink-0 accent-[#185045]" />{x.name}</label>)}</div></details>
      </fieldset>
      {routingDefaults ? <details className={card}><summary className="cursor-pointer font-bold">جدول التحويل الافتراضي وأوقات الدوام</summary><p className={cn(hint, "my-3")}>يُستخدم عندما لا تختار قسماً محدداً أعلاه. له حفظ مستقل.</p>{routingDefaults}</details> : null}
    </div>

    <div id="murad-knowledge" hidden={active !== "knowledge"} className="space-y-5">{knowledge}</div>
    <div id="murad-offers" hidden={active !== "offers"}>{offers ?? <p className={card}>لا تتوفر إعدادات البكجات لهذا الحساب.</p>}</div>
    <div id="murad-management" hidden={active !== "management"} className="space-y-5">
      <fieldset disabled={busy} className={card}><h2 className="text-lg font-extrabold">أرقام الإدارة والتجربة</h2><p className={cn(hint, "mt-1")}>أرقام بصيغة دولية، كل رقم في سطر.</p><div className="mt-4 grid gap-5 lg:grid-cols-3">
        <label className="min-w-0 space-y-2 text-sm"><span className="font-bold">أرقام الإدارة</span><span className={cn(hint, "block text-xs")}>تُعامل رسائلها كتعليمات إدارية وتُستخدم للتجربة.</span><textarea dir="ltr" rows={4} className={field} value={admins} onChange={e => setAdmins(e.target.value)} /></label>
        <label className="min-w-0 space-y-2 text-sm"><span className="font-bold">أرقام لا تُحوّل للموظفين</span><span className={cn(hint, "block text-xs")}>يرد عليها مُراد ويُبقي المحادثة دون إسناد.</span><textarea dir="ltr" rows={4} className={field} value={noHandoff} onChange={e => setNoHandoff(e.target.value)} /></label>
        <label className="min-w-0 space-y-2 text-sm"><span className="font-bold">رمز بدء تجربة جديدة</span><span className={cn(hint, "block text-xs")}>يُرسل من رقم إدارة لبدء تجربة جديدة. من 4 إلى 12 رقماً.</span><input dir="ltr" inputMode="numeric" className={field} value={c.resetCode ?? ""} onChange={e => setC({ ...c, resetCode: e.target.value.replace(/\D/g, "") || undefined })} /></label>
      </div></fieldset>
      {monitoring ? <details className={card}><summary className="cursor-pointer font-bold">التشغيل الفعلي وسجل النشاط — للمطور</summary><div className="mt-4 space-y-5">{monitoring}</div></details> : null}
    </div>

    {editing || dirty || message ? <div className="sticky bottom-[calc(76px+env(safe-area-inset-bottom))] z-20 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#c9ddd3] bg-white p-3 shadow-[0_-4px_24px_#123c3010] sm:gap-3 sm:p-4 lg:bottom-0 dark:bg-[#12241f]">
      <div aria-live="polite" className="text-sm"><p className={cn("flex items-center gap-2 font-bold", dirty ? "text-[#97681d]" : "text-[#557d78]")}>{dirty ? <span className="h-2 w-2 rounded-full bg-amber-500" /> : <Check size={17} />}{dirty ? "تعديلات لم تُحفظ" : "الإعدادات محفوظة"}</p>{message ? <p role={message.ok ? "status" : "alert"} className={cn("mt-1 text-xs", message.ok ? "text-[#0f7a52]" : "text-[#b22e4b]")}>{message.text}</p> : null}</div>
      <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto"><button type="button" aria-label="تراجع عن التعديلات" disabled={busy || !dirty} onClick={() => reset(saved)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#dbe6e1] px-3 text-sm font-bold disabled:opacity-40"><RotateCcw size={16} /><span>تراجع<span className="hidden sm:inline"> عن التعديلات</span></span></button><button type="button" aria-label="حفظ إعدادات مُراد" onClick={save} disabled={busy || !dirty || changedElsewhere} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#185045] px-3 text-sm font-bold text-white disabled:opacity-50 sm:px-5">{busy ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />}{busy ? "جارٍ الحفظ…" : <span>حفظ<span className="hidden sm:inline"> إعدادات مُراد</span></span>}</button></div>
    </div> : null}
  </div>;
}
