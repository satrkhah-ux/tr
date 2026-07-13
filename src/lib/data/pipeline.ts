import type { TranslationKey } from "@/lib/i18n";

/** Kanban pipeline stages (offers.pipeline_stage). Shared by the Server Action
 *  (validation) and the Kanban board (columns). Labels are i18n keys resolved
 *  through the translator at render time. */
export const KANBAN_STAGES = [
  { key: "active_not_confirmed", labelKey: "stage.activeNotConfirmed" },
  { key: "followed_up", labelKey: "stage.followedUp" },
  { key: "confirmed_hotels", labelKey: "stage.confirmedHotels" },
  { key: "flights", labelKey: "stage.flights" },
  { key: "transportation", labelKey: "stage.transportation" },
  { key: "completed", labelKey: "stage.completed" },
] as const satisfies readonly { key: string; labelKey: TranslationKey }[];

export type StageKey = (typeof KANBAN_STAGES)[number]["key"];

export const STAGE_KEYS: readonly string[] = KANBAN_STAGES.map((s) => s.key);
