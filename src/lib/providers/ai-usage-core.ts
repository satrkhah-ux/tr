/**
 * What the background AI may spend in a day (the owner, 2026-10-26: «في 12 ساعة صرف 100$ — كارثة»: the knowledge fold re-read
 * hundreds of lessons with the strong model every minute and the project's $100 limit was gone in half a day). Pure: the
 * counting and the rule; ai-usage.ts keeps the day's numbers and asks them.
 */

/** the jobs nobody is waiting for — summaries, the memory fold, the learning sweep: the ones a budget may pause */
export const BACKGROUND_FEATURES = new Set(["murad_knowledge", "followup_summary", "murad_lessons"]);

/** «strong» models are the expensive reasoning ones; everything else is «cheap» (gpt-4o-mini reads) */
export type ModelClass = "strong" | "cheap";
export const modelClass = (model: string): ModelClass => (/^(gpt-5|o\d)/.test(model) ? "strong" : "cheap");

/** tokens a day, per class, for the background jobs together (app_settings «ai_budget» overrides) */
export const DEFAULT_BUDGET: Record<ModelClass, number> = { strong: 1_500_000, cheap: 30_000_000 };

export type Usage = { calls: number; input: number; output: number };
/** «feature|model» → what it used today */
export type DayUsage = Record<string, Usage>;

export const usageKey = (feature: string, model: string) => `${feature}|${model}`;
export const emptyUsage = (): Usage => ({ calls: 0, input: 0, output: 0 });

export function addUsage(day: DayUsage, feature: string, model: string, add: { input: number; output: number }): DayUsage {
  const key = usageKey(feature, model);
  const was = day[key] ?? emptyUsage();
  return { ...day, [key]: { calls: was.calls + 1, input: was.input + add.input, output: was.output + add.output } };
}

export function mergeUsage(a: DayUsage, b: DayUsage): DayUsage {
  const out: DayUsage = { ...a };
  for (const [key, u] of Object.entries(b)) {
    const was = out[key] ?? emptyUsage();
    out[key] = { calls: was.calls + u.calls, input: was.input + u.input, output: was.output + u.output };
  }
  return out;
}

/** the background tokens spent today in one class */
export function backgroundSpent(day: DayUsage, cls: ModelClass): number {
  return Object.entries(day).reduce((sum, [key, u]) => {
    const [feature, model] = key.split("|");
    return BACKGROUND_FEATURES.has(feature) && modelClass(model ?? "") === cls ? sum + u.input + u.output : sum;
  }, 0);
}

/** may this call go ahead: foreground features always, a background one while its class is under today's budget */
export function budgetAllows(day: DayUsage, feature: string, model: string, budget: Record<ModelClass, number> = DEFAULT_BUDGET): boolean {
  if (!BACKGROUND_FEATURES.has(feature)) return true;
  const cls = modelClass(model);
  return backgroundSpent(day, cls) < budget[cls];
}

export function parseBudget(raw: string | null | undefined): Record<ModelClass, number> {
  try {
    const v = JSON.parse(raw ?? "null") as Partial<Record<ModelClass, unknown>> | null;
    const num = (x: unknown, fallback: number) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : fallback);
    return { strong: num(v?.strong, DEFAULT_BUDGET.strong), cheap: num(v?.cheap, DEFAULT_BUDGET.cheap) };
  } catch {
    return DEFAULT_BUDGET;
  }
}
