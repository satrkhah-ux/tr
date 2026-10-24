import { ROUTE_KEYS, type RouteKey } from "./reception";

export const MURAD_CONTROL_KEY = "murad_control";
export const TASK_LABELS = {
  reception: "استقبال الطلبات وتحويلها",
  suggest: "اقتراح رد خاص للموظف",
  auto: "الرد التلقائي على العميل",
  offers: "إعداد برامج السفر",
  visas: "الإجابة عن التأشيرات",
  holding: "طمأنة العميل أثناء انتظار الموظف",
} as const;
/** what Murad does with a kind of request (the owner, 2026-10-24: «لا تستلم اي طلب يخص التأشيرات» is a decision, not a prompt) */
export const KIND_MODES = { handle: "يرد ويحوّل", route: "يحوّل فقط بلا إجابة", off: "لا يتدخل — يتركه للقسم" } as const;
export type KindMode = keyof typeof KIND_MODES;
export type MuradControl = {
  tasks: Record<keyof typeof TASK_LABELS, boolean>;
  /** per kind of request; absent = «handle» */
  kinds?: Partial<Record<RouteKey, KindMode>>;
  /** Teletel agents Murad never hands a conversation to («لا ترسل لفلان») */
  paused?: number[];
  /** a client still unanswered this many minutes after Murad's hand-over → this agent */
  late?: { minutes: number; agentId: number } | null;
  /** the management's numbers: what they write is a decision or a lesson for Murad, never a client's request */
  admins?: string[];
  /** numbers Murad never hands to anyone (the owner's own test line) */
  noHandoff?: string[];
  /** written on an admin number: a new trial starts, as a client would write */
  resetCode?: string;
  /** read every past conversation into lessons (lessons.ts learnSweep) */
  learn?: boolean;
  visaAll?: boolean;
  includePrice: boolean;
  inboxIds: number[];
  teamIds: number[];
  handoffs: Partial<Record<RouteKey, { teamId: number | null; agentId: number | null }>>;
};
export const defaultControl = (): MuradControl => ({
  tasks: { reception: true, suggest: true, auto: true, offers: true, visas: true, holding: true },
  visaAll: false, includePrice: true, inboxIds: [], teamIds: [], handoffs: {},
});
const phones = (v: unknown) => v === undefined || (Array.isArray(v) && v.length <= 20 && v.every((p) => typeof p === "string" && /^\+?\d{6,15}$/.test(p)));
const ids = (v: unknown): v is number[] => Array.isArray(v) && v.length <= 100 && v.every((n) => Number.isSafeInteger(n) && n > 0);
export function validControl(v: unknown): v is MuradControl {
  if (!v || typeof v !== "object") return false;
  const c = v as MuradControl;
  return (c.visaAll === undefined || typeof c.visaAll === "boolean") && typeof c.includePrice === "boolean" && ids(c.inboxIds) && ids(c.teamIds)
    && !!c.tasks && Object.keys(TASK_LABELS).every((k) => typeof c.tasks[k as keyof typeof TASK_LABELS] === "boolean")
    && !!c.handoffs && typeof c.handoffs === "object" && !Array.isArray(c.handoffs)
    && Object.entries(c.handoffs).every(([k, h]) => ROUTE_KEYS.includes(k as RouteKey) && !!h
      && (h.teamId === null || ids([h.teamId])) && (h.agentId === null || ids([h.agentId])))
    && (c.kinds === undefined || (!!c.kinds && typeof c.kinds === "object" && Object.entries(c.kinds).every(([k, m]) => ROUTE_KEYS.includes(k as RouteKey) && typeof m === "string" && m in KIND_MODES)))
    && (c.paused === undefined || ids(c.paused))
    && (c.late === undefined || c.late === null || (Number.isInteger(c.late.minutes) && c.late.minutes >= 1 && c.late.minutes <= 1440 && ids([c.late.agentId])))
    && phones(c.admins) && phones(c.noHandoff) && (c.learn === undefined || typeof c.learn === "boolean")
    && (c.resetCode === undefined || (typeof c.resetCode === "string" && /^\d{4,12}$/.test(c.resetCode)));
}
export function parseControl(raw: string | null | undefined): MuradControl {
  if (!raw) return defaultControl();
  try { const c: unknown = JSON.parse(raw); if (validControl(c)) return c; } catch {}
  // A corrupted saved control must never widen the assistant's scope.
  const c = defaultControl();
  for (const k of Object.keys(c.tasks) as (keyof typeof c.tasks)[]) c.tasks[k] = false;
  return c;
}
/**
 * Murad answers visa questions for EVERY client (not only the test numbers) —
 * one rule for every place that asks (the evaluator, 2026-10-22: on 21 Oct
 * visaAll was on while «الإجابة عن التأشيرات» was off, the minute sweep read
 * visaAll alone, and 62 real clients got visa replies). Both must be on.
 */
export const visaForAll = (c: MuradControl): boolean => c.tasks.visas && c.visaAll === true;

export function inMuradScope(c: MuradControl, inbox: number | null, team: number | null): boolean {
  return (!c.inboxIds.length || (inbox !== null && c.inboxIds.includes(inbox)))
    && (!c.teamIds.length || (team !== null && c.teamIds.includes(team)));
}

export const kindMode = (c: MuradControl, kind: RouteKey | null): KindMode => (kind && c.kinds?.[kind]) || "handle";
/** a number on a list, matched on its last nine digits — WhatsApp writes +966…, people write 05… */
export const onList = (phone: string | null | undefined, list: string[] | undefined): boolean => {
  const tail = (phone ?? "").replace(/\D/g, "").slice(-9);
  return tail.length === 9 && (list ?? []).some((p) => p.replace(/\D/g, "").slice(-9) === tail);
};
