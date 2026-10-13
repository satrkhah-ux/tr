"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient, createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import { currentCan } from "@/lib/roles/current";
import { CLIENT_MESSAGE_KEYS, type ClientMessageKey } from "@/lib/operations/client-messages";

/**
 * Two things a manager keeps (operations order 11): the emergency guide per
 * destination (shown on the trip link) and the wording of the client's stage
 * messages (sent only once switched on). settings.manage to change; the trip
 * page reads its guide by token through the service role.
 */

export type DestinationGuide = {
  country_id: string;
  country: string;
  local_agent_name: string | null;
  local_agent_phone: string | null;
  embassy_phone: string | null;
  ambulance: string | null;
  police: string | null;
  hospital: string | null;
  notes: string | null;
};

const FIELDS = ["local_agent_name", "local_agent_phone", "embassy_phone", "ambulance", "police", "hospital", "notes"] as const;

async function db(): Promise<SupabaseClient> {
  return (await createSupabaseServerClient()) as unknown as SupabaseClient;
}

async function canManage(): Promise<boolean> {
  return Boolean(await getServerUser()) && (await currentCan("settings.manage"));
}

/** Every active country with its guide (empty fields where none yet). */
export async function listDestinationGuides(): Promise<DestinationGuide[]> {
  if (!(await canManage())) return [];
  try {
    const supabase = await db();
    const [countries, guides] = await Promise.all([
      supabase.from("countries").select("id, arabic_name").eq("status", "Active").order("arabic_name"),
      supabase.from("destination_guides").select("*"),
    ]);
    const byCountry = new Map(((guides.data ?? []) as DestinationGuide[]).map((g) => [g.country_id, g]));
    return ((countries.data ?? []) as { id: string; arabic_name: string }[]).map((c) => {
      const g = byCountry.get(c.id);
      return {
        country_id: c.id,
        country: c.arabic_name,
        local_agent_name: g?.local_agent_name ?? null,
        local_agent_phone: g?.local_agent_phone ?? null,
        embassy_phone: g?.embassy_phone ?? null,
        ambulance: g?.ambulance ?? null,
        police: g?.police ?? null,
        hospital: g?.hospital ?? null,
        notes: g?.notes ?? null,
      };
    });
  } catch {
    return [];
  }
}

export async function saveDestinationGuide(guide: Omit<DestinationGuide, "country">): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!(await canManage())) return { ok: false, message: "لا تملك صلاحية." };
  try {
    const row: Record<string, string | null> = { country_id: guide.country_id };
    for (const f of FIELDS) row[f] = (guide[f] ?? "").trim() || null;
    const { error } = await (await db()).from("destination_guides").upsert({ ...row, updated_at: new Date().toISOString() });
    if (error) return { ok: false, message: "تعذّر الحفظ." };
    await logAudit({ action: "settings.updated", entity: "destination_guides", entity_id: guide.country_id, meta: {} });
    return { ok: true };
  } catch {
    return { ok: false, message: "تعذّر الحفظ." };
  }
}

/** The guide a traveller sees on the trip link — by the link's token, client-safe fields only. */
export async function getTripGuide(token: string): Promise<Omit<DestinationGuide, "country_id"> | null> {
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const { data: op } = await supabase.from("operations").select("client_token_revoked_at, offers(destination)").eq("client_token", token).maybeSingle();
    const row = op as unknown as { client_token_revoked_at: string | null; offers: { destination: string | null } | { destination: string | null }[] | null } | null;
    if (!row || row.client_token_revoked_at) return null;
    const destination = ((Array.isArray(row.offers) ? row.offers[0] : row.offers)?.destination ?? "").trim();
    if (!destination) return null;
    // the offer names its destination as the country (or a city in it)
    const { data: country } = await supabase.from("countries").select("id, arabic_name").eq("arabic_name", destination).maybeSingle();
    let countryRow = country as { id: string; arabic_name: string } | null;
    if (!countryRow) {
      const { data: city } = await supabase.from("cities").select("countries(id, arabic_name)").eq("arabic_name", destination).limit(1).maybeSingle();
      const c = (city as unknown as { countries: { id: string; arabic_name: string } | { id: string; arabic_name: string }[] | null } | null)?.countries;
      countryRow = (Array.isArray(c) ? c[0] : c) ?? null;
    }
    if (!countryRow) return null;
    const { data: guide } = await supabase.from("destination_guides").select("*").eq("country_id", countryRow.id).maybeSingle();
    const g = guide as DestinationGuide | null;
    if (!g) return null;
    return {
      country: countryRow.arabic_name,
      local_agent_name: g.local_agent_name,
      local_agent_phone: g.local_agent_phone,
      embassy_phone: g.embassy_phone,
      ambulance: g.ambulance,
      police: g.police,
      hospital: g.hospital,
      notes: g.notes,
    };
  } catch {
    return null;
  }
}

export type MessageTemplate = { key: ClientMessageKey; body: string; enabled: boolean };

export async function listMessageTemplates(): Promise<MessageTemplate[]> {
  if (!(await canManage())) return [];
  try {
    const { data } = await (await db()).from("client_message_templates").select("key, body, enabled");
    const rows = (data ?? []) as MessageTemplate[];
    return CLIENT_MESSAGE_KEYS.map((key) => rows.find((r) => r.key === key)).filter((r): r is MessageTemplate => Boolean(r));
  } catch {
    return [];
  }
}

export async function saveMessageTemplate(t: MessageTemplate): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!(await canManage())) return { ok: false, message: "لا تملك صلاحية." };
  if (!CLIENT_MESSAGE_KEYS.includes(t.key)) return { ok: false, message: "قالب غير معروف." };
  if (!t.body.trim()) return { ok: false, message: "نص الرسالة مطلوب." };
  try {
    const { error } = await (await db())
      .from("client_message_templates")
      .update({ body: t.body.trim(), enabled: t.enabled, updated_at: new Date().toISOString() })
      .eq("key", t.key);
    if (error) return { ok: false, message: "تعذّر الحفظ." };
    await logAudit({ action: "settings.updated", entity: "client_message_templates", entity_id: t.key, meta: { enabled: t.enabled } });
    return { ok: true };
  } catch {
    return { ok: false, message: "تعذّر الحفظ." };
  }
}
