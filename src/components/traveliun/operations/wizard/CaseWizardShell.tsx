"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ComponentType } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Circle, CircleAlert, Clock, FileUp, LayoutList, Loader2, Minus, PlaneTakeoff } from "lucide-react";
import { DirText } from "@/components/DirText";
import type { TranslationKey } from "@/lib/i18n";
import { setExecutionStatus } from "@/lib/data/operations";
import { paidTotal } from "@/lib/operations/payments";
import { firstOpenStep, itemTone, readiness, readyLabel, readyToTravel, stepStates, stepTone, type StepTone } from "@/lib/operations/wizard/index";
import { calmDone, calmRows, calmUrgency, nextNow } from "@/lib/operations/wizard/calm";
import { clientStatusUnbacked, paidState } from "@/lib/operations/wizard/payment";
import { WIZARD_STEPS, type StepProps, type WizardCase, type WizardStep } from "@/lib/operations/wizard/types";
import { TraveliunShell } from "../../TraveliunShell";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { useSafeTransition } from "../../useSafeTransition";
import { CasePresence } from "../CasePresence";
import { PassportsStep } from "./PassportsStep";
import { FlightsStep } from "./FlightsStep";
import { HotelsStep } from "./HotelsStep";
import { TransportStep } from "./TransportStep";
import { PaymentStep, UnbackedStatus } from "./PaymentStep";
import { AutoIssue, DocumentsStep } from "./DocumentsStep";
import { WaitButton } from "./WaitButton";
import { UploadAll } from "./UploadAll";
import { SendAllRequests } from "./SendAllRequests";

/**
 * «معالج الحجوزات» — the case page by default (the owner, 2026-10-17): six
 * steps, one on screen, any order, each saving on its own; the progress bar
 * says where each stands; opening the case lands on the first one with work
 * left. «عرض الكل» (?view=all) is the old one-page case, unchanged.
 */

const SCREENS: Record<WizardStep, ComponentType<StepProps>> = {
  passports: PassportsStep,
  flights: FlightsStep,
  hotels: HotelsStep,
  transport: TransportStep,
  payment: PaymentStep,
  documents: DocumentsStep,
};

/** A tile's colour is its readiness (index.ts stepTone): red blocks «جاهز للسفر», yellow warns, green is done. */
const TONE: Record<StepTone, string> = {
  red: "border-[#f4c9d4] bg-[#fdeef2] text-[#c22850]",
  yellow: "border-[#f0d9a8] bg-[#fff8e8] text-[#a86a10]",
  green: "border-[#bfe5d4] bg-[#e9f7f0] text-[#0f7a52]",
  grey: "border-[#eef2f0] bg-[#f6f8f7] text-[#93aaa3]",
};

/** An item's own colour under its tile (index.ts itemTone) — a done one is green even under a red tile. */
const ITEM_TONE: Record<ReturnType<typeof itemTone>, string> = { red: "text-[#c22850]", yellow: "text-[#a86a10]", green: "text-[#0f7a52]" };

export function CaseWizardShell({
  data,
  canManage,
  canReadMrz,
  openUpload = false,
  canSeeCost = false,
}: {
  data: WizardCase;
  canManage: boolean;
  canReadMrz: boolean;
  /** ?upload=1 — opened from the operations list's «ارفع ملفات عميل» */
  openUpload?: boolean;
  /** pricing.internal — the uploader reads suppliers' invoices (cost) only then */
  canSeeCost?: boolean;
}) {
  const { t } = useTraveliunUI();
  const [uploading, setUploading] = useState(openUpload);
  const op = data.operation;
  const states = stepStates(data);
  const [step, setStep] = useState<WizardStep>(() => firstOpenStep(data));
  const Screen = SCREENS[step];
  const index = WIZARD_STEPS.indexOf(step);
  const finished = WIZARD_STEPS.filter((s) => states[s] === "done" || states[s] === "na").length;
  const paid = paidTotal(data.payments);
  const money = paidState(op.total, paid);

  return (
    <TraveliunShell title="nav.operations">
      <div className="tv-fade-up mx-auto max-w-4xl space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Link
            href="/operations"
            className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[12.5px] font-bold text-[#557d78] hover:bg-[#f4f8f6]"
          >
            <ArrowRight className="size-4 ltr:rotate-180" />
            {t("ops.backToBoard")}
          </Link>
          <Link
            href={`/operations/${op.id}?view=all`}
            className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[12.5px] font-bold text-[#185045] hover:bg-[#f4f8f6]"
          >
            <LayoutList className="size-4" />
            {t("wz.viewAll")}
          </Link>
        </div>

        <section className="rounded-2xl border border-[#e2ebe7] bg-white p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h1 className="truncate text-[16px] font-extrabold text-[#003c3a]">{op.customer_name || "—"}</h1>
              <p className="tv-tnum mt-0.5 text-[12px] font-bold text-[#93aaa3]">
                <DirText>{op.serial}</DirText>
                {op.destination ? <span className="ms-2 font-semibold">{op.destination}</span> : null}
              </p>
            </div>
            <div className="text-end">
              <p className="tv-tnum text-[12.5px] font-extrabold text-[#0f3d38]">
                <DirText>{`${op.travel_start ?? "—"} → ${op.travel_end ?? "—"}`}</DirText>
              </p>
              <p className="mt-0.5 text-[11.5px] font-bold text-[#557d78]">{t(`wz.pay.state.${money}` as TranslationKey)}</p>
            </div>
          </div>
          {clientStatusUnbacked(op.client_status, op.total, paid) ? (
            <div className="mt-2">
              <UnbackedStatus status={op.client_status} />
            </div>
          ) : null}

          {/* «ارفع كل الملفات» (the owner, 2026-10-22) and «أرسل كل الطلبات» (2026-10-26), above the steps */}
          <div className="mt-3 flex flex-wrap items-start gap-2">
            <button
              type="button"
              onClick={() => setUploading((v) => !v)}
              aria-expanded={uploading}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-[10px] bg-[#185045] px-4 text-[13px] font-extrabold text-white hover:bg-[#0f4439]"
            >
              <FileUp className="size-4" />
              {t("wz.up.button")}
            </button>
            <SendAllRequests operationId={op.id} />
          </div>

          {/* the six steps: each tile coloured by its readiness, its items under it, and the switch to it */}
          <div className="mt-3 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#eef2f0]">
              <div className="h-full rounded-full bg-[#2aa87a] transition-[width]" style={{ width: `${(finished / WIZARD_STEPS.length) * 100}%` }} />
            </div>
            <span className="tv-tnum text-[11.5px] font-bold text-[#557d78]">
              <DirText>{`${finished}/${WIZARD_STEPS.length}`}</DirText>
            </span>
          </div>
          <div className="mt-3">
            <CalmGate data={data} step={step} onOpenStep={setStep} />
          </div>
        </section>

        {uploading ? <UploadAll data={data} canReadMrz={canReadMrz} canSeeCost={canSeeCost} onClose={() => setUploading(false)} /> : null}

        <CasePresence operationId={op.id} />
        <AutoIssue data={data} />

        <section className="rounded-2xl border border-[#e2ebe7] bg-white p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <h2 className="text-[15px] font-extrabold text-[#003c3a]">
              <span className="tv-tnum me-1.5 text-[#93aaa3]">{index + 1}.</span>
              {t(`wz.step.${step}` as TranslationKey)}
            </h2>
            {states[step] === "done" || states[step] === "na" ? null : (
              <WaitButton key={step} operationId={op.id} step={step} wait={data.waits[step]} today={data.today} />
            )}
          </div>
          <Screen data={data} canManage={canManage} canReadMrz={canReadMrz} />
          <div className="mt-4 flex items-center justify-between gap-2 border-t border-[#f0f4f2] pt-3">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => setStep(WIZARD_STEPS[index - 1])}
              className="inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-[#dbe6e1] px-3 text-[12.5px] font-bold text-[#557d78] disabled:opacity-40"
            >
              <ArrowRight className="size-4 ltr:rotate-180" />
              {t("wz.prev")}
            </button>
            <button
              type="button"
              disabled={index === WIZARD_STEPS.length - 1}
              onClick={() => setStep(WIZARD_STEPS[index + 1])}
              className="inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-[#185045] px-4 text-[12.5px] font-bold text-white disabled:opacity-40"
            >
              {t("wz.next")}
              <ArrowLeft className="size-4 ltr:rotate-180" />
            </button>
          </div>
        </section>

      </div>
    </TraveliunShell>
  );
}

/**
 * The calm gate (the owner, 2026-10-26: «يدخل على ملف يساعده وليس يصعب عليه»):
 * ONE big card with the next thing to do and its button, a quiet ordered list
 * of what follows, the finished steps folded to a ✓ line, and the «جاهز
 * للسفر» button. One palette — the brand green and grey; red only when the
 * travel date is on top of us with something mandatory missing, amber only
 * for a real warning. The old six-tile grid (ReadyGate below) stays on
 * «عرض الكل», so nothing is lost.
 */
function CalmGate({ data, step, onOpenStep }: { data: WizardCase; step: WizardStep; onOpenStep: (step: WizardStep) => void }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [pending, run] = useSafeTransition();
  const [error, setError] = useState<string | null>(null);
  const op = data.operation;
  const next = nextNow(data);
  const rows = calmRows(data, next?.step);
  const done = calmDone(data);
  const items = readiness(data);
  const ready = readyToTravel(items);
  const urgency = calmUrgency(op.travel_start, data.today);
  const urgent = urgency !== "normal" && next?.item && !next.item.optional;
  const exec = op.execution_status;

  return (
    <div className="space-y-2.5">
      {next ? (
        <div
          className={`rounded-[14px] border p-4 ${
            urgent ? "border-[#f4c9d4] bg-[#fdf4f6]" : "border-[#cfe0d9] bg-[#f4faf7]"
          }`}
        >
          <p className={`text-[11px] font-bold ${urgent ? "text-[#c22850]" : "text-[#6d8a84]"}`}>
            {t("wz.calm.next")}
            {urgent ? <span className="ms-1.5">{t(urgency === "late" ? "wz.calm.late" : "wz.calm.soon")}</span> : null}
          </p>
          <p className="mt-1 text-[16px] font-extrabold leading-snug text-[#0f3d38]">
            {next.item ? t(readyLabel(next.item)) : t(`wz.step.${next.step}` as TranslationKey)}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {next.step === step ? (
              <span className="text-[12px] font-bold text-[#6d8a84]">{t("wz.calm.below")}</span>
            ) : (
              <button
                type="button"
                onClick={() => onOpenStep(next.step)}
                className={`inline-flex h-10 items-center gap-1.5 rounded-[10px] px-4 text-[13px] font-extrabold text-white ${
                  urgent ? "bg-[#c22850] hover:bg-[#a81f42]" : "bg-[#185045] hover:bg-[#0f4439]"
                }`}
              >
                {t("wz.calm.open", { step: t(`wz.step.${next.step}` as TranslationKey) })}
                <ArrowLeft className="size-4 ltr:rotate-180" />
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-[14px] border border-[#bfe5d4] bg-[#e9f7f0] p-4">
          <p className="text-[14px] font-extrabold text-[#0f7a52]">{t("wz.calm.allDone")}</p>
        </div>
      )}

      {rows.length > 0 ? (
        <ol className="overflow-hidden rounded-[12px] border border-[#eef2f0]">
          {rows.map((r) => (
            <li key={r.step} className="border-b border-[#f4f7f5] last:border-b-0">
              <button
                type="button"
                onClick={() => onOpenStep(r.step)}
                aria-current={r.step === step ? "step" : undefined}
                className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-start hover:bg-[#f8fbf9] ${r.step === step ? "bg-[#f4faf7]" : "bg-white"}`}
              >
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#eef2f0] text-[11px] font-extrabold text-[#557d78]">
                  {r.state === "waiting" ? <Clock className="size-3.5" /> : WIZARD_STEPS.indexOf(r.step) + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-extrabold text-[#0f3d38]">{t(`wz.step.${r.step}` as TranslationKey)}</span>
                  {r.first ? (
                    <span className={`block truncate text-[11.5px] font-semibold ${r.warning ? "text-[#a86a10]" : "text-[#93aaa3]"}`}>
                      {t(readyLabel(r.first))}
                      {r.more > 0 ? <span className="tv-tnum ms-1">+{r.more}</span> : null}
                    </span>
                  ) : null}
                </span>
                {r.state === "waiting" ? <span className="shrink-0 text-[11px] font-bold text-[#93aaa3]">{t("wz.state.waiting")}</span> : null}
              </button>
            </li>
          ))}
        </ol>
      ) : null}

      {done.length > 0 ? (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[12px] font-bold text-[#557d78]">
          {done.map((d) => (
            <button key={d.step} type="button" onClick={() => onOpenStep(d.step)} className="inline-flex items-center gap-1 hover:underline">
              <Check className={`size-3.5 ${d.na ? "text-[#b9c8c3]" : "text-[#0f7a52]"}`} />
              {t(`wz.step.${d.step}` as TranslationKey)}
            </button>
          ))}
        </p>
      ) : null}

      {exec === "cancelled" || exec === "travelled" ? null : (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#f0f4f2] pt-2.5">
          <p className="text-[12.5px] font-extrabold text-[#003c3a]">{t("ops.ready.title")}</p>
          {exec === "ready_to_travel" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e9f7f0] px-3 py-1 text-[12px] font-bold text-[#0f7a52]">
              <PlaneTakeoff className="size-4" />
              {t("ops.exec.ready_to_travel")}
            </span>
          ) : (
            <button
              type="button"
              disabled={!ready || pending}
              onClick={() =>
                run(async () => {
                  setError(null);
                  const res = await setExecutionStatus(op.id, "ready_to_travel");
                  if (res.ok) router.refresh();
                  else setError(t(res.error));
                })
              }
              className="inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-[#0f7a52] px-4 text-[12.5px] font-bold text-white disabled:bg-[#b7d0c7]"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <PlaneTakeoff className="size-4" />}
              {t("ops.ready.mark")}
            </button>
          )}
        </div>
      )}
      {error ? <p className="text-[12px] font-bold text-[#c22850]">{error}</p> : null}
    </div>
  );
}

/**
 * The six steps as tiles, each coloured by its own readiness items and listing
 * them under it (the owner, 2026-10-18: «أريدها واضحة على المربعات… يُكتب
 * أسفلها ويتحول المربع بنفس لون الخطأ») — no separate checklist. «جاهز للسفر»
 * opens only with no red tile: a red tile is exactly a mandatory item missing,
 * the rule the server asks again (setExecutionStatus → wizardReady).
 * `onOpenStep`: the wizard switches step on a tile; «عرض الكل» shows them still.
 */
export function ReadyGate({ data, step, onOpenStep }: { data: WizardCase; step?: WizardStep; onOpenStep?: (step: WizardStep) => void }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [pending, run] = useSafeTransition();
  const [error, setError] = useState<string | null>(null);
  const exec = data.operation.execution_status;
  const states = stepStates(data);
  const items = readiness(data);
  const ready = readyToTravel(items);

  return (
    <div>
      <ol className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {WIZARD_STEPS.map((s, n) => {
          const own = items.filter((i) => i.step === s);
          const tone = stepTone(states[s], own);
          return (
            <li key={s}>
              <button
                type="button"
                disabled={!onOpenStep}
                onClick={() => onOpenStep?.(s)}
                aria-current={s === step ? "step" : undefined}
                className={`flex h-full w-full flex-col gap-1.5 rounded-[12px] border p-2.5 text-start transition-shadow disabled:cursor-default ${TONE[tone]} ${
                  s === step ? "ring-2 ring-[#185045]/40" : ""
                }`}
              >
                <span className="flex w-full items-center gap-1.5 text-[12px] font-extrabold">
                  <span className="flex size-5 shrink-0 items-center justify-center">
                    {states[s] === "waiting" ? (
                      <Clock className="size-4" />
                    ) : tone === "green" ? (
                      <Check className="size-4" />
                    ) : tone === "grey" ? (
                      <Minus className="size-4" />
                    ) : (
                      <span className="tv-tnum">{n + 1}</span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1 leading-tight">{t(`wz.step.${s}` as TranslationKey)}</span>
                  {/* «مطلوب» only for a mandatory item missing; a wait says «ينتظر» */}
                  <span className="shrink-0 text-[10.5px] font-bold opacity-80">
                    {t(states[s] === "waiting" ? "wz.state.waiting" : (`wz.tone.${tone}` as TranslationKey))}
                  </span>
                </span>
                {own.length > 0 ? (
                  <ul className="grid gap-0.5 text-[11px] font-semibold leading-snug">
                    {own.map((i) => (
                      <li key={i.key} className={`flex items-start gap-1 ${ITEM_TONE[itemTone(i)]}`}>
                        {i.ok ? (
                          <CheckCircle2 className="mt-px size-3 shrink-0" />
                        ) : i.optional && !i.warning ? (
                          <Circle className="mt-px size-3 shrink-0" />
                        ) : (
                          <CircleAlert className="mt-px size-3 shrink-0" />
                        )}
                        <span className="min-w-0">
                          {t(readyLabel(i))}
                          {i.optional && !i.ok && !i.warning ? <span className="ms-1 opacity-80">{t("wz.ready.optional")}</span> : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>

      {exec === "cancelled" || exec === "travelled" ? null : (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12.5px] font-extrabold text-[#003c3a]">
            {t("ops.ready.title")}
            {exec !== "ready_to_travel" && !ready ? <span className="ms-1.5 text-[11px] font-bold text-[#c22850]">{t("wz.readyBlocked")}</span> : null}
          </p>
          {exec === "ready_to_travel" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e9f7f0] px-3 py-1 text-[12px] font-bold text-[#0f7a52]">
              <PlaneTakeoff className="size-4" />
              {t("ops.exec.ready_to_travel")}
            </span>
          ) : (
            <button
              type="button"
              disabled={!ready || pending}
              onClick={() =>
                run(async () => {
                  setError(null);
                  const res = await setExecutionStatus(data.operation.id, "ready_to_travel");
                  if (res.ok) router.refresh();
                  else setError(t(res.error));
                })
              }
              className="inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-[#0f7a52] px-4 text-[12.5px] font-bold text-white disabled:bg-[#b7d0c7]"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <PlaneTakeoff className="size-4" />}
              {t("ops.ready.mark")}
            </button>
          )}
        </div>
      )}
      {error ? <p className="mt-2 text-[12px] font-bold text-[#c22850]">{error}</p> : null}
    </div>
  );
}
