import type { SupabaseClient } from "@supabase/supabase-js";
import { LATENESS_EXEMPT_KEY, parseLatenessExempt, type ExemptSet } from "@/lib/leads/lateness";
import { teamLabel } from "@/lib/leads/assignment";
import { listTeletelTeams, teamMembers } from "@/lib/providers/teletel";

/** who is exempt, three ways: as Teletel sees them (agents, teams), as the system keeps them (employee ids), and by name */
export type ExemptNow = ExemptSet & {
  /** the exempt colleagues' employee ids — to leave them out of per-employee figures (the eye's tickets, the supervision report) */
  employeeIds: ReadonlySet<string>;
  /** their names as the system spells them — for the figures Teletel gives by name only (a reply time) */
  names: string[];
};

/**
 * «لا يُحسب عليهم تأخير» (the owner, 2026-10-29) for «قناة المدير» and the report: the morning desk and the visa department
 * are never shown late — no wait, no reply time. Who they are is the administration's setting (app_settings lateness_exempt); read
 * here for code that runs on the service role — the same people as latenessExempt() (leads/lifecycle.ts), plus what the channel and
 * the reports also need: names and the exempt teams' members. A colleague named in the setting stays exempt whatever their status; a department's members only while active.
 * Nobody when the setting is missing or unreadable: then everything counts as before.
 *
 * `withTeams`: also read who is in the exempt Teletel teams (the visa department has a colleague with no employee row) — their
 * agent ids and names join the others, so a conversation or a reply time of theirs is exempt too. A live read of Teletel (a minute
 * cached), so only the callers that measure Teletel conversations ask for it; an unanswered team read leaves the rest as it was.
 */
export async function exemptNow(service: SupabaseClient, withTeams = false): Promise<ExemptNow> {
  try {
    const { data } = await service.from("app_settings").select("value").eq("key", LATENESS_EXEMPT_KEY).maybeSingle();
    const set = parseLatenessExempt((data as { value: string } | null)?.value);
    const people = [...(set.employees.length ? [`id.in.(${set.employees.join(",")})`] : []), ...(set.roles.length ? [`and(role_id.in.(${set.roles.join(",")}),status.eq.Active)`] : [])];
    const { data: emps } = people.length ? await service.from("employees").select("id, arabic_name, teletel_agent_id").or(people.join(",")) : { data: [] };
    const list = (emps ?? []) as { id: string; arabic_name: string | null; teletel_agent_id: number | null }[];
    const members = withTeams ? (await Promise.all(set.teams.map((t) => teamMembers(t).catch(() => [])))).flat() : [];
    // a conversation sitting in an exempt team that no one has taken is held by «قسم X» alone
    const labels = withTeams && set.teams.length ? (await listTeletelTeams().catch(() => [])).filter((t) => set.teams.includes(t.id)).map((t) => teamLabel(t.name)) : [];
    return {
      agentIds: new Set([...list.map((e) => e.teletel_agent_id).filter((a): a is number => typeof a === "number"), ...members.map((m) => m.id)]),
      teamIds: new Set(set.teams),
      employeeIds: new Set(list.map((e) => e.id)),
      names: [...new Set([...list.map((e) => e.arabic_name?.trim() ?? ""), ...members.map((m) => m.name), ...labels].filter(Boolean))],
    };
  } catch {
    return { agentIds: new Set(), teamIds: new Set(), employeeIds: new Set(), names: [] };
  }
}
