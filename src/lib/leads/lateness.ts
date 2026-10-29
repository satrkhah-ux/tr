/**
 * «لا يُحسب عليهم تأخير» (the owner, 2026-10-29): the morning desk — محمد الحبيب, who holds every request in the
 * office — and the whole visa department. Their delays count nowhere: screens, reports, reminders, performance. The
 * system helps them; it never judges them. A setting of the administration («الإدارة ← إدارة المحادثات»), never a
 * value in code: app_settings lateness_exempt — the same key session B's availability reads (reason «exempt»).
 * Pure; the reader is leads/lifecycle.ts latenessExempt().
 */
export const LATENESS_EXEMPT_KEY = "lateness_exempt";

/** staff (employee ids), departments (role ids) and Teletel teams («قسم فيزا» holds a colleague with no employee row) */
export type LatenessExempt = { employees: string[]; roles: string[]; teams: number[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** the saved setting, every list checked; anything unreadable is an empty list (nobody exempt) */
export function parseLatenessExempt(raw: string | null | undefined): LatenessExempt {
  let v: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw ?? "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) v = parsed as Record<string, unknown>;
  } catch {
    /* nobody */
  }
  const uuids = (x: unknown) => (Array.isArray(x) ? [...new Set(x.filter((s): s is string => typeof s === "string" && UUID.test(s)))].slice(0, 200) : []);
  const ints = (x: unknown) => (Array.isArray(x) ? [...new Set(x.filter((n): n is number => Number.isSafeInteger(n) && (n as number) > 0))].slice(0, 100) : []);
  return { employees: uuids(v.employees), roles: uuids(v.roles), teams: ints(v.teams) };
}

/** who is exempt, as Teletel sees them: their agents, and the exempt teams */
export type ExemptSet = { agentIds: ReadonlySet<number>; teamIds: ReadonlySet<number> };

/** a conversation whose waiting counts against nobody: its holder is exempt, or it sits in an exempt team */
export function exemptConversation(c: { assigneeId: number | null; teamId: number | null }, x: ExemptSet): boolean {
  return (c.assigneeId !== null && x.agentIds.has(c.assigneeId)) || (c.teamId !== null && x.teamIds.has(c.teamId));
}
