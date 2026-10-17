import type { ReadinessItem, StepState, WizardCase } from "./types";

// Placeholder — the «hotels» step's owner replaces both with the real rules.
export function hotelsState(_data: WizardCase): StepState {
  return "todo";
}

export function hotelsReadiness(_data: WizardCase): ReadinessItem[] {
  return [];
}
