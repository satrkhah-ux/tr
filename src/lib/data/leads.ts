"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { getCurrentEmployeeId } from "./metrics";
import { createDraft } from "./drafts";
import { matchEmployee, normalizePhone, parseLeadsSheet, sheetStatus, type SheetField, type SheetLead } from "@/lib/leads/sheet";

/**
 * «العملاء» — every client conversation, open to every employee (the owner,
 * 2026-10-17, phase one). The company's sheet is pulled in on its own: opening
 * the page pulls it when the last pull is over a minute old. Phase two (no
 * sheet, the conversations straight from WhatsApp) replaces the pull, not this.
 */

const SHEET_ID = process.env.LEADS_SHEET_ID || "1jCwYe6c661ik3Az5RAu9X9jxQgOoY_TwNqGMg2YMi6s";
// no tab id: the sheet's first tab (the conversations)
const SHEET_GID = process.env.LEADS_SHEET_GID || "";
const PULL_EVERY_MS = 60_000;
// ponytail: one server process, so one in-memory clock; a shared row if the app ever runs twice
let lastPull = 0;

export type Lead = {
  id: string;
  phone: string;
  name: string | null;
  inquiry: string | null;
  destination: string | null;
  received_by: string | null;
  received_by_name: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  sent_status: string | null;
  done_text: string | null;
  status: "open" | "closed";
  next_action: string | null;
  result: string | null;
  draft_id: string | null;
  source: "manual" | "sheet";
  created_at: string;
  /** the Basic file made for this client: by the link, else by the phone */
  file: { id: string; destination: string | null; name: string | null; created_at: string | null } | null;
  /** «عميل سابق»: the same phone wrote before (an earlier conversation, or a file made before this one) */
  returning: boolean;
};

export type LeadsPage = { leads: Lead[]; team: { id: string; arabic_name: string }[]; meId: string | null; pulledAt: number; pullError: string | null };

const COLS =
  "id, phone, name, inquiry, destination, received_by, received_by_name, assigned_to, assigned_to_name, sent_status, done_text, status, next_action, result, draft_id, source, created_at";

async function db(): Promise<SupabaseClient> {
  return (await createSupabaseServerClient()) as unknown as SupabaseClient;
}

async function team(supabase: SupabaseClient) {
  const { data } = await supabase.from("employees").select("id, arabic_name").eq("status", "Active").order("arabic_name");
  return (data ?? []) as { id: string; arabic_name: string }[];
}

/** what a sheet cell means in our columns */
function columnsFor(field: SheetField, value: string, people: { id: string; arabic_name: string }[]): Record<string, unknown> {
  const v = value || null;
  if (field === "received_by") return { received_by_name: v, received_by: matchEmployee(value, people) };
  if (field === "assigned_to") return { assigned_to_name: v, assigned_to: matchEmployee(value, people) };
  if (field === "status") return { status: sheetStatus(value) };
  if (field === "phone") return {};
  return { [field]: v };
}

const FIELDS: SheetField[] = ["inquiry", "destination", "received_by", "sent_status", "assigned_to", "done_text", "status", "next_action", "result"];

/** Pull the sheet: new rows in, and only the cells that changed since the last pull over what is here. */
async function pull(supabase: SupabaseClient): Promise<string | null> {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv${SHEET_GID ? `&gid=${SHEET_GID}` : ""}`, { cache: "no-store" });
  if (!res.ok) return `sheet ${res.status}`;
  const rows = parseLeadsSheet(await res.text());
  if (!rows.length) return null;
  const [people, { data: existing }] = await Promise.all([
    team(supabase),
    supabase.from("client_leads").select("id, sheet_key, sheet_raw").in("sheet_key", rows.map((r) => r.key)),
  ]);
  const byKey = new Map(((existing ?? []) as { id: string; sheet_key: string; sheet_raw: Partial<SheetLead> | null }[]).map((r) => [r.sheet_key, r]));
  const fresh: Record<string, unknown>[] = [];
  for (const row of rows) {
    const had = byKey.get(row.key);
    const changed = FIELDS.filter((f) => !had || (had.sheet_raw?.[f] ?? "") !== row[f]);
    if (had && !changed.length) continue;
    const cols = Object.assign({}, ...changed.map((f) => columnsFor(f, row[f], people)));
    if (had) {
      await supabase.from("client_leads").update({ ...cols, sheet_raw: row, updated_at: new Date().toISOString() }).eq("id", had.id);
    } else {
      // a millisecond apart in the sheet's order: a phone's second row in one pull is still «عميل سابق»
      fresh.push({ ...cols, phone: row.phone, source: "sheet", sheet_key: row.key, sheet_raw: row, created_at: new Date(Date.now() + fresh.length).toISOString() });
    }
  }
  if (fresh.length) {
    const { error } = await supabase.from("client_leads").insert(fresh);
    if (error) return error.message;
  }
  return null;
}

/** The Basic files of these phones (newest first): the client's name and the programme's destination. */
async function filesByPhone(phones: Set<string>): Promise<Map<string, Lead["file"]>> {
  // service role, three fields only: a colleague's file may not be readable to
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
  if (!meId) return { leads: [], team: [], meId: null, pulledAt: lastPull, pullError: null };
  let pullError: string | null = null;
  if (Date.now() - lastPull > PULL_EVERY_MS) {
    lastPull = Date.now();
    pullError = await pull(supabase).catch((e: unknown) => (e instanceof Error ? e.message : "pull failed"));
  }
  const [{ data }, people] = await Promise.all([
    supabase.from("client_leads").select(COLS).order("created_at", { ascending: false }).limit(1000),
    team(supabase),
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
  return { leads, team: people, meId, pulledAt: lastPull, pullError };
}

/** a pull now, whatever the clock says («تحديث من الشيت») */
export async function pullLeadsNow(): Promise<{ ok: boolean; error?: string }> {
  if (!(await getCurrentEmployeeId())) return { ok: false, error: "err.session" };
  lastPull = Date.now();
  const error = await pull(await db()).catch((e: unknown) => (e instanceof Error ? e.message : "pull failed"));
  return error ? { ok: false, error } : { ok: true };
}

export async function addLead(input: { phone: string; name?: string; inquiry?: string; destination?: string }): Promise<{ ok: boolean; error?: string }> {
  const meId = await getCurrentEmployeeId();
  if (!meId) return { ok: false, error: "err.session" };
  const phone = normalizePhone(input.phone);
  if (phone.length < 7) return { ok: false, error: "phone" };
  const { error } = await (await db()).from("client_leads").insert({
    phone,
    name: input.name?.trim() || null,
    inquiry: input.inquiry?.trim() || null,
    destination: input.destination?.trim() || null,
    // the one who logs it is the one who received it
    received_by: meId,
    created_by: meId,
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

const EDITABLE = ["name", "inquiry", "destination", "assigned_to", "sent_status", "done_text", "status", "next_action", "result"] as const;
export type LeadPatch = Partial<Record<(typeof EDITABLE)[number], string | null>>;

export async function updateLead(id: string, patch: LeadPatch): Promise<{ ok: boolean; error?: string }> {
  if (!(await getCurrentEmployeeId())) return { ok: false, error: "err.session" };
  const clean: Record<string, unknown> = {};
  for (const k of EDITABLE) if (k in patch) clean[k] = patch[k] === "" ? null : patch[k];
  if (clean.status !== undefined && clean.status !== "open" && clean.status !== "closed") return { ok: false, error: "status" };
  // handing it over here: the sheet's handwritten name no longer applies
  if ("assigned_to" in clean) clean.assigned_to_name = null;
  const { error } = await (await db()).from("client_leads").update({ ...clean, updated_at: new Date().toISOString() }).eq("id", id);
  return error ? { ok: false, error: error.message } : { ok: true };
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
  return { ok: true, draftId: made.id };
}
