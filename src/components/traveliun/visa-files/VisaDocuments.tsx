"use client";

import { useRef, useState } from "react";
import { Check, ExternalLink, FileSearch, Loader2, MessageCircle, Paperclip, Plus, Trash2, Upload } from "lucide-react";
import { DirText } from "@/components/DirText";
import { importTeletelAttachment, pullFromTeletel, readVisaPassport, removeVisaDocument, setVisaDocument, uploadVisaDocument, visaDocumentUrl } from "@/lib/data/visa-files";
import {
  VISA_DOC_KINDS,
  VISA_DOC_LABEL,
  type TeletelPull,
  type VisaActionResult,
  type VisaDoc,
  type VisaDocKind,
  type VisaTraveler,
} from "@/lib/visa-files/types";
import { docState, docTotals, fmtDate, importTargets, settle, sortedDocs, type DocState } from "@/lib/visa-files/ui";
import { Notice, btn, btnDanger, card, field, heading, label, type Message } from "./visa-ui";

const MAX_BYTES = 15 * 1024 * 1024;
const STATE_CHIP: Record<DocState, { text: string; tone: string }> = {
  received: { text: "مستلم", tone: "bg-[#e9f7f0] text-[#0f7a52]" },
  missing: { text: "ناقص", tone: "bg-[#fdecef] text-[#c22850]" },
  optional: { text: "اختياري", tone: "bg-[#eef1f4] text-[#5b6b78]" },
};
type Attachment = TeletelPull["attachments"][number];
const attachmentKey = (a: Attachment) => `${a.messageId}-${a.attachmentId}`;

type Read = { docId: string; traveler: Partial<VisaTraveler>; target: string };

/**
 * «المستندات» — «ماذا أرفق»: what the file expects and what has come, the missing ones first. Each action here
 * saves at once (a file is not a draft), one at a time; the passport reader's answer is only a proposal, put into
 * the travellers' draft for the employee to confirm there.
 */
export function VisaDocuments({
  fileId, documents, travelers, conversationId, onChanged, onApplyRead,
}: {
  fileId: string;
  documents: VisaDoc[];
  travelers: VisaTraveler[];
  conversationId: number | null;
  /** an action succeeded: reload the file */
  onChanged: () => Promise<void>;
  /** the employee accepted a passport read: put it into this traveller ("new" — a new one) */
  onApplyRead: (target: string, read: Partial<VisaTraveler>) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [opened, setOpened] = useState<{ docId: string; url: string } | null>(null);
  const [read, setRead] = useState<Read | null>(null);
  const [add, setAdd] = useState<{ kind: VisaDocKind; label: string; travelerId: string }>({ kind: "passport", label: "", travelerId: "" });
  const [tele, setTele] = useState<{ phase: "idle" | "loading" | "ready" | "error"; attachments: Attachment[]; error: string }>({ phase: "idle", attachments: [], error: "" });
  const [targets, setTargets] = useState<Record<string, string>>({});
  const lock = useRef(false);
  const totals = docTotals(documents);
  const nameOf = (id: string | null) => (id ? travelers.find((t) => t.id === id)?.fullName || "مسافر" : "");

  /** one action at a time; a second press while one runs does nothing */
  async function act<T extends object>(key: string, work: () => Promise<VisaActionResult<T>>, ok: string, reload = true): Promise<VisaActionResult<T> | null> {
    if (lock.current) return null;
    lock.current = true;
    setBusy(key);
    setMessage({ tone: "busy", text: "جارٍ التنفيذ…" });
    const r = await settle(work);
    lock.current = false;
    setBusy(null);
    if (!r.ok) {
      setMessage({ tone: "error", text: r.error });
      return r;
    }
    // an empty `ok` is a step that says nothing of its own (the link opened, the first half of an import)
    setMessage(ok ? { tone: "ok", text: ok } : null);
    if (reload) await onChanged();
    return r;
  }

  const upload = (d: VisaDoc, file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES) return setMessage({ tone: "error", text: "الملف أكبر من 15 ميغابايت؛ صغّر الصورة أو ارفع ملفاً أصغر." });
    const form = new FormData();
    form.append("file", file);
    void act(`up:${d.id}`, () => uploadVisaDocument(fileId, d.id, form), `رُفع «${file.name}» إلى ${d.label || VISA_DOC_LABEL[d.kind]}.`);
  };
  async function open(d: VisaDoc) {
    const r = await act(`open:${d.id}`, () => visaDocumentUrl(fileId, d.id), "", false);
    if (!r?.ok) return;
    // a phone may block a window opened after a wait: the link below is the way in then
    setOpened(window.open(r.url, "_blank", "noopener") ? null : { docId: d.id, url: r.url });
  }
  async function readPassport(d: VisaDoc) {
    const r = await act(`read:${d.id}`, () => readVisaPassport(fileId, d.id), "قُرئ الجواز. راجع البيانات أدناه ثم اعتمدها.", false);
    if (!r?.ok) return;
    const empty = travelers.find((t) => !t.passportNo && !t.fullName.trim()) ?? (travelers.length === 1 ? travelers[0] : undefined);
    setRead({ docId: d.id, traveler: r.traveler, target: d.travelerId ?? empty?.id ?? "new" });
  }
  const addExpected = () =>
    void act("add", () => setVisaDocument(fileId, { kind: add.kind, label: add.label.trim() || undefined, travelerId: add.travelerId || null, required: true }), "أُضيف المستند إلى القائمة.").then((r) => {
      if (r?.ok) setAdd((a) => ({ ...a, label: "" }));
    });
  async function loadTeletel() {
    if (conversationId === null) return;
    setTele({ phase: "loading", attachments: [], error: "" });
    const r = await settle(() => pullFromTeletel(conversationId));
    setTele(r.ok ? { phase: "ready", attachments: r.pull.attachments, error: "" } : { phase: "error", attachments: [], error: r.error });
  }
  async function importOne(a: Attachment, target: string) {
    const [mode, value] = [target.slice(0, target.indexOf(":")), target.slice(target.indexOf(":") + 1)];
    let docId = mode === "doc" ? value : "";
    if (mode === "new") {
      const made = await act(`import:${attachmentKey(a)}`, () => setVisaDocument(fileId, { kind: value as VisaDocKind, required: true }), "", false);
      if (!made?.ok) return;
      docId = made.docId;
    }
    if (!docId) return;
    await act(`import:${attachmentKey(a)}`, () => importTeletelAttachment(fileId, { messageId: a.messageId, attachmentId: a.attachmentId, docId }), `استُورد «${a.fileName}» من المحادثة.`);
  }

  const options = importTargets(documents, VISA_DOC_LABEL, VISA_DOC_KINDS);
  return (
    <section id="documents" aria-labelledby="documents-h" className={`${card} scroll-mt-24 space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="documents-h" className={heading}>المستندات — ماذا أرفق</h2>
        <span className={`rounded-full px-3 py-0.5 text-xs font-extrabold ${totals.missing > 0 ? "bg-[#fdecef] text-[#c22850]" : "bg-[#e9f7f0] text-[#0f7a52]"}`}>
          {totals.required === 0 ? "لا مستندات مطلوبة بعد" : totals.missing > 0 ? `ناقص ${totals.missing} من ${totals.required}` : `اكتملت المستندات (${totals.required})`}
        </span>
      </div>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {opened ? <a href={opened.url} target="_blank" rel="noreferrer" className={`${btn} w-full`}><ExternalLink className="size-4" /> افتح الملف</a> : null}

      {documents.length === 0 ? <p className="text-sm font-semibold text-[#8aa29b]">لا مستندات بعد. أضف ما يطلبه الملف من النموذج أدناه.</p> : null}
      <ul className="space-y-2">
        {sortedDocs(documents).map((d) => {
          const state = docState(d);
          const chip = STATE_CHIP[state];
          const title = d.label && d.label !== VISA_DOC_LABEL[d.kind] ? `${VISA_DOC_LABEL[d.kind]} — ${d.label}` : (d.label || VISA_DOC_LABEL[d.kind]);
          return (
            <li key={d.id} className="space-y-2 rounded-[12px] border border-[#e2ebe7] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 basis-40 font-extrabold text-[#003c3a]">{title}</p>
                {d.travelerId ? <span className="rounded-full bg-[#eef4f1] px-3 py-0.5 text-xs font-bold text-[#557d78]">{nameOf(d.travelerId)}</span> : null}
                <span className={`rounded-full px-3 py-0.5 text-xs font-extrabold ${chip.tone}`}>{state === "received" ? <><Check className="me-1 inline size-3" />{chip.text}</> : chip.text}</span>
                {d.submittedAt ? <span className="rounded-full bg-[#e8eefc] px-3 py-0.5 text-xs font-extrabold text-[#3b4fa8]">قُدِّم للسفارة</span> : null}
              </div>
              {d.fileName ? (
                <p className="flex flex-wrap items-center gap-x-3 text-xs font-semibold text-[#557d78]">
                  <Paperclip className="size-3.5" /> <DirText>{d.fileName}</DirText>
                  {d.receivedAt ? <span>استُلم {fmtDate(d.receivedAt)}</span> : null}
                  {d.fromMessageId !== null ? <span className="inline-flex items-center gap-1"><MessageCircle className="size-3" /> من تليتيل</span> : null}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <label className={`${btn} cursor-pointer focus-within:ring-2 focus-within:ring-[#2aa87a] ${busy !== null ? "pointer-events-none opacity-50" : ""}`}>
                  {busy === `up:${d.id}` ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} {d.path ? "استبدال الملف" : "رفع الملف"}
                  <input type="file" className="sr-only" accept="image/*,application/pdf" disabled={busy !== null} onChange={(e) => { upload(d, e.target.files?.[0]); e.target.value = ""; }} />
                </label>
                {d.path ? <button type="button" className={btn} disabled={busy !== null} onClick={() => void open(d)}>{busy === `open:${d.id}` ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />} فتح</button> : null}
                {d.path && d.kind === "passport" ? <button type="button" className={btn} disabled={busy !== null} onClick={() => void readPassport(d)}>{busy === `read:${d.id}` ? <Loader2 className="size-4 animate-spin" /> : <FileSearch className="size-4" />} اقرأ الجواز</button> : null}
                {d.receivedAt ? (
                  <button type="button" className={btn} disabled={busy !== null} aria-pressed={Boolean(d.submittedAt)}
                    onClick={() => void act(`sub:${d.id}`, () => setVisaDocument(fileId, { docId: d.id, kind: d.kind, submitted: !d.submittedAt }), d.submittedAt ? "أُلغي تحديده كمُقدَّم." : "حُدِّد كمُقدَّم للسفارة.")}>
                    {busy === `sub:${d.id}` ? <Loader2 className="size-4 animate-spin" /> : null} {d.submittedAt ? "إلغاء «قُدِّم للسفارة»" : "قُدِّم للسفارة"}
                  </button>
                ) : null}
                <button type="button" className={btn} disabled={busy !== null} aria-pressed={d.required}
                  onClick={() => void act(`req:${d.id}`, () => setVisaDocument(fileId, { docId: d.id, kind: d.kind, required: !d.required }), d.required ? "صار المستند اختيارياً." : "صار المستند مطلوباً.")}>
                  {d.required ? "مطلوب" : "اختياري"}
                </button>
                {removing === d.id ? (
                  <>
                    <button type="button" className={btnDanger} disabled={busy !== null} onClick={() => { setRemoving(null); void act(`rm:${d.id}`, () => removeVisaDocument(fileId, d.id), "حُذف المستند."); }}>نعم، احذف</button>
                    <button type="button" className={btn} onClick={() => setRemoving(null)}>تراجع</button>
                  </>
                ) : (
                  <button type="button" className={btnDanger} disabled={busy !== null} aria-label={`حذف ${title}`} onClick={() => setRemoving(d.id)}><Trash2 className="size-4" /> حذف</button>
                )}
              </div>
              {read?.docId === d.id ? (
                <div className="space-y-2 rounded-[10px] border border-[#cfe0d9] bg-[#f7faf8] p-3" role="group" aria-label="نتيجة قراءة الجواز">
                  <p className="text-sm font-extrabold text-[#185045]">ما قرأه النظام من الجواز — راجعه قبل الاعتماد</p>
                  <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                    {([["الاسم", read.traveler.fullName], ["رقم الجواز", read.traveler.passportNo], ["الجنسية", read.traveler.nationality], ["تاريخ الميلاد", read.traveler.birthDate], ["انتهاء الجواز", read.traveler.passportExpiry]] as const).map(([k, v]) => (
                      <div key={k} className="flex gap-2"><dt className="text-[#8aa29b]">{k}:</dt><dd className="font-bold text-[#003c3a]">{v ? <DirText dir="auto">{v}</DirText> : "لم يُقرأ"}</dd></div>
                    ))}
                  </dl>
                  <label className={label}>
                    تُضاف إلى
                    <select className={field} value={read.target} onChange={(e) => setRead({ ...read, target: e.target.value })}>
                      {travelers.map((t, i) => <option key={t.id} value={t.id}>{t.fullName.trim() || `المسافر ${i + 1}`}</option>)}
                      <option value="new">مسافر جديد</option>
                    </select>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className={btn} onClick={() => { onApplyRead(read.target, read.traveler); setRead(null); setMessage({ tone: "ok", text: "وُضعت البيانات في «المسافرون» أعلاه. راجعها واضغط «حفظ المسافرين»." }); }}>اعتمد وضعها عند المسافر</button>
                    <button type="button" className={btn} onClick={() => setRead(null)}>تجاهل</button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="space-y-2 rounded-[12px] bg-[#f7faf8] p-3">
        <p className="text-[12px] font-bold text-[#185045]">أضف مستنداً مطلوباً</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className={label}>النوع
            <select className={field} value={add.kind} onChange={(e) => setAdd({ ...add, kind: e.target.value as VisaDocKind })}>
              {VISA_DOC_KINDS.map((k) => <option key={k} value={k}>{VISA_DOC_LABEL[k]}</option>)}
            </select>
          </label>
          <label className={label}>الوصف (اختياري)<input className={field} value={add.label} onChange={(e) => setAdd({ ...add, label: e.target.value })} /></label>
          <label className={label}>لمسافر
            <select className={field} value={add.travelerId} onChange={(e) => setAdd({ ...add, travelerId: e.target.value })}>
              <option value="">للملف كله</option>
              {travelers.map((t, i) => <option key={t.id} value={t.id}>{t.fullName.trim() || `المسافر ${i + 1}`}</option>)}
            </select>
          </label>
        </div>
        <button type="button" className={btn} disabled={busy !== null} onClick={addExpected}>{busy === "add" ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} أضف إلى القائمة</button>
      </div>

      {conversationId !== null ? (
        <div className="space-y-2 rounded-[12px] bg-[#f7faf8] p-3">
          <p className="flex items-center gap-2 text-[12px] font-bold text-[#185045]"><MessageCircle className="size-4" /> استيراد من محادثة تليتيل</p>
          {tele.phase === "idle" ? <button type="button" className={btn} onClick={() => void loadTeletel()}>اعرض مرفقات المحادثة</button> : null}
          {tele.phase === "loading" ? <Notice tone="busy">جارٍ قراءة المحادثة…</Notice> : null}
          {tele.phase === "error" ? (<><Notice tone="error">{tele.error}</Notice><button type="button" className={btn} onClick={() => void loadTeletel()}>إعادة المحاولة</button></>) : null}
          {tele.phase === "ready" && tele.attachments.length === 0 ? <p className="text-sm font-semibold text-[#8aa29b]">لا مرفقات في المحادثة.</p> : null}
          {tele.phase === "ready" && tele.attachments.length > 0 ? (
            <ul className="space-y-2">
              {tele.attachments.map((a) => {
                const key = attachmentKey(a);
                const target = targets[key] ?? options[0]?.value ?? "";
                return (
                  <li key={key} className="flex flex-wrap items-center gap-2 rounded-[10px] bg-white p-2">
                    <span className="min-w-0 flex-1 basis-40 text-sm font-bold text-[#185045]"><DirText>{a.fileName}</DirText><span className="block text-xs font-semibold text-[#8aa29b]">{a.fromClient ? "من العميل" : "منا"} · {fmtDate(a.at)}</span></span>
                    <select className={`${field} w-56 max-w-full`} aria-label={`وجهة ${a.fileName}`} value={target} onChange={(e) => setTargets({ ...targets, [key]: e.target.value })}>
                      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <button type="button" className={btn} disabled={busy !== null} onClick={() => void importOne(a, target)}>
                      {busy === `import:${key}` ? <Loader2 className="size-4 animate-spin" /> : null} استورد
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
