import type { SupabaseClient } from "@supabase/supabase-js";
import { LATENESS_EXEMPT_KEY, parseLatenessExempt, type ExemptSet } from "@/lib/leads/lateness";

/**
 * «لا يُحسب عليهم تأخير» (the owner, 2026-10-29) for «قناة المدير»: the morning desk and the visa department are never
 * shown late — no wait, no reply time. Who they are is the administration's setting (app_settings lateness_exempt, read by
 * session A's latenessExempt() in leads/lifecycle.ts the same way); read here for the channel's snapshot, which runs
 * on the service role. Nobody when the setting is missing or unreadable: then everything counts as before.
 */
export async function exemptNow(service: SupabaseClient): Promise<ExemptSet> {
  try {
    const { data } = await service.from("app_settings").select("value").eq("key", LATENESS_EXEMPT_KEY).maybeSingle();
    const set = parseLatenessExempt((data as { value: string } | null)?.value);
    const people = [...(set.employees.length ? [`id.in.(${set.employees.join(",")})`] : []), ...(set.roles.length ? [`role_id.in.(${set.roles.join(",")})`] : [])];
    const { data: emps } = people.length ? await service.from("employees").select("teletel_agent_id").eq("status", "Active").or(people.join(",")) : { data: [] };
    const agentIds = ((emps ?? []) as { teletel_agent_id: number | null }[]).map((e) => e.teletel_agent_id).filter((a): a is number => typeof a === "number");
    return { agentIds: new Set(agentIds), teamIds: new Set(set.teams) };
  } catch {
    return { agentIds: new Set(), teamIds: new Set() };
  }
}
