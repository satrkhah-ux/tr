import type { SupabaseClient } from "@supabase/supabase-js";
import { LATENESS_EXEMPT_KEY, parseLatenessExempt, type ExemptSet } from "@/lib/leads/lateness";
import { teamMembers } from "@/lib/providers/teletel";

/** who is exempt, three ways: as Teletel sees them (agents, teams), as the system keeps them (employee ids), and by name */
export type ExemptNow = ExemptSet & {
  /** the exempt colleagues' employee ids — to leave them out of per-employee figures (the eye's tickets, the supervision report) */
  employeeIds: ReadonlySet<string>;
  /** their names as the system spells them — for the figures Teletel gives by name only (a reply time) */
  names: string[];
};

/**
 * «لا يُحسب عليهم تأخير» (the owner, 2026-10-29) for «قناة المدير» and the report: the morning desk and the visa department
 * are never shown late — no wait, no reply time. Who they are is the administration's setting (app_settings lateness_exempt,
 * read by session A's latenessExempt() in leads/lifecycle.ts the same way); read here for code that runs on the service
 * role. Nobody when the setting is missing or unreadable: then everything counts as before.
 *
 * `withTeams`: also read who is in the exempt Teletel teams (the visa department has a colleague with no employee row) — their
 * agent ids and names join the others, so a conversation or a reply time of theirs is exempt too. A live read of Teletel (a minute
 * cached), so only the callers that measure Teletel conversations ask for it; an unanswered team read leaves the rest as it was.
 */
export async function exemptNow(service: SupabaseClient, withTeams = false): Promise<ExemptNow> {
  try {
    const { data } = await service.from("app_settings").select("value").eq("key", LATENESS_EXEMPT_KEY).maybeSingle();
    const set = parseLatenessExempt((data as { value: string } | null)?.value);
    const people = [...(set.employees.length ? [`id.in.(${set.employees.join(",")})`] : []), ...(set.roles.length ? [`role_id.in.(${set.roles.join(",")})`] : [])];
    const { data: emps } = people.length ? await service.from("employees").select("id, arabic_name, teletel_agent_id").or(people.join(",")) : { data: [] };
    const list = (emps ?? []) as { id: string; arabic_name: string | null; teletel_agent_id: number | null }[];
    const members = withTeams ? (await Promise.all(set.teams.map((t) => teamMembers(t).catch(() => [])))).flat() : [];
    return {
      agentIds: new Set([...list.map((e) => e.teletel_agent_id).filter((a): a is number => typeof a === "number"), ...members.map((m) => m.id)]),
      teamIds: new Set(set.teams),
      employeeIds: new Set(list.map((e) => e.id)),
      names: [...new Set([...list.map((e) => e.arabic_name?.trim() ?? ""), ...members.map((m) => m.name)].filter(Boolean))],
    };
  } catch {
    return { agentIds: new Set(), teamIds: new Set(), employeeIds: new Set(), names: [] };
  }
}
