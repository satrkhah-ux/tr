"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { currentCan } from "@/lib/roles/current";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { listTeletelTeams, teletelGet } from "@/lib/providers/teletel";
import { logAudit } from "./audit";
import { getCurrentEmployeeId } from "./metrics";
import { instruct } from "@/lib/murad/instruct";
import { readKnowledge, type Knowledge } from "@/lib/murad/knowledge";
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

// ---------- «تعليمات الإدارة لمُراد» and what he learned (lib/murad/instruct.ts, lessons.ts) ----------

export type InstructionRow = { id: string; source: "page" | "whatsapp"; text: string; kind: string; status: string; reply: string | null; created_at: string };
export type LessonRow = { id: string; source: "teaching" | "conversation"; question: string | null; answer: string; active: boolean; created_at: string };

export async function muradTeaching(): Promise<{ instructions: InstructionRow[]; lessons: LessonRow[]; learned: number; read: number; left: number; knowledge: Knowledge } | null> {
  if (!(await allowed())) return null;
  const [i, l, c] = await Promise.all([
    db().from("murad_instructions").select("id, source, text, kind, status, reply, created_at").order("created_at", { ascending: false }).limit(30),
    db().from("murad_lessons").select("id, source, question, answer, active, created_at").eq("source", "teaching").order("created_at", { ascending: false }).limit(100),
    db().from("murad_lessons").select("id", { count: "exact", head: true }).eq("source", "conversation"),
  ]);
  const { data: s } = await db().from("app_settings").select("value").eq("key", "murad_learn").maybeSingle();
  const state = (() => { try { return JSON.parse((s as { value?: string } | null)?.value ?? "{}") as { read?: number; next?: number }; } catch { return {}; } })();
  return { instructions: (i.data ?? []) as InstructionRow[], lessons: (l.data ?? []) as LessonRow[], learned: c.count ?? 0, read: state.read ?? 0, left: Math.max(0, state.next ?? 0), knowledge: await readKnowledge(db()) };
}

/** The manager's order from the page — read, applied and answered as from a management number. */
export async function instructMurad(text: string): Promise<{ ok: boolean; reply: string }> {
  if (!(await allowed())) return { ok: false, reply: "لا صلاحية" };
  if (typeof text !== "string" || !text.trim() || text.length > 2000) return { ok: false, reply: "اكتب التعليمات أولاً." };
  const r = await instruct(db(), { text, source: "page", authorId: await getCurrentEmployeeId() });
  return r ? { ok: r.ok, reply: r.reply } : { ok: false, reply: "تعذّر التنفيذ." };
}

export async function setLessonActive(id: string, active: boolean): Promise<{ ok: boolean }> {
  if (!(await allowed()) || typeof id !== "string" || typeof active !== "boolean") return { ok: false };
  const { error } = await db().from("murad_lessons").update({ active }).eq("id", id);
  if (!error) await logAudit({ action: "settings.updated", entity: "murad_lessons", entity_id: id, meta: { active } });
  return { ok: !error };
}
