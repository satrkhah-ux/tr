/**
 * «الربط الخارجي»: when an integration is a problem worth a message — once per
 * problem, not every run (the owner, 2026-10-19). Pure; the doing is
 * lib/developer/integrations-run.ts.
 *
 *  · a check failing twice in a row → «fail» (a single blip says nothing);
 *  · an end date within 14, 7 or 1 days — the one typed on the row, or the one
 *    the check read (a certificate, a domain) → «expiry:14|7|1».
 * The same problem is said once; a worse one (7 after 14) is said again; when
 * all is well the memory clears, so the next problem is said too.
 */
export type HealthStatus = "ok" | "warn" | "down" | "unconfigured" | "idle";
export type AlertState = { fail_streak: number; alerted: string | null };
export type AlertStep = AlertState & { alert: string | null; days: number | null };

const daysUntil = (iso: string, today: string) => Math.floor((Date.parse(iso.slice(0, 10)) - Date.parse(today)) / 86_400_000);

export function nextAlert(prev: AlertState, check: { status: HealthStatus; days?: number | null } | null, renewsOn: string | null, today: string): AlertStep {
  const failing = check ? check.status === "down" || check.status === "unconfigured" : false;
  const fail_streak = check ? (failing ? prev.fail_streak + 1 : 0) : prev.fail_streak;
  const ends = [renewsOn ? daysUntil(renewsOn, today) : null, check?.days ?? null].filter((d): d is number => d != null);
  const days = ends.length ? Math.min(...ends) : null;
  const threshold = days == null ? null : days <= 1 ? 1 : days <= 7 ? 7 : days <= 14 ? 14 : null;
  const problem = fail_streak >= 2 ? "fail" : threshold ? `expiry:${threshold}` : null;
  return { fail_streak, alerted: problem, alert: problem && problem !== prev.alerted ? problem : null, days };
}
