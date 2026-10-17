import type { ReadinessItem, StepState, WizardCase } from "./types";

// Placeholder — the «passports» step's owner replaces both with the real rules.
export function passportsState(_data: WizardCase): StepState {
  return "todo";
}

export function passportsReadiness(_data: WizardCase): ReadinessItem[] {
  return [];
}
