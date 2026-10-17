import { WAIT_FROM, WIZARD_STEPS, type CaseWaits, type StepWait, type WizardStep } from "./types";

/**
 * «قائمة متابعتك اليوم»: the waits whose day has come, coloured by how close
 * the trip is — grey: due today, still waiting; yellow: its day has passed;
 * red: the trip is within a day, whatever the wait said. Pure: `today` is the
 * office's day (Riyadh), passed in. The dashboard list and the morning notice
 * (daily.ts → notifyDueWaits) read the same answer.
 */

export type FollowUpTone = "grey" | "yellow" | "red";
export type FollowUp = { tone: FollowUpTone; steps: (StepWait & { step: WizardStep })[] };

/** One row of «قائمة متابعتك اليوم» as «لوحتي» draws it. */
export type FollowUpItem = {
  operationId: string;
  serial: string;
  client: string | null;
  travelStart: string | null;
  tone: FollowUpTone;
  steps: { step: WizardStep; from: string; until: string; note: string | null }[];
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** operations.waits as stored — anything malformed is dropped rather than trusted. */
export function readWaits(raw: unknown): CaseWaits {
  if (!raw || typeof raw !== "object") return {};
  const out: CaseWaits = {};
  for (const step of WIZARD_STEPS) {
    const w = (raw as Record<string, unknown>)[step] as Partial<StepWait> | undefined;
    if (w && WAIT_FROM.includes(w.from as never) && typeof w.until === "string" && ISO.test(w.until)) {
      out[step] = { from: w.from as StepWait["from"], until: w.until, note: w.note ?? null, at: w.at ?? "", by: w.by ?? null };
    }
  }
  return out;
}

/** The case's follow-up today, or null when none of its waits is due and the trip is not upon it. */
export function followUpOf(waits: CaseWaits, travelStart: string | null, today: string): FollowUp | null {
  const all = WIZARD_STEPS.flatMap((step) => (waits[step] ? [{ ...waits[step], step }] : []));
  const urgent = travelStart != null && travelStart <= addDays(today, 1);
  const steps = urgent ? all : all.filter((w) => w.until <= today);
  if (steps.length === 0) return null;
  return { tone: urgent ? "red" : steps.some((w) => w.until < today) ? "yellow" : "grey", steps };
}
