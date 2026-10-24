"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { currentCan } from "@/lib/roles/current";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { listTeletelTeams, teletelGet } from "@/lib/providers/teletel";
import { logAudit } from "./audit";
import { MURAD_CONTROL_KEY, parseControl, validControl, type MuradControl } from "@/lib/murad/control";

const allowed = async () => await currentCan("settings.manage") || await currentCan("developer.access");
const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
export async function getMuradControl() {
  if (!(await allowed())) return null;
  const [{ data, error }, teams, agents, inboxes] = await Promise.all([
    db().from("app_settings").select("value").eq("key", MURAD_CONTROL_KEY).maybeSingle(),
    listTeletelTeams(),
    teletelGet<{ id: number; name: string }[]>("/agents"),
    teletelGet<{ payload: { id: number; name: string }[] }>("/inboxes"),
  ]);
  if (error) return null;
  return { control: parseControl(data?.value), teams, agents: Array.isArray(agents) ? agents : [], inboxes: Array.isArray(inboxes?.payload) ? inboxes.payload : [] };
}
export async function saveMuradControl(control: MuradControl): Promise<{ ok: boolean; error?: string }> {
  if (!(await allowed())) return { ok: false, error: "لا صلاحية" };
  if (!validControl(control)) return { ok: false, error: "إعدادات غير صالحة" };
  const options = await getMuradControl();
  if (!options) return { ok: false, error: "تعذّر التحقق من الإعدادات" };
  if (control.inboxIds.some((id) => !options.inboxes.some((x) => x.id === id))
    || control.teamIds.some((id) => !options.teams.some((x) => x.id === id))
    || Object.values(control.handoffs).some((h) => !h
      || (h.teamId !== null && !options.teams.some((x) => x.id === h.teamId))
      || (h.agentId !== null && !options.agents.some((x) => x.id === h.agentId)))
    || [...(control.paused ?? []), ...(control.late ? [control.late.agentId] : [])].some((id) => !options.agents.some((x) => x.id === id))) {
    return { ok: false, error: "تعذّر التحقق من القسم أو الموظف. حدّث الصفحة وحاول مجددًا." };
  }
  const { error } = await db().from("app_settings").upsert({ key: MURAD_CONTROL_KEY, value: JSON.stringify(control), updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: "تعذّر الحفظ" };
  await logAudit({ action: "settings.updated", entity: "app_settings", entity_id: MURAD_CONTROL_KEY, meta: { before: options.control, after: control } });
  return { ok: true };
}
