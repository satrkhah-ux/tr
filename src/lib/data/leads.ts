"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { getCurrentEmployeeId } from "./metrics";
import { createDraft } from "./drafts";
import { normalizeInquiry, normalizePhone } from "@/lib/leads/sheet";
import { activeTeam, pullSheet, pushToSheet, type LeadRow } from "@/lib/leads/sync";
import { loadPlaces, pullTeletel } from "@/lib/leads/teletel-pull";
import { adsData, type AdsData } from "./ads";
import type { Place, Stage } from "@/lib/leads/auto";
import { currentCan } from "@/lib/roles/current";
import { conversationForPhone, conversationThread, getTeletelConfig, type ThreadMessage } from "@/lib/providers/teletel";

/**
 * «العملاء» — every client conversation, open to every employee (the owner,
 * 2026-10-17). Phase two: the conversations come from Teletel (teletel-pull.ts),
 * nobody types them; without Teletel, phase one's sheet. Either comes in on its own (the crontab on
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
  /**
   * «عميل سابق» (the owner, 2026-10-18): the same phone wrote before and that
   * conversation was closed or is over 24 hours older — a client writing again
   * inside an open day is the same conversation — or a file was made for them before.
   */
  returning: boolean;
  /** when they were last in touch before this conversation */
  returning_since: string | null;
  teletel_conversation_id: number | null;
  /** the times the timing columns are computed from (0098) — never typed */
  first_message_at: string | null;
  first_reply_at: string | null;
  assigned_at: string | null;
  assignee_reply_at: string | null;
  /** every agent's turn with it, in order — the first is «الموظف المستلم» (0099) */
  handoffs: Stage[] | null;
  /** the client came back to this conversation (0104) — counted a request on that day too */
  last_visit_at: string | null;
  /** «المستقبل الآلي» handed it to this team, at this time (0103) */
  auto_route: string | null;
  auto_routed_at: string | null;
  /** seconds from the client's first message of that burst to the reception's answer (0105) */
  auto_wait_sec: number | null;
};

/** The administration's day (the owner's list, 2026-10-18): bookings confirmed and the follow-up queue. */
export type LeadsStats = {
  /** confirmations by Riyadh day — offers still confirmed, issued from the system */
  bookings: { today: number; yesterday: number; week: number; month: number };
  /** their value in riyals — pricing.internal only, else null */
  value: { today: number; month: number } | null;
  /** «المتابعة» (sla_followups) still open */
  followups: number;
};

export type LeadsPage = {
  stats: LeadsStats;
  leads: Lead[];
  team: { id: string; arabic_name: string }[];
  meId: string | null;
  pullError: string | null;
  twoWay: boolean;
  /** phase two: the conversations come from Teletel, nobody types them */
  live: boolean;
  /** the catalogue's countries and cities — what a destination is (lib/leads/places.ts), and the «الدولة» suggestions */
  places: Place[];
  /** «رؤية للإعلانات»: the Google Ads side, for dashboard.admin only (data/ads.ts) */
  ads: AdsData | null;
};

const COLS =
  "id, phone, name, inquiry, destination, received_by, received_by_name, delay, sent_status, assigned_to, assigned_to_name, done_text, status, next_action, contact_owner, result, draft_id, source, created_at, teletel_conversation_id, first_message_at, first_reply_at, assigned_at, assignee_reply_at, handoffs, auto_route, auto_routed_at, auto_wait_sec, last_visit_at";
const ROW_COLS =
  "id, phone, inquiry, destination, received_by, received_by_name, delay, sent_status, assigned_to, assigned_to_name, done_text, status, next_action, contact_owner, result, sheet_key";

async function db(): Promise<SupabaseClient> {
  return (await createSupabaseServerClient()) as unknown as SupabaseClient;
}

/** phase two once Teletel is configured: its conversations; the sheet only without it */
async function pullOnce(supabase: SupabaseClient): Promise<string | null> {
  lastPull = Date.now();
  if (getTeletelConfig()) {
    return pullTeletel(supabase)
      .then((r) => (r.error === "teletel" ? "تعذّر الوصول إلى Teletel" : (r.error ?? null)))
      .catch((e: unknown) => (e instanceof Error ? e.message : "pull failed"));
  }
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
  const live = Boolean(getTeletelConfig());
  if (!meId) return { stats: EMPTY_STATS, leads: [], team: [], meId: null, pullError: null, twoWay, live, places: [], ads: null };
  // the sheet is quick enough to read on opening; Teletel is the crontab's (ten seconds for its 26 pages)
  const pullError = !live && Date.now() - lastPull > PULL_EVERY_MS ? await pullOnce(supabase) : null;
  const [{ data }, people, stats, places, ads] = await Promise.all([
    supabase.from("client_leads").select(COLS).order("created_at", { ascending: false }).limit(3000),
    activeTeam(supabase),
    dayStats(),
    loadPlaces(createSupabaseServiceClient() as unknown as SupabaseClient).catch((): Place[] => []),
    adsData(),
  ]);
  const rows = (data ?? []) as Omit<Lead, "file" | "returning" | "returning_since">[];
  const files = await filesByPhone(new Set(rows.map((r) => r.phone)));
  const byPhoneRows = new Map<string, typeof rows>();
  for (const r of rows) byPhoneRows.set(r.phone, [...(byPhoneRows.get(r.phone) ?? []), r]);
  const leads = rows.map((r): Lead => {
    const byPhone = files.get(r.phone) ?? null;
    const file = r.draft_id
      ? { id: r.draft_id, destination: byPhone?.id === r.draft_id ? byPhone.destination : null, name: null, created_at: null }
      : byPhone;
    // a conversation the client came back to: its own first visit is the earlier contact (0104)
    const since = r.last_visit_at ? r.created_at : previousContact(r, byPhoneRows.get(r.phone) ?? [], byPhone?.created_at ?? null);
    return { ...r, name: r.name || byPhone?.name || null, file, returning: since !== null, returning_since: since };
  });
  return { stats, leads, team: people, meId, pullError, twoWay, live, places, ads };
}

const EMPTY_STATS: LeadsStats = { bookings: { today: 0, yesterday: 0, week: 0, month: 0 }, value: null, followups: 0 };

/** a Riyadh day, «YYYY-MM-DD» */
const riyadh = (iso: string | Date) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });

/**
 * The bookings confirmed today, yesterday, this week (from Sunday) and this
 * month — counted from the status history, an offer counted once on the day it
 * was confirmed and only while it still is — and the follow-up queue. Counts
 * through the service role (a total, never a row); the value only for
 * pricing.internal.
 */
async function dayStats(): Promise<LeadsStats> {
  try {
    const service = createSupabaseServiceClient() as unknown as SupabaseClient;
    const since = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const [{ data: history }, { count: followups }, seesValue] = await Promise.all([
      service.from("offer_status_history").select("offer_id, created_at, offers!inner(status, total, total_sar, currency)").eq("to_status", "confirmed").gte("created_at", since),
      service.from("sla_followups").select("id", { count: "exact", head: true }).eq("status", "open"),
      currentCan("pricing.internal"),
    ]);
    type Row = { offer_id: string; created_at: string; offers: { status: string; total: number | string | null; total_sar: number | string | null; currency: string | null } | null };
    // the first confirmation of each offer still confirmed
    const firstOf = new Map<string, Row>();
    for (const r of (history ?? []) as unknown as Row[]) {
      if (r.offers?.status !== "confirmed") continue;
      const had = firstOf.get(r.offer_id);
      if (!had || had.created_at > r.created_at) firstOf.set(r.offer_id, r);
    }
    const today = riyadh(new Date());
    const yesterday = riyadh(new Date(Date.now() - 86_400_000));
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday, the Saudi week's first day
    const weekStart = riyadh(new Date(Date.parse(`${today}T12:00:00Z`) - dow * 86_400_000));
    const monthStart = `${today.slice(0, 7)}-01`;
    const rows = [...firstOf.values()].map((r) => ({ day: riyadh(r.created_at), sar: Number(r.offers?.total_sar ?? (r.offers?.currency === "SAR" || !r.offers?.currency ? r.offers?.total : 0)) || 0 }));
    const sum = (xs: typeof rows) => Math.round(xs.reduce((n, x) => n + x.sar, 0));
    const ofToday = rows.filter((r) => r.day === today);
    const ofMonth = rows.filter((r) => r.day >= monthStart);
    return {
      bookings: { today: ofToday.length, yesterday: rows.filter((r) => r.day === yesterday).length, week: rows.filter((r) => r.day >= weekStart).length, month: ofMonth.length },
      value: seesValue ? { today: sum(ofToday), month: sum(ofMonth) } : null,
      followups: followups ?? 0,
    };
  } catch {
    return EMPTY_STATS;
  }
}

const DAY_MS = 24 * 3600_000;

/**
 * When the client was last in touch before conversation `r` — an earlier
 * conversation of the same phone that was closed or is more than a day older,
 * else a Basic file made for them before it — or null: a first-time client.
 */
function previousContact(r: { id: string; created_at: string }, samePhone: { id: string; created_at: string; status: string }[], fileAt: string | null): string | null {
  const at = Date.parse(r.created_at);
  const earlier = samePhone
    .filter((e) => e.id !== r.id && Date.parse(e.created_at) < at && (e.status === "closed" || at - Date.parse(e.created_at) > DAY_MS))
    .map((e) => e.created_at);
  if (fileAt && Date.parse(fileAt) < at) earlier.push(fileAt);
  return earlier.length ? earlier.reduce((a, b) => (Date.parse(a) > Date.parse(b) ? a : b)) : null;
}

export type LeadThread = { ok: true; messages: ThreadMessage[]; link: string | null } | { ok: false; error: string };

/** What the client wrote: their Teletel conversation (its last five pages), by its id, else found by the phone. */
export async function leadThread(id: string): Promise<LeadThread> {
  if (!(await getCurrentEmployeeId())) return { ok: false, error: "انتهت الجلسة — أعد تسجيل الدخول" };
  const config = getTeletelConfig();
  if (!config) return { ok: false, error: "Teletel غير مربوط" };
  const { data } = await (await db()).from("client_leads").select("phone, teletel_conversation_id").eq("id", id).maybeSingle();
  const row = data as { phone: string; teletel_conversation_id: number | null } | null;
  if (!row) return { ok: false, error: "المحادثة غير موجودة" };
  const conversation = Number(row.teletel_conversation_id) || (await conversationForPhone(row.phone));
  if (!conversation) return { ok: false, error: "لا توجد محادثة لهذا الرقم في Teletel" };
  const thread = await conversationThread(conversation, 5);
  if (!thread) return { ok: false, error: "تعذّر الوصول إلى Teletel" };
  return { ok: true, messages: thread.messages, link: `${config.baseUrl}/app/accounts/${config.accountId}/conversations/${conversation}` };
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

// «تأخير المحادثة» is not here: the system computes it (0098), nobody types it
const EDITABLE = ["name", "inquiry", "destination", "assigned_to", "sent_status", "done_text", "status", "next_action", "contact_owner", "result"] as const;
export type LeadPatch = Partial<Record<(typeof EDITABLE)[number], string | null>>;

export async function updateLead(id: string, patch: LeadPatch): Promise<{ ok: boolean; error?: string }> {
  if (!(await getCurrentEmployeeId())) return { ok: false, error: "err.session" };
  const clean: Record<string, unknown> = {};
  for (const k of EDITABLE) if (k in patch) clean[k] = patch[k] === "" ? null : patch[k];
  if (clean.status !== undefined && clean.status !== "open" && clean.status !== "closed") return { ok: false, error: "status" };
  if (typeof clean.inquiry === "string") clean.inquiry = normalizeInquiry(clean.inquiry) || null;
  // handing it over here: the sheet's handwritten name no longer applies, and the hand-over's clock starts now
  if ("assigned_to" in clean) {
    clean.assigned_to_name = null;
    clean.assigned_at = clean.assigned_to ? new Date().toISOString() : null;
    clean.assignee_reply_at = null;
  }
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
