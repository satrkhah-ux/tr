import type { ReadinessItem, StepState, WizardCase } from "./types";

// Placeholder — the «transport» step's owner replaces both with the real rules.
export function transportState(_data: WizardCase): StepState {
  return "todo";
}

export function transportReadiness(_data: WizardCase): ReadinessItem[] {
  return [];
}
