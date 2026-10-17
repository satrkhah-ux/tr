"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { getCurrentEmployeeId } from "./metrics";
import { createDraft } from "./drafts";
import { normalizeInquiry, normalizePhone } from "@/lib/leads/sheet";
import { activeTeam, pullSheet, pushToSheet, type LeadRow } from "@/lib/leads/sync";

/**
 * «العملاء» — every client conversation, open to every employee (the owner,
 * 2026-10-17, phase one). The sheet comes in on its own (the crontab on
 * api/leads/pull every two minutes, and on opening the page when the last pull is over a
 * minute old); what is logged or edited here goes back out (sync.ts).
 */

const PULL_EVERY_MS = 60_000;
// ponytail: one server process, so one in-memory clock; a shared row if the app ever runs twice
let lastPull = 0;

export type Lead = Omit<LeadRow, "sheet_key"> & {
  name: string | null;
  draft_id: string | null;
  source: "manual" | "sheet";
  created_at: string;
  /** the Basic file made for this client: by the link, else by the phone */
  file: { id: string; destination: string | null; name: string | null; created_at: string | null } | null;
  /** «عميل سابق»: the same phone wrote before (an earlier conversation, or a file made before this one) */
  returning: boolean;
};

export type LeadsPage = { leads: Lead[]; team: { id: string; arabic_name: string }[]; meId: string | null; pullError: string | null; twoWay: boolean };

const COLS =
  "id, phone, name, inquiry, destination, received_by, received_by_name, delay, sent_status, assigned_to, assigned_to_name, done_text, status, next_action, contact_owner, result, draft_id, source, created_at";
const ROW_COLS =
  "id, phone, inquiry, destination, received_by, received_by_name, delay, sent_status, assigned_to, assigned_to_name, done_text, status, next_action, contact_owner, result, sheet_key";

async function db(): Promise<SupabaseClient> {
  return (await createSupabaseServerClient()) as unknown as SupabaseClient;
}

async function pullOnce(supabase: SupabaseClient): Promise<string | null> {
  lastPull = Date.now();
  return pullSheet(supabase)
    .then((r) => r.error ?? null)
    .catch((e: unknown) => (e instanceof Error ? e.message : "pull failed"));
}

/** The Basic files of these phones (newest first): the client's name and the programme's destination. */
async function filesByPhone(phones: Set<string>): Promise<Map<string, Lead["file"]>> {
  // service role, a few fields only: a colleague's file may not be readable to
  // this session, but which country it is for is what classifies the client
  const service = createSupabaseServiceClient() as unknown as SupabaseClient;
  const { data } = await service
    .from("offer_drafts")
    .select("id, created_at, phone:data->customer->>customer_phone, name:data->customer->>customer_name, country:data->trip->>country, destination:data->trip->>destination")
    .order("updated_at", { ascending: false })
    .limit(2000);
  const out = new Map<string, Lead["file"]>();
  for (const d of (data ?? []) as { id: string; created_at: string; phone: string | null; name: string | null; country: string | null; destination: string | null }[]) {
    const p = d.phone ? normalizePhone(d.phone) : "";
    if (!p || !phones.has(p) || out.has(p)) continue;
    out.set(p, { id: d.id, destination: d.destination || d.country || null, name: d.name || null, created_at: d.created_at });
  }
  return out;
}

export async function listLeads(): Promise<LeadsPage> {
  const supabase = await db();
  const meId = await getCurrentEmployeeId();
  const twoWay = Boolean(process.env.LEADS_SHEET_WEBHOOK);
  if (!meId) return { leads: [], team: [], meId: null, pullError: null, twoWay };
  const pullError = Date.now() - lastPull > PULL_EVERY_MS ? await pullOnce(supabase) : null;
  const [{ data }, people] = await Promise.all([
    supabase.from("client_leads").select(COLS).order("created_at", { ascending: false }).limit(3000),
    activeTeam(supabase),
  ]);
  const rows = (data ?? []) as Omit<Lead, "file" | "returning">[];
  const files = await filesByPhone(new Set(rows.map((r) => r.phone)));
  // the first time each phone wrote (rows come newest first, so the last seen is the first)
  const firstSeen = new Map<string, string>();
  for (const r of rows) firstSeen.set(r.phone, r.created_at);
  const leads = rows.map((r): Lead => {
    const byPhone = files.get(r.phone) ?? null;
    const file = r.draft_id
      ? { id: r.draft_id, destination: byPhone?.id === r.draft_id ? byPhone.destination : null, name: null, created_at: null }
      : byPhone;
    const returning = firstSeen.get(r.phone)! < r.created_at || Boolean(byPhone?.created_at && byPhone.created_at < r.created_at);
    return { ...r, name: r.name || byPhone?.name || null, file, returning };
  });
  return { leads, team: people, meId, pullError, twoWay };
}

/** a pull now, whatever the clock says («تحديث من الشيت») */
export async function pullLeadsNow(): Promise<{ ok: boolean; error?: string }> {
  if (!(await getCurrentEmployeeId())) return { ok: false, error: "err.session" };
  const error = await pullOnce(await db());
  return error ? { ok: false, error } : { ok: true };
}

/** after a save here: the row into the sheet too */
async function push(supabase: SupabaseClient, id: string): Promise<string | null> {
  if (!process.env.LEADS_SHEET_WEBHOOK) return null;
  const [{ data }, people] = await Promise.all([supabase.from("client_leads").select(ROW_COLS).eq("id", id).maybeSingle(), activeTeam(supabase)]);
  return data ? pushToSheet(supabase, data as LeadRow, people) : null;
}

export async function addLead(input: { phone: string; name?: string; inquiry?: string; destination?: string }): Promise<{ ok: boolean; error?: string }> {
  const meId = await getCurrentEmployeeId();
  if (!meId) return { ok: false, error: "err.session" };
  const phone = normalizePhone(input.phone);
  if (phone.length < 7) return { ok: false, error: "phone" };
  const supabase = await db();
  const { data, error } = await supabase
    .from("client_leads")
    .insert({
      phone,
      name: input.name?.trim() || null,
      inquiry: normalizeInquiry(input.inquiry ?? "") || null,
      destination: input.destination?.trim() || null,
      // the one who logs it is the one who received it
      received_by: meId,
      created_by: meId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  const sheetError = await push(supabase, (data as { id: string }).id);
  return sheetError ? { ok: true, error: `sheet: ${sheetError}` } : { ok: true };
}

const EDITABLE = ["name", "inquiry", "destination", "delay", "assigned_to", "sent_status", "done_text", "status", "next_action", "contact_owner", "result"] as const;
export type LeadPatch = Partial<Record<(typeof EDITABLE)[number], string | null>>;

export async function updateLead(id: string, patch: LeadPatch): Promise<{ ok: boolean; error?: string }> {
  if (!(await getCurrentEmployeeId())) return { ok: false, error: "err.session" };
  const clean: Record<string, unknown> = {};
  for (const k of EDITABLE) if (k in patch) clean[k] = patch[k] === "" ? null : patch[k];
  if (clean.status !== undefined && clean.status !== "open" && clean.status !== "closed") return { ok: false, error: "status" };
  if (typeof clean.inquiry === "string") clean.inquiry = normalizeInquiry(clean.inquiry) || null;
  // handing it over here: the sheet's handwritten name no longer applies
  if ("assigned_to" in clean) clean.assigned_to_name = null;
  const supabase = await db();
  const { error } = await supabase.from("client_leads").update({ ...clean, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  const sheetError = await push(supabase, id);
  return sheetError ? { ok: true, error: `sheet: ${sheetError}` } : { ok: true };
}

/** «ابدأ برنامج»: a Basic file with the client's name and phone, tied to the conversation, which becomes mine if nobody has it. */
export async function startProgramme(id: string): Promise<{ ok: boolean; draftId?: string; error?: string }> {
  const meId = await getCurrentEmployeeId();
  if (!meId) return { ok: false, error: "err.session" };
  const supabase = await db();
  const { data: lead } = await supabase.from("client_leads").select("phone, name, assigned_to, draft_id").eq("id", id).maybeSingle();
  if (!lead) return { ok: false, error: "missing" };
  const row = lead as { phone: string; name: string | null; assigned_to: string | null; draft_id: string | null };
  if (row.draft_id) return { ok: true, draftId: row.draft_id };
  const made = await createDraft({ customer: { customer_name: row.name ?? "", customer_phone: row.phone, company: "", partner_company_id: null } });
  if (!made.ok) return { ok: false, error: made.error };
  await supabase.from("client_leads").update({ draft_id: made.id, assigned_to: row.assigned_to ?? meId, updated_at: new Date().toISOString() }).eq("id", id);
  await push(supabase, id);
  return { ok: true, draftId: made.id };
}
