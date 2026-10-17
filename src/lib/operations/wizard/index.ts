import { documentsReadiness, documentsState } from "./documents";
import { flightsReadiness, flightsState } from "./flights";
import { hotelsReadiness, hotelsState } from "./hotels";
import { passportsReadiness, passportsState } from "./passports";
import { paymentReadiness, paymentState } from "./payment";
import { transportReadiness, transportState } from "./transport";
import { WIZARD_STEPS, type ReadinessItem, type StepState, type WizardCase, type WizardStep } from "./types";

/** Each step's own rules, in one place for the progress bar and the readiness gate. */
const RULES: Record<WizardStep, { state: (d: WizardCase) => StepState; readiness: (d: WizardCase) => ReadinessItem[] }> = {
  passports: { state: passportsState, readiness: passportsReadiness },
  flights: { state: flightsState, readiness: flightsReadiness },
  hotels: { state: hotelsState, readiness: hotelsReadiness },
  transport: { state: transportState, readiness: transportReadiness },
  payment: { state: paymentState, readiness: paymentReadiness },
  documents: { state: documentsState, readiness: documentsReadiness },
};

/** A waiting step reads «ينتظر» whatever its own rule says — until it is done. */
export function stepStates(data: WizardCase): Record<WizardStep, StepState> {
  return Object.fromEntries(
    WIZARD_STEPS.map((step) => {
      const own = RULES[step].state(data);
      return [step, own !== "done" && own !== "na" && data.waits[step] ? "waiting" : own];
    }),
  ) as Record<WizardStep, StepState>;
}

/** The first step with something left — where opening the case lands. */
export function firstOpenStep(data: WizardCase): WizardStep {
  const states = stepStates(data);
  return WIZARD_STEPS.find((s) => states[s] === "todo") ?? WIZARD_STEPS.find((s) => states[s] === "waiting") ?? "documents";
}

/** Everything «جاهز للسفر» needs; a mandatory item not ok blocks it. */
export function readiness(data: WizardCase): ReadinessItem[] {
  return WIZARD_STEPS.flatMap((step) => RULES[step].readiness(data));
}
