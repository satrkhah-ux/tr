import type { ReadinessItem, StepState, WizardCase } from "./types";

// Placeholder — the «documents» step's owner replaces both with the real rules.
export function documentsState(_data: WizardCase): StepState {
  return "todo";
}

export function documentsReadiness(_data: WizardCase): ReadinessItem[] {
  return [];
}
