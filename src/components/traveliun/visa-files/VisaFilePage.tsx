"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { riyadhDate } from "@/lib/operations/payments";
import { useRole } from "@/lib/roles/RoleContext";
import { VISA_STATUS_LABEL, dueAmount, type VisaActionResult, type VisaEvent, type VisaFile, type VisaPayment, type VisaStatus } from "@/lib/visa-files/types";
import {
  CONFIRM_STATUS,
  money as moneyText,
  badPrice,
  datesOf,
  datesPatch,
  detailsOf,
  detailsPatch,
  draftToServices,
  followOf,
  followPatch,
  friendlyError,
  isVisaManager,
  mergeRead,
  moneyOf,
  moneyPatch,
  paymentInput,
  servicesToDraft,
  settle,
  travelersPatch,
  type Checked,
  type PaymentDraft,
} from "@/lib/visa-files/ui";
import { addVisaNote, addVisaPayment, assignVisaFile, getVisaFile, setVisaServices, setVisaStatus, updateVisaFile, type VisaFilePatch } from "@/lib/data/visa-files";
import { DatesSection, DetailsSection, FollowupSection, MoneySection, ServicesSection } from "./VisaFileSections";
import { StatusBar, VisaFileHeader } from "./VisaFileHeader";
import { VisaDocuments } from "./VisaDocuments";
import { VisaTravelers } from "./VisaTravelers";
import { Notice, btn, card, type Message, type Person, useUnsavedGuard } from "./visa-ui";
import { useDraft } from "./useDraft";

export type FileData = { file: VisaFile; payments: VisaPayment[]; events: VisaEvent[] };

const JUMPS = [["travelers", "المسافرون"], ["documents", "المستندات"], ["services", "الخدمات"], ["money", "الرسوم"], ["followup", "المتابعة"]] as const;

/** /visa-files/[id]: holds the file as the server gave it, reloads it after every change, and says plainly when it cannot. */
export function VisaFilePage({ id, initial, people, teletelUrl }: { id: string; initial: VisaActionResult<FileData>; people: Person[]; teletelUrl: string | null }) {
  const [data, setData] = useState<FileData | null>(initial.ok ? { file: initial.file, payments: initial.payments, events: initial.events } : null);
  const [error, setError] = useState(initial.ok ? "" : friendlyError(initial.error));
  const [refreshing, setRefreshing] = useState(false);
  /** true when the file was read again */
  const reload = useCallback(async () => {
    setRefreshing(true);
    const r = await settle(() => getVisaFile(id));
    setRefreshing(false);
    if (r.ok) {
      setData({ file: r.file, payments: r.payments, events: r.events });
      setError("");
    } else setError(r.error);
    return r.ok;
  }, [id]);

  if (!data) {
    return (
      <div dir="rtl" className={`${card} mx-auto max-w-3xl space-y-3`}>
        <h1 className="text-xl font-extrabold text-[#003c3a]">تعذّر فتح ملف التأشيرة</h1>
        <Notice tone="error">{error || "لم نستطع قراءة الملف."}</Notice>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} disabled={refreshing} onClick={() => void reload()}>إعادة المحاولة</button>
          <Link href="/visa-files" className={btn}>العودة إلى اللوحة</Link>
        </div>
      </div>
    );
  }
  return <VisaFileBody data={data} people={people} teletelUrl={teletelUrl} reload={reload} refreshing={refreshing} staleError={error} />;
}

function VisaFileBody({ data, people, teletelUrl, reload, refreshing, staleError }: { data: FileData; people: Person[]; teletelUrl: string | null; reload: () => Promise<boolean>; refreshing: boolean; staleError: string }) {
  const { file, payments, events } = data;
  const id = file.id;
  const { can } = useRole();
  const manager = isVisaManager(can);
  const [now] = useState(() => Date.now());

  // each section's draft beside the server's copy, and the line it last said
  const details = useDraft(detailsOf(file));
  const dates = useDraft(datesOf(file));
  const follow = useDraft(followOf(file));
  const money = useDraft(moneyOf(file));
  const services = useDraft(servicesToDraft(file.services));
  const travelers = useDraft(file.travelers);
  const assignee = useDraft(file.assignedTo ?? "");
  const [pay, setPay] = useState<PaymentDraft>({ amount: "", method: "", note: "", paidAt: riyadhDate() });
  const [note, setNote] = useState("");
  const [noteKind, setNoteKind] = useState<"note" | "contact">("note");
  const [confirming, setConfirming] = useState<VisaStatus | null>(null);
  const [stepNote, setStepNote] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [said, setSaid] = useState<Record<string, Message>>({});
  const lock = useRef(new Set<string>());
  const say = (key: string, message: Message) => setSaid((s) => ({ ...s, [key]: message }));

  const dirty = details.dirty || dates.dirty || follow.dirty || money.dirty || services.dirty || travelers.dirty || assignee.dirty || pay.amount.trim() !== "" || pay.note.trim() !== "" || note.trim() !== "";
  useUnsavedGuard(dirty);

  /** one save per section at a time: a second press while it runs does nothing, and the words say what happened */
  async function run(key: string, work: () => Promise<VisaActionResult>, ok: string, saved?: { adopt: () => void }): Promise<boolean> {
    if (lock.current.has(key)) return false;
    lock.current.add(key);
    setBusy((b) => ({ ...b, [key]: true }));
    say(key, { tone: "busy", text: "جارٍ الحفظ…" });
    const r = await settle(work);
    lock.current.delete(key);
    setBusy((b) => ({ ...b, [key]: false }));
    if (!r.ok) {
      say(key, { tone: "error", text: `لم يُحفظ شيء. ${r.error}` });
      return false;
    }
    say(key, { tone: "ok", text: ok });
    // the section takes the server's word for what it now holds — unless the file could not be read back
    if ((await reload()) && saved) saved.adopt();
    return true;
  }
  const patch = (key: string, checked: Checked<VisaFilePatch>, ok: string, saved: { adopt: () => void }) =>
    checked.ok ? run(key, () => updateVisaFile(id, checked.value), ok, saved) : Promise.resolve(say(key, { tone: "error", text: checked.error }));

  const step = (to: VisaStatus) => {
    // handing over a visa whose fees are not all paid is never blocked, but asks first, in red (the owner, 2026-10-26)
    if (CONFIRM_STATUS.includes(to) || (to === "delivered" && dueAmount(file) > 0)) setConfirming(to);
    else void doStep(to);
  };
  async function doStep(to: VisaStatus) {
    if (await run("status", () => setVisaStatus(id, to, stepNote.trim() || undefined), `انتقل الملف إلى «${VISA_STATUS_LABEL[to]}».`)) {
      setConfirming(null);
      setStepNote("");
    }
  }

  return (
    <div dir="rtl" className="mx-auto max-w-5xl space-y-4">
      {staleError ? <Notice tone="error">{`تعذّر تحديث الملف، وما تراه آخر نسخة ناجحة. ${staleError}`}</Notice> : null}
      <VisaFileHeader
        file={file}
        teletelUrl={teletelUrl}
        manager={manager}
        people={people}
        assignee={assignee.value}
        assigning={Boolean(busy.assign)}
        assignMessage={said.assign ?? null}
        onAssignee={assignee.set}
        onAssign={() => void run("assign", () => assignVisaFile(id, assignee.value || null), "نُقل الملف.", assignee)}
        onRefresh={() => void reload()}
        refreshing={refreshing}
      />
      <StatusBar
        status={file.status}
        confirming={confirming}
        owing={confirming === "delivered" && dueAmount(file) > 0 ? moneyText(dueAmount(file), file.currency) : null}
        note={stepNote}
        busy={Boolean(busy.status)}
        message={said.status ?? null}
        onPick={step}
        onConfirm={() => {
          if (confirming) void doStep(confirming);
        }}
        onCancel={() => { setConfirming(null); setStepNote(""); }}
        onNote={setStepNote}
      />
      <nav aria-label="أقسام الملف" className="flex gap-2 overflow-x-auto pb-1">
        {JUMPS.map(([anchor, text]) => <a key={anchor} href={`#${anchor}`} className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-[#dbe6e1] bg-white px-4 text-sm font-bold text-[#185045] hover:bg-[#f4f8f6]">{text}</a>)}
      </nav>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <DetailsSection
          draft={details.value}
          set={(p) => details.set((d) => ({ ...d, ...p }))}
          dirty={details.dirty}
          busy={Boolean(busy.details)}
          message={said.details ?? null}
          onSave={() => void patch("details", detailsPatch(details.value), "حُفظت بيانات الطلب.", details)}
        />
        <DatesSection
          draft={dates.value}
          set={(p) => dates.set((d) => ({ ...d, ...p }))}
          now={now}
          dirty={dates.dirty}
          busy={Boolean(busy.dates)}
          message={said.dates ?? null}
          onSave={() => void patch("dates", datesPatch(dates.value), "حُفظت المواعيد.", dates)}
        />
      </div>

      <VisaTravelers
        value={travelers.value}
        onChange={travelers.set}
        applicants={file.applicants}
        dirty={travelers.dirty}
        busy={Boolean(busy.travelers)}
        message={said.travelers ?? null}
        onSave={() => void patch("travelers", travelersPatch(travelers.value), "حُفظ المسافرون.", travelers)}
      />

      <VisaDocuments
        fileId={id}
        documents={file.documents}
        travelers={travelers.value}
        conversationId={file.conversationId}
        onChanged={async () => {
          await reload();
        }}
        onApplyRead={(target, read) => travelers.set((list) => mergeRead(list, target, read, crypto.randomUUID()))}
      />

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <ServicesSection
          value={services.value}
          onChange={services.set}
          dirty={services.dirty}
          busy={Boolean(busy.services)}
          message={said.services ?? null}
          onSave={() => {
            if (badPrice(services.value)) say("services", { tone: "error", text: "سعر الخدمة رقم لا يقل عن صفر." });
            else void run("services", () => setVisaServices(id, draftToServices(services.value)), "حُفظت الخدمات.", services);
          }}
        />
        <MoneySection
          file={file}
          draft={money.value}
          set={(p) => money.set((d) => ({ ...d, ...p }))}
          payments={payments}
          people={people}
          pay={pay}
          onPay={(p) => setPay((d) => ({ ...d, ...p }))}
          payBusy={Boolean(busy.pay)}
          payMessage={said.pay ?? null}
          dirty={money.dirty}
          busy={Boolean(busy.money)}
          message={said.money ?? null}
          onSave={() => void patch("money", moneyPatch(money.value), "حُفظت الرسوم.", money)}
          onAddPayment={() => {
            const checked = paymentInput(pay);
            if (!checked.ok) return say("pay", { tone: "error", text: checked.error });
            void run("pay", () => addVisaPayment(id, checked.value), "سُجلت الدفعة.").then((ok) => ok && setPay((d) => ({ ...d, amount: "", note: "" })));
          }}
        />
      </div>

      <FollowupSection
        draft={follow.value}
        set={(p) => follow.set((d) => ({ ...d, ...p }))}
        dirty={follow.dirty}
        busy={Boolean(busy.follow)}
        message={said.follow ?? null}
        onSave={() => void patch("follow", followPatch(follow.value), "حُفظ الإجراء التالي.", follow)}
        events={events}
        people={people}
        now={now}
        note={note}
        onNote={setNote}
        noteKind={noteKind}
        onNoteKind={setNoteKind}
        noteBusy={Boolean(busy.note)}
        noteMessage={said.note ?? null}
        onAddNote={() => void run("note", () => addVisaNote(id, note.trim(), noteKind), noteKind === "contact" ? "سُجّل الاتصال." : "أُضيفت الملاحظة.").then((ok) => ok && setNote(""))}
      />
    </div>
  );
}
