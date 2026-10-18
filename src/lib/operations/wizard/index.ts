import { documentsReadiness, documentsState } from "./documents";
export { isUnassigned } from "./assignment";
import { flightsReadiness, flightsState } from "./flights";
import { hotelsReadiness, hotelsState } from "./hotels";
import { passportsReadiness, passportsState } from "./passports";
import { paymentReadiness, paymentState } from "./payment";
import { transportReadiness, transportState } from "./transport";
import type { TranslationKey } from "@/lib/i18n";
import { WIZARD_STEPS, type CaseWaits, type ReadinessCase, type ReadinessItem, type StepState, type WizardCase, type WizardStep } from "./types";

/** Each step's own rules, in one place for the progress bar and the readiness gate. */
const RULES: Record<WizardStep, { state: (d: WizardCase) => StepState; readiness: (d: ReadinessCase) => ReadinessItem[] }> = {
  passports: { state: passportsState, readiness: passportsReadiness },
  flights: { state: flightsState, readiness: flightsReadiness },
  hotels: { state: hotelsState, readiness: hotelsReadiness },
  transport: { state: transportState, readiness: transportReadiness },
  payment: { state: paymentState, readiness: paymentReadiness },
  documents: { state: documentsState, readiness: documentsReadiness },
};

/** A step's own state, before «ينتظر» — what decides whether a wait is still worth keeping. */
export function ownState(data: WizardCase, step: WizardStep): StepState {
  return RULES[step].state(data);
}

/** Every step's own state. */
export function ownStates(data: WizardCase): Record<WizardStep, StepState> {
  return Object.fromEntries(WIZARD_STEPS.map((step) => [step, ownState(data, step)])) as Record<WizardStep, StepState>;
}

/**
 * The steps the bookings and the documents alone decide — what the server can
 * tell after a confirmation made anywhere (a supplier's link, the supplier's
 * API), with no session and without loading the whole case.
 */
export function bookingStepStates(
  data: Pick<WizardCase, "bookings" | "documents" | "hasDays" | "travelers" | "clientToken" | "supplierWork">,
): Partial<Record<WizardStep, StepState>> {
  return { flights: flightsState(data), hotels: hotelsState(data), transport: transportState(data), documents: documentsState(data) };
}

/**
 * The waits that no longer hold: their step is done, or has nothing to do, by
 * its own rule — whichever screen finished it. A step `states` does not cover
 * keeps its wait.
 */
export function staleWaits(waits: CaseWaits, states: Partial<Record<WizardStep, StepState>>): WizardStep[] {
  return WIZARD_STEPS.filter((step) => waits[step] && (states[step] === "done" || states[step] === "na"));
}

/** A waiting step reads «ينتظر» whatever its own rule says — until it is done. */
export function stepStates(data: WizardCase): Record<WizardStep, StepState> {
  const own = ownStates(data);
  return Object.fromEntries(
    WIZARD_STEPS.map((step) => [step, own[step] !== "done" && own[step] !== "na" && data.waits[step] ? "waiting" : own[step]]),
  ) as Record<WizardStep, StepState>;
}

/** The first step with something left — where opening the case lands. */
export function firstOpenStep(data: WizardCase): WizardStep {
  const states = stepStates(data);
  return WIZARD_STEPS.find((s) => states[s] === "todo") ?? WIZARD_STEPS.find((s) => states[s] === "waiting") ?? "documents";
}

/** Everything «جاهز للسفر» needs; a mandatory item not ok blocks it. */
export function readiness(data: ReadinessCase): ReadinessItem[] {
  return WIZARD_STEPS.flatMap((step) => RULES[step].readiness(data));
}

/** The gate itself — the button and setExecutionStatus("ready_to_travel") both ask this. */
export function readyToTravel(items: ReadinessItem[]): boolean {
  return items.every((i) => i.ok || i.optional);
}

/** A readiness item's words — every key has them (readiness-keys.test.ts). */
export const readyLabel = (i: ReadinessItem) => `wz.ready.${i.step}.${i.key}` as TranslationKey;

/**
 * A step tile's colour (the owner, 2026-10-18: «يتحول المربع بنفس لون الخطأ»):
 *   red    — a mandatory item missing: exactly what blocks «جاهز للسفر», so
 *            «no red tile» and readyToTravel are one rule;
 *   yellow — only an optional item missing, or the step's own work not done
 *            though nothing blocks (travelling unpaid on a manager's exception);
 *   green  — complete;  grey — the file has none of it.
 */
export type StepTone = "red" | "yellow" | "green" | "grey";

export function stepTone(state: StepState, items: ReadinessItem[]): StepTone {
  if (items.some((i) => !i.ok && !i.optional)) return "red";
  if (items.some((i) => !i.ok) || state === "todo" || state === "waiting") return "yellow";
  return state === "na" ? "grey" : "green";
}
