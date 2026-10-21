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
export type MuradControl = {
  tasks: Record<keyof typeof TASK_LABELS, boolean>;
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
const ids = (v: unknown): v is number[] => Array.isArray(v) && v.length <= 100 && v.every((n) => Number.isSafeInteger(n) && n > 0);
export function validControl(v: unknown): v is MuradControl {
  if (!v || typeof v !== "object") return false;
  const c = v as MuradControl;
  return (c.visaAll === undefined || typeof c.visaAll === "boolean") && typeof c.includePrice === "boolean" && ids(c.inboxIds) && ids(c.teamIds)
    && !!c.tasks && Object.keys(TASK_LABELS).every((k) => typeof c.tasks[k as keyof typeof TASK_LABELS] === "boolean")
    && !!c.handoffs && typeof c.handoffs === "object" && !Array.isArray(c.handoffs)
    && Object.entries(c.handoffs).every(([k, h]) => ROUTE_KEYS.includes(k as RouteKey) && !!h
      && (h.teamId === null || ids([h.teamId])) && (h.agentId === null || ids([h.agentId])));
}
export function parseControl(raw: string | null | undefined): MuradControl {
  if (!raw) return defaultControl();
  try { const c: unknown = JSON.parse(raw); if (validControl(c)) return c; } catch {}
  // A corrupted saved control must never widen the assistant's scope.
  const c = defaultControl();
  for (const k of Object.keys(c.tasks) as (keyof typeof c.tasks)[]) c.tasks[k] = false;
  return c;
}
export function inMuradScope(c: MuradControl, inbox: number | null, team: number | null): boolean {
  return (!c.inboxIds.length || (inbox !== null && c.inboxIds.includes(inbox)))
    && (!c.teamIds.length || (team !== null && c.teamIds.includes(team)));
}
