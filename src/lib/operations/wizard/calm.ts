import { readiness, stepStates, firstOpenStep } from "./index";
import { WIZARD_STEPS, type ReadinessCase, type ReadinessItem, type WizardCase, type WizardStep } from "./types";

/**
 * «يدخل على ملف يساعده وليس يصعب عليه» (the owner, 2026-10-26): the case opens
 * on ONE thing — the next item to do — and everything else waits quietly
 * behind it. Pure, so the wizard, the board and the day list agree on it.
 */

/** The one thing to do next: the first mandatory gap in step order, else the first warning, else the first optional gap. */
export function nextNow(data: WizardCase): { step: WizardStep; item: ReadinessItem | null } | null {
  const items = readiness(data);
  const inOrder = (pick: (i: ReadinessItem) => boolean): ReadinessItem | undefined => {
    for (const step of WIZARD_STEPS) {
      const hit = items.find((i) => i.step === step && pick(i));
      if (hit) return hit;
    }
    return undefined;
  };
  const item = inOrder((i) => !i.ok && !i.optional) ?? inOrder((i) => !i.ok && i.warning === true) ?? inOrder((i) => !i.ok);
  if (item) return { step: item.step, item };
  // nothing blocks, but a step may still hold work (its own state says todo)
  const states = stepStates(data);
  const open = WIZARD_STEPS.find((s) => states[s] === "todo" || states[s] === "waiting");
  return open ? { step: open, item: null } : null;
}

/**
 * When red is honest (the owner: «الأحمر فقط لما يحجب السفر أو تأخّر فعلاً»):
 * a fresh file full of gaps is normal work, not an alarm. Red appears only
 * once the travel date is on top of us — passed, or within three days — while
 * something mandatory is still missing.
 */
export type CalmUrgency = "late" | "soon" | "normal";
export function calmUrgency(travelStart: string | null, today: string): CalmUrgency {
  if (!travelStart || !today) return "normal";
  const days = Math.floor((Date.parse(travelStart) - Date.parse(today)) / 86_400_000);
  if (!Number.isFinite(days)) return "normal";
  return days < 0 ? "late" : days <= 3 ? "late" : days <= 7 ? "soon" : "normal";
}

/** The quiet list under the big card: every step left, its first gap and how many more. */
export type CalmRow = {
  step: WizardStep;
  state: "todo" | "waiting";
  first: ReadinessItem | null;
  more: number;
  /** a warning (never blocking) colours the row amber, not red */
  warning: boolean;
};
export function calmRows(data: WizardCase, skipStep?: WizardStep): CalmRow[] {
  const states = stepStates(data);
  const items = readiness(data);
  return WIZARD_STEPS.filter((s) => s !== skipStep && (states[s] === "todo" || states[s] === "waiting")).map((s) => {
    const own = items.filter((i) => i.step === s && !i.ok);
    const mandatory = own.filter((i) => !i.optional);
    const first = mandatory[0] ?? own.find((i) => i.warning) ?? own[0] ?? null;
    return {
      step: s,
      state: states[s] === "waiting" ? "waiting" : "todo",
      first,
      more: Math.max(0, own.length - 1),
      warning: mandatory.length === 0 && own.some((i) => i.warning),
    };
  });
}

/** The ✓ line: the steps already finished (or not applicable), in order. */
export function calmDone(data: WizardCase): { step: WizardStep; na: boolean }[] {
  const states = stepStates(data);
  return WIZARD_STEPS.filter((s) => states[s] === "done" || states[s] === "na").map((s) => ({ step: s, na: states[s] === "na" }));
}

export { firstOpenStep };
export type { ReadinessCase };
