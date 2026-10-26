"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FileText, ImageIcon, Link2Off, Loader2, MessageCircle, Paperclip, Search } from "lucide-react";
import { DirText } from "@/components/DirText";
import { createVisaFile, pullFromTeletel, searchTeletelForVisa, visaCatalogFor } from "@/lib/data/visa-files";
import { CURRENCIES } from "@/lib/offer/draft-types";
import { useRole } from "@/lib/roles/RoleContext";
import type { TeletelCandidate, TeletelPull } from "@/lib/visa-files/types";
import {
  applyCatalogRow,
  applyPull,
  buildNewFile,
  emptyNewFile,
  epochMs,
  fmtDateTime,
  isVisaManager,
  money,
  resolveCountry,
  settle,
  unlinkPull,
  type FormErrors,
  type NewFileForm,
} from "@/lib/visa-files/ui";
import { SuggestInput } from "../SuggestInput";
import { VisaServicesEditor } from "./VisaServicesEditor";
import { Notice, area, btn, btnPrimary, card, field, heading, label, useUnsavedGuard, type Person } from "./visa-ui";

export type CatalogRow = { id: string; visaType: string | null; sellPrice: number | null; sellCurrency: string | null; requirements: string[] };
export type CatalogState = { kind: "idle" } | { kind: "loading" } | { kind: "none" } | { kind: "error"; message: string } | { kind: "ready"; rows: CatalogRow[] };
export type TeleState = { q: string; phase: "idle" | "loading" | "done" | "error"; candidates: TeletelCandidate[]; message: string; pulling: number | null; pull: TeletelPull | null };

type ViewProps = {
  form: NewFileForm;
  set: (patch: Partial<NewFileForm>) => void;
  countries: { id: string; name: string }[];
  people: Person[];
  manager: boolean;
  tele: TeleState;
  onSearch: (q: string) => void;
  onPull: (conversationId: number) => void;
  onUnlink: () => void;
  catalog: CatalogState;
  onCatalog: (rowId: string | null) => void;
  onCountry: (value: string, picked: boolean) => void;
  submit: { busy: boolean; error: string; errors: FormErrors; created: { id: string; serial: string } | null };
  onSubmit: () => void;
};

/** /visa-files/new — one page, no stages: pull the client from Teletel, then country, applicants, date, services, fees. */
export function VisaNewFileView(p: ViewProps) {
  const { form, set, tele, catalog, submit } = p;
  const fieldError = (key: keyof FormErrors) => (submit.errors[key] ? <span className="text-[12px] font-bold text-[#c22850]">{submit.errors[key]}</span> : null);
  const chosen = catalog.kind === "ready" ? catalog.rows.find((r) => r.id === form.visaCatalogId) : undefined;
  return (
    <form
      dir="rtl"
      noValidate
      className="mx-auto max-w-3xl space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        p.onSubmit();
      }}
    >
      <section className={card}>
        <h1 className="text-xl font-extrabold text-[#003c3a]">ملف تأشيرة جديد</h1>
        <p className="mt-1 text-[13px] font-semibold text-[#6f8f88]">اسحب بيانات العميل من تليتيل أو أدخلها بيدك، ثم الدولة والعدد والخدمات.</p>
      </section>

      <section className={`${card} space-y-3`} aria-labelledby="pull-h">
        <h2 id="pull-h" className={`${heading} flex items-center gap-2`}><MessageCircle className="size-4" /> اسحب من تليتيل</h2>
        {tele.pull ? (
          <div className="space-y-3">
            <p className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-[#e9f7f0] px-3 py-2 text-sm font-bold text-[#0f7a52]">
              <span>سُحبت بيانات محادثة <DirText>#{tele.pull.conversationId}</DirText> — {tele.pull.clientName}</span>
              <button type="button" className="inline-flex min-h-11 items-center gap-1.5 rounded-[10px] px-2 text-[#c22850] hover:bg-[#fdecef]" onClick={p.onUnlink}><Link2Off className="size-4" /> فك الربط</button>
            </p>
            {tele.pull.intake ? (
              <p className="text-[13px] font-semibold text-[#557d78]">
                ما عرفه مُراد: {[tele.pull.intake.country && `الدولة ${tele.pull.intake.country}`, tele.pull.intake.nationality && `الجنسية ${tele.pull.intake.nationality}`, tele.pull.intake.applicants && `${tele.pull.intake.applicants} متقدمين`].filter(Boolean).join(" · ") || "لم يجمع شيئاً بعد"}
              </p>
            ) : null}
            <Attachments pull={tele.pull} />
          </div>
        ) : (
          <>
            <label className={label}>
              ابحث بالاسم أو الرقم
              <span className="relative block">
                <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-[#8aa29b]" />
                <input type="search" className={`${field} ps-9`} value={tele.q} onChange={(e) => p.onSearch(e.target.value)} placeholder="اسم العميل أو جواله" />
              </span>
            </label>
            {tele.phase === "loading" ? <Notice tone="busy">جارٍ البحث في تليتيل…</Notice> : null}
            {tele.message ? <Notice tone="error">{tele.message}</Notice> : null}
            {tele.phase === "done" && tele.candidates.length === 0 ? <p className="text-sm font-semibold text-[#6f8f88]">لا توجد محادثة بهذا الاسم أو الرقم. يمكنك إدخال بيانات العميل بيدك أدناه.</p> : null}
            {tele.candidates.length > 0 ? (
              <ul className="space-y-2" aria-label="محادثات تليتيل">
                {tele.candidates.map((c) => (
                  <li key={c.conversationId}>
                    <button type="button" disabled={tele.pulling !== null} onClick={() => p.onPull(c.conversationId)} className="flex min-h-14 w-full items-center justify-between gap-3 rounded-[10px] border border-[#dbe6e1] bg-white px-3 py-2 text-start hover:bg-[#f4f8f6] disabled:opacity-60">
                      <span className="min-w-0">
                        <span className="block truncate font-extrabold text-[#003c3a]">{c.contactName || `عميل #${c.conversationId}`}</span>
                        <span className="block text-xs text-[#6f8f88]">
                          {c.phone ? <DirText>{c.phone}</DirText> : "بلا رقم"} · آخر نشاط {fmtDateTime(new Date(epochMs(c.lastActivityAt)).toISOString())}
                          {c.assignee ? ` · ${c.assignee}` : ""}
                        </span>
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-bold text-[#185045]">
                        {tele.pulling === c.conversationId ? <Loader2 className="size-4 animate-spin" /> : null} اسحب
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </section>

      <section className={`${card} grid gap-3 sm:grid-cols-2`} aria-labelledby="client-h">
        <h2 id="client-h" className={`${heading} sm:col-span-2`}>العميل</h2>
        <label className={label}>اسم العميل *
          <input className={field} value={form.clientName} onChange={(e) => set({ clientName: e.target.value })} aria-invalid={Boolean(submit.errors.clientName)} />
          {fieldError("clientName")}
        </label>
        <label className={label}>الجوال
          <input className={field} dir="ltr" inputMode="tel" value={form.clientPhone} onChange={(e) => set({ clientPhone: e.target.value })} />
        </label>
        <label className={label}>الجنسية
          <input className={field} value={form.nationality} onChange={(e) => set({ nationality: e.target.value })} />
        </label>
      </section>

      <section className={`${card} grid gap-3 sm:grid-cols-2`} aria-labelledby="req-h">
        <h2 id="req-h" className={`${heading} sm:col-span-2`}>الطلب</h2>
        <div className={label}>
          الدولة *
          <SuggestInput value={form.country} items={p.countries.map((c) => ({ value: c.name }))} onChange={p.onCountry} className={field} ariaLabel="الدولة" placeholder="اكتب الدولة أو اخترها" />
          {fieldError("country")}
        </div>
        <label className={label}>عدد المتقدمين *
          <input className={field} dir="ltr" inputMode="numeric" value={form.applicants} onChange={(e) => set({ applicants: e.target.value.replace(/[^\d]/g, "") })} aria-invalid={Boolean(submit.errors.applicants)} />
          {fieldError("applicants")}
        </label>
        <label className={label}>تاريخ التقديم
          <input className={field} type="date" value={form.appliedAt} onChange={(e) => set({ appliedAt: e.target.value })} />
          {fieldError("appliedAt")}
        </label>
        <label className={label}>نوع التأشيرة
          <input className={field} value={form.visaType} onChange={(e) => set({ visaType: e.target.value })} placeholder="سياحية، زيارة، عبور…" />
        </label>
        <div className="sm:col-span-2" aria-live="polite">
          {catalog.kind === "loading" ? <Notice tone="busy">جارٍ البحث في قائمة التأشيرات…</Notice> : null}
          {catalog.kind === "error" ? <Notice tone="error">{`تعذّر قراءة قائمة التأشيرات، يمكنك المتابعة بإدخال النوع والرسوم بيدك. ${catalog.message}`}</Notice> : null}
          {catalog.kind === "none" ? <p className="text-[13px] font-semibold text-[#6f8f88]">لا توجد هذه الدولة في قائمة التأشيرات؛ أدخل النوع والرسوم بيدك.</p> : null}
          {catalog.kind === "ready" ? (
            <fieldset className="space-y-2">
              <legend className="mb-1 text-[12px] font-bold text-[#185045]">من قائمة التأشيرات والأسعار — اختر نوع التأشيرة</legend>
              {catalog.rows.map((r) => (
                <label key={r.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-sm font-semibold text-[#185045]">
                  <input type="radio" name="catalog" className="size-5 accent-[#185045]" checked={form.visaCatalogId === r.id} onChange={() => p.onCatalog(r.id)} />
                  <span className="min-w-0 flex-1">{r.visaType ?? "تأشيرة"}</span>
                  {r.sellPrice !== null && r.sellCurrency ? <DirText className="tv-tnum font-extrabold">{money(r.sellPrice, r.sellCurrency)}</DirText> : null}
                </label>
              ))}
              {form.visaCatalogId ? <button type="button" className={btn} onClick={() => p.onCatalog(null)}>بلا ربط بالقائمة</button> : null}
              {chosen && chosen.requirements.length > 0 ? (
                <div className="rounded-[10px] bg-[#f7faf8] p-3">
                  <p className="text-[12px] font-bold text-[#185045]">المستندات المطلوبة — ستُضاف إلى الملف عند إنشائه</p>
                  <ul className="mt-1 list-inside list-disc text-sm text-[#557d78]">{chosen.requirements.map((r) => <li key={r}>{r}</li>)}</ul>
                </div>
              ) : null}
            </fieldset>
          ) : null}
        </div>
      </section>

      <section className={`${card} space-y-3`} aria-labelledby="svc-h">
        <h2 id="svc-h" className={heading}>الخدمات المقدمة</h2>
        <VisaServicesEditor value={form.services} onChange={(services) => set({ services })} disabled={submit.busy} />
        {fieldError("services")}
      </section>

      <section className={`${card} grid gap-3 sm:grid-cols-3`} aria-labelledby="fee-h">
        <h2 id="fee-h" className={`${heading} sm:col-span-3`}>الرسوم</h2>
        <label className={label}>رسوم الخدمة
          <input className={field} dir="ltr" inputMode="decimal" value={form.feeService} onChange={(e) => set({ feeService: e.target.value })} placeholder="0" />
        </label>
        <label className={label}>رسوم السفارة
          <input className={field} dir="ltr" inputMode="decimal" value={form.feeEmbassy} onChange={(e) => set({ feeEmbassy: e.target.value })} placeholder="0" />
        </label>
        <label className={label}>العملة
          <select className={field} value={form.currency} onChange={(e) => set({ currency: e.target.value })}>
            {[...new Set([...CURRENCIES, form.currency])].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <div className="sm:col-span-3">{fieldError("fees")}</div>
      </section>

      <section className={`${card} grid gap-3`} aria-labelledby="own-h">
        <h2 id="own-h" className={heading}>المسؤول والملاحظة</h2>
        {p.manager ? (
          <label className={label}>الموظف المسؤول
            <select className={field} value={form.assignedTo} onChange={(e) => set({ assignedTo: e.target.value })}>
              <option value="">أنا (الافتراضي)</option>
              {p.people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
        ) : (
          <p className="text-[13px] font-semibold text-[#557d78]">سيُسند الملف إليك.</p>
        )}
        <label className={label}>ملاحظة
          <textarea className={area} value={form.note} onChange={(e) => set({ note: e.target.value })} />
        </label>
      </section>

      <div className="sticky bottom-[calc(72px+env(safe-area-inset-bottom))] z-10 space-y-2 lg:bottom-0">
        {submit.error ? <Notice tone="error">{submit.error}</Notice> : null}
        {Object.keys(submit.errors).length > 0 ? <Notice tone="error">راجع الحقول المظللة أعلاه.</Notice> : null}
        {submit.created ? <Notice tone="ok">{`أُنشئ الملف ${submit.created.serial}. جارٍ فتحه…`}</Notice> : null}
        <button type="submit" className={`${btnPrimary} w-full`} disabled={submit.busy || submit.created !== null}>
          {submit.busy ? <Loader2 className="size-4 animate-spin" /> : null} إنشاء الملف
        </button>
      </div>
    </form>
  );
}

/** what the conversation holds: chips, one per attachment, to be filed as documents on the saved file */
function Attachments({ pull }: { pull: TeletelPull }) {
  if (pull.attachments.length === 0) return <p className="text-[13px] font-semibold text-[#6f8f88]">لا مرفقات في هذه المحادثة.</p>;
  return (
    <div>
      <p className="mb-2 text-[12px] font-bold text-[#185045]">مرفقات المحادثة ({pull.attachments.length}) — تُصنَّف مستنداتٍ بعد إنشاء الملف</p>
      <ul className="flex flex-wrap gap-2">
        {pull.attachments.map((a) => {
          const Icon = a.fileType.startsWith("image") ? ImageIcon : a.fileType.includes("pdf") ? FileText : Paperclip;
          return (
            <li key={`${a.messageId}-${a.attachmentId}`} className="inline-flex max-w-full items-center gap-2 rounded-full border border-[#dbe6e1] bg-white px-3 py-1.5 text-xs font-bold text-[#185045]">
              <Icon className="size-4 shrink-0" />
              <span className="max-w-48 truncate">{a.fileName}</span>
              <span className="shrink-0 font-semibold text-[#8aa29b]">{a.fromClient ? "من العميل" : "منا"}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const IDLE_TELE: TeleState = { q: "", phase: "idle", candidates: [], message: "", pulling: null, pull: null };

/** The page's logic: the form, the Teletel search and pull, the catalogue lookup, the create. */
export function VisaNewFile({ countries, people }: { countries: { id: string; name: string }[]; people: Person[] }) {
  const router = useRouter();
  const { can } = useRole();
  const manager = isVisaManager(can);
  const [form, setForm] = useState<NewFileForm>(emptyNewFile);
  const [tele, setTele] = useState<TeleState>(IDLE_TELE);
  const [catalog, setCatalog] = useState<CatalogState>({ kind: "idle" });
  const [submit, setSubmit] = useState<ViewProps["submit"]>({ busy: false, error: "", errors: {}, created: null });
  const searchTicket = useRef(0);
  const catalogTicket = useRef(0);
  const sending = useRef(false);
  const set = (patch: Partial<NewFileForm>) => setForm((f) => ({ ...f, ...patch }));
  const dirty = JSON.stringify(form) !== JSON.stringify(emptyNewFile()) && !submit.created;
  useUnsavedGuard(dirty);

  // the search waits for a pause in the typing, and only the newest answer is kept
  useEffect(() => {
    const q = tele.q.trim();
    if (tele.pull || q.length < 2) return;
    const mine = ++searchTicket.current;
    const timer = setTimeout(async () => {
      setTele((t) => ({ ...t, phase: "loading", message: "" }));
      const r = await settle(() => searchTeletelForVisa(q));
      if (mine !== searchTicket.current) return;
      setTele((t) => (r.ok ? { ...t, phase: "done", candidates: r.candidates } : { ...t, phase: "error", candidates: [], message: r.error }));
    }, 350);
    return () => clearTimeout(timer);
  }, [tele.q, tele.pull]);

  // the catalogue is asked once the country has stopped changing
  const country = form.country.trim();
  useEffect(() => {
    if (!country) return;
    const mine = ++catalogTicket.current;
    const timer = setTimeout(async () => {
      setCatalog({ kind: "loading" });
      const r = await settle(() => visaCatalogFor(country));
      if (mine !== catalogTicket.current) return;
      if (!r.ok) return setCatalog({ kind: "error", message: r.error });
      if (r.rows.length === 0) return setCatalog({ kind: "none" });
      setCatalog({ kind: "ready", rows: r.rows });
      // one row is the answer; several are the employee's to choose
      if (r.rows.length === 1) setForm((f) => (f.visaCatalogId ? f : applyCatalogRow(f, r.rows[0])));
    }, 500);
    return () => clearTimeout(timer);
  }, [country]);

  function onSearch(q: string) {
    if (q.trim().length < 2) {
      searchTicket.current++;
      setTele((t) => ({ ...t, q, phase: "idle", candidates: [], message: "" }));
    } else setTele((t) => ({ ...t, q }));
  }
  async function onPull(conversationId: number) {
    setTele((t) => ({ ...t, pulling: conversationId, message: "" }));
    const r = await settle(() => pullFromTeletel(conversationId));
    if (!r.ok) return setTele((t) => ({ ...t, pulling: null, message: r.error }));
    setTele((t) => ({ ...t, pulling: null, pull: r.pull, candidates: [], phase: "idle" }));
    setForm((f) => {
      const next = applyPull(f, r.pull);
      return { ...next, countryId: resolveCountry(countries, next.country).id };
    });
  }
  function onCountry(value: string, picked: boolean) {
    const hit = resolveCountry(countries, value);
    // a different country is a different list: the old catalogue row no longer applies
    setForm((f) => ({ ...f, country: picked && hit.id ? hit.name : value, countryId: hit.id, visaCatalogId: f.country.trim() === value.trim() ? f.visaCatalogId : null }));
    if (!value.trim()) setCatalog({ kind: "idle" });
  }
  function onCatalog(rowId: string | null) {
    const row = catalog.kind === "ready" ? catalog.rows.find((r) => r.id === rowId) : undefined;
    setForm((f) => applyCatalogRow(f, row ?? null));
  }
  async function onSubmit() {
    if (sending.current) return;
    const built = buildNewFile(form);
    if (!built.ok) return setSubmit((s) => ({ ...s, errors: built.errors, error: "" }));
    sending.current = true;
    setSubmit({ busy: true, error: "", errors: {}, created: null });
    const r = await settle(() => createVisaFile(built.input));
    if (!r.ok) {
      sending.current = false;
      return setSubmit({ busy: false, error: `لم يُنشأ الملف. ${r.error}`, errors: {}, created: null });
    }
    // the lock stays on: a second press must not make a second file while the page changes
    setSubmit({ busy: false, error: "", errors: {}, created: { id: r.id, serial: r.serial } });
    router.push(`/visa-files/${r.id}`);
  }

  return (
    <VisaNewFileView
      form={form}
      set={set}
      countries={countries}
      people={people}
      manager={manager}
      tele={tele}
      onSearch={onSearch}
      onPull={(id) => void onPull(id)}
      onUnlink={() => {
        setTele(IDLE_TELE);
        setForm(unlinkPull);
      }}
      catalog={catalog}
      onCatalog={onCatalog}
      onCountry={onCountry}
      submit={submit}
      onSubmit={() => void onSubmit()}
    />
  );
}
