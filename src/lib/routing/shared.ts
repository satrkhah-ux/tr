/**
 * «لا طلب بلا صاحب» (the owner, 2026-10-24). The client 0560258364 waited eleven hours for an answer
 * on «متابعة المبيعات» — a SHARED Teletel login (agent 68), the only member of its own team (28), and
 * nobody's in our system: no «تنبيهاتي» alert reached a person, no seller owned the client.
 *
 * So a client waiting on a shared account — the login itself, or its team with nobody on it — for a
 * few minutes goes to a real seller of «قسم المبيعات»: one linked to an employee, not paused, online
 * first, with the fewest clients already waiting on them. Pure: the sweep (shared-sweep.ts) and its
 * tests share it.
 */

export type SharedSettings = {
  mode: "on" | "dry";
  /** Teletel agents that are shared logins, not people */
  agents: number[];
  /** teams whose only member is such a login: a conversation there with no agent is nobody's too */
  teams: number[];
  /** where the seller comes from */
  salesTeam: number;
  /** how long the client waits before it moves */
  minutes: number;
};

export const DEFAULT_SHARED: SharedSettings = { mode: "on", agents: [68], teams: [28], salesTeam: 38, minutes: 5 };

/** app_settings `routing_shared`: "off" stops it, "dry" only reports, a JSON object overrides the defaults. */
export function parseShared(raw: string | null | undefined): SharedSettings | null {
  const v = (raw ?? "").trim();
  if (v === "off") return null;
  if (v === "dry") return { ...DEFAULT_SHARED, mode: "dry" };
  if (!v.startsWith("{")) return DEFAULT_SHARED;
  try {
    const o = JSON.parse(v) as Partial<SharedSettings>;
    const ids = (x: unknown, d: number[]) => (Array.isArray(x) && x.every((n) => Number.isInteger(n)) ? (x as number[]) : d);
    return {
      mode: o.mode === "dry" ? "dry" : "on",
      agents: ids(o.agents, DEFAULT_SHARED.agents),
      teams: ids(o.teams, DEFAULT_SHARED.teams),
      salesTeam: Number.isInteger(o.salesTeam) ? (o.salesTeam as number) : DEFAULT_SHARED.salesTeam,
      minutes: typeof o.minutes === "number" && o.minutes >= 1 ? o.minutes : DEFAULT_SHARED.minutes,
    };
  } catch {
    return DEFAULT_SHARED;
  }
}

export type ConversationOwner = { assigneeId: number | null; teamId: number | null; waitingSince: number };

/** A client waiting on nobody: on a shared login, or in a shared team with no agent — for `minutes` or more. */
export function isOrphan(c: ConversationOwner, s: SharedSettings, nowSec: number): boolean {
  const shared = c.assigneeId != null ? s.agents.includes(c.assigneeId) : c.teamId != null && s.teams.includes(c.teamId);
  return shared && c.waitingSince > 0 && nowSec - c.waitingSince >= s.minutes * 60;
}

export type Seller = { id: number; name: string; online: boolean };
export type SellerLoad = { waiting: number; open: number };

/** Who takes it: the online sellers if any are, then the fewest clients waiting on them, then the fewest open. */
export function pickSeller(sellers: Seller[], load: Map<number, SellerLoad>): Seller | null {
  const pool = sellers.some((s) => s.online) ? sellers.filter((s) => s.online) : sellers;
  const of = (id: number) => load.get(id) ?? { waiting: 0, open: 0 };
  return [...pool].sort((a, b) => of(a.id).waiting - of(b.id).waiting || of(a.id).open - of(b.id).open || a.id - b.id)[0] ?? null;
}
