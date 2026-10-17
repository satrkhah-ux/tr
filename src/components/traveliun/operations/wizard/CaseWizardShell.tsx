"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ComponentType } from "react";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Circle, Clock, LayoutList, Loader2, Minus, PlaneTakeoff } from "lucide-react";
import { DirText } from "@/components/DirText";
import { en, type TranslationKey } from "@/lib/i18n";
import { setExecutionStatus } from "@/lib/data/operations";
import { setStepWait } from "@/lib/data/operation-wizard";
import { paidTotal } from "@/lib/operations/payments";
import { firstOpenStep, ownState, readiness, readyToTravel, stepStates } from "@/lib/operations/wizard/index";
import { clientStatusUnbacked, paidState } from "@/lib/operations/wizard/payment";
import { WIZARD_STEPS, type ReadinessItem, type StepProps, type StepState, type WizardCase, type WizardStep } from "@/lib/operations/wizard/types";
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

const TONE: Record<StepState, string> = {
  done: "border-[#bfe5d4] bg-[#e9f7f0] text-[#0f7a52]",
  todo: "border-[#dbe6e1] bg-white text-[#185045]",
  waiting: "border-[#f0d9a8] bg-[#fff8e8] text-[#a86a10]",
  na: "border-[#eef2f0] bg-[#f6f8f7] text-[#93aaa3]",
};

export function CaseWizardShell({ data, canManage, canReadMrz }: { data: WizardCase; canManage: boolean; canReadMrz: boolean }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const op = data.operation;
  const states = stepStates(data);
  const [step, setStep] = useState<WizardStep>(() => firstOpenStep(data));
  const Screen = SCREENS[step];
  const index = WIZARD_STEPS.indexOf(step);
  const finished = WIZARD_STEPS.filter((s) => states[s] === "done" || states[s] === "na").length;
  const paid = paidTotal(data.payments);
  const money = paidState(op.total, paid);

  // a step that is done no longer waits on anyone — its «ينتظر» goes, once per load
  const cleared = useRef(new Set<WizardStep>());
  const stale = WIZARD_STEPS.filter((s) => data.waits[s] && ["done", "na"].includes(ownState(data, s)) && !cleared.current.has(s));
  useEffect(() => {
    if (stale.length === 0) return;
    stale.forEach((s) => cleared.current.add(s));
    void Promise.all(stale.map((s) => setStepWait(op.id, s, null).catch(() => null))).then(() => router.refresh());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale.join("|")]);

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

          {/* the six steps — each one's state, and the switch to it */}
          <div className="mt-3 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#eef2f0]">
              <div className="h-full rounded-full bg-[#2aa87a] transition-[width]" style={{ width: `${(finished / WIZARD_STEPS.length) * 100}%` }} />
            </div>
            <span className="tv-tnum text-[11.5px] font-bold text-[#557d78]">
              <DirText>{`${finished}/${WIZARD_STEPS.length}`}</DirText>
            </span>
          </div>
          <ol className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
            {WIZARD_STEPS.map((s, i) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => setStep(s)}
                  aria-current={s === step ? "step" : undefined}
                  className={`flex w-full flex-col items-center gap-0.5 rounded-[10px] border px-1.5 py-2 text-center text-[11px] font-bold transition-shadow ${TONE[states[s]]} ${
                    s === step ? "ring-2 ring-[#185045]/40" : ""
                  }`}
                >
                  <span className="flex size-5 items-center justify-center">
                    {states[s] === "done" ? (
                      <Check className="size-4" />
                    ) : states[s] === "waiting" ? (
                      <Clock className="size-4" />
                    ) : states[s] === "na" ? (
                      <Minus className="size-4" />
                    ) : (
                      <span className="tv-tnum">{i + 1}</span>
                    )}
                  </span>
                  <span className="leading-tight">{t(`wz.step.${s}` as TranslationKey)}</span>
                  <span className="text-[10px] font-semibold opacity-75">{t(`wz.state.${states[s]}` as TranslationKey)}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>

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

        <ReadyGate data={data} onOpenStep={setStep} />
      </div>
    </TraveliunShell>
  );
}

/** A readiness item's words: the step's own `wz.ready.<step>.<key>` when it wrote one, else the step and the key. */
function useReadyLabel() {
  const { t } = useTraveliunUI();
  return (i: ReadinessItem) => {
    const key = `wz.ready.${i.step}.${i.key}`;
    return key in en ? t(key as TranslationKey) : `${t(`wz.step.${i.step}` as TranslationKey)} — ${i.key}`;
  };
}

/**
 * «جاهز للسفر» — every step's readiness rules in one list: a mandatory one not
 * met in red, an optional one in amber; the button only on a green list (the
 * server asks the same rules again — setExecutionStatus → wizardReady).
 * Used by the wizard and by «عرض الكل».
 */
export function ReadyGate({ data, onOpenStep }: { data: WizardCase; onOpenStep?: (step: WizardStep) => void }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const label = useReadyLabel();
  const [pending, run] = useSafeTransition();
  const [error, setError] = useState<string | null>(null);
  const exec = data.operation.execution_status;
  if (exec === "cancelled" || exec === "travelled") return null;
  const items = readiness(data);
  const ready = readyToTravel(items);

  return (
    <section className="rounded-2xl border border-[#e2ebe7] bg-white p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[14px] font-extrabold text-[#003c3a]">{t("ops.ready.title")}</h2>
        {exec === "ready_to_travel" ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e9f7f0] px-3 py-1 text-[12px] font-bold text-[#0f7a52]">
            <PlaneTakeoff className="size-4" />
            {t("ops.exec.ready_to_travel")}
          </span>
        ) : ready ? (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(async () => {
                setError(null);
                const res = await setExecutionStatus(data.operation.id, "ready_to_travel");
                if (res.ok) router.refresh();
                else setError(t(res.error));
              })
            }
            className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#0f7a52] px-3 text-[12px] font-bold text-white disabled:opacity-60"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <PlaneTakeoff className="size-4" />}
            {t("ops.ready.mark")}
          </button>
        ) : null}
      </div>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {items.map((i) => (
          <li key={`${i.step}:${i.key}`}>
            <button
              type="button"
              disabled={!onOpenStep}
              onClick={() => onOpenStep?.(i.step)}
              className={`flex w-full items-center gap-2 rounded-[10px] px-3 py-2 text-start text-[12.5px] font-bold ${
                i.ok ? "bg-[#e9f7f0] text-[#0f7a52]" : i.optional ? "bg-[#fff8e8] text-[#a86a10]" : "bg-[#fdeef2] text-[#c22850]"
              } ${onOpenStep && !i.ok ? "hover:underline" : ""}`}
            >
              {i.ok ? <CheckCircle2 className="size-4 shrink-0" /> : <Circle className="size-4 shrink-0" />}
              <span className="min-w-0">
                {label(i)}
                {i.optional && !i.ok ? <span className="ms-1.5 text-[10.5px] font-semibold opacity-80">{t("wz.ready.optional")}</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {error ? <p className="mt-2 text-[12px] font-bold text-[#c22850]">{error}</p> : null}
    </section>
  );
}
