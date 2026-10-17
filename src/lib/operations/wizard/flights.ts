import type { ReadinessItem, StepState, WizardCase } from "./types";

// Placeholder — the «flights» step's owner replaces both with the real rules.
export function flightsState(_data: WizardCase): StepState {
  return "todo";
}

export function flightsReadiness(_data: WizardCase): ReadinessItem[] {
  return [];
}
