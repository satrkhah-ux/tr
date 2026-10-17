import type { ReadinessItem, StepState, WizardCase } from "./types";

// Placeholder — the «payment» step's owner replaces both with the real rules.
export function paymentState(_data: WizardCase): StepState {
  return "todo";
}

export function paymentReadiness(_data: WizardCase): ReadinessItem[] {
  return [];
}
