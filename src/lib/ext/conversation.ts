import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { fileStatesFor } from "@/lib/data/file-status-core";
import { FOLLOWUP_SETTINGS_KEY, mayRead, parseFollowupSettings, STAGES, STEP_LABELS, WORK_COLS, type FollowupAccess, type WorkRow } from "@/lib/followups/rules";
import { HEAT_LABEL, NEXT_LABEL } from "@/lib/followups/summary-core";
import { normalizePhone } from "@/lib/leads/sheet";
import type { FileState } from "@/lib/offer/file-state";
import { ttlCache } from "@/lib/ttl-cache";
import { canSee, visaCaller } from "@/lib/visa-files/access";
import { getTeletelConfig, teletelConversationUrl } from "@/lib/providers/teletel";
import type { ExtCaller } from "./auth";

/**
 * «لوحة العميل» — what the side panel beside a Teletel conversation shows: who
 * the client is, Murad's reading and the follow-up due, this employee's own
 * reminders and note, the client's files and visa files. Each part only as the
 * system's own pages would show it to this employee: the follow-up by the
 * follow-up page's rule (rules.ts mayRead), the files to whoever issues files,
 * the visa files to the visa team. Read-only, through the service role, never a
 * buy price, never a passport, never the raw file.
 */
export type PanelFile = { id: string; serial: string | null; title: string; destination: string; state: FileState; stateLabel: string; stale: boolean; url: string };
export type PanelPayload = {
  ok: true;
  conversationId: number;
  teletelUrl: string | null;
  client: {
    leadId: string;
    name: string;
    phone: string;
    destination: string;
    inquiry: string;
    holder: string;
    open: boolean;
    returning: boolean;
    hasFile: boolean;
  } | null;
  followup: {
    stage: string;
    step: string | null;
    nextAt: string | null;
    holder: string;
    mine: boolean;
    waitingOn: "client" | "us" | null;
    wants: string;
    next: string;
    advice: string;
    heat: string;
    draft: string;
  } | null;
  reminders: { id: number; text: string; dueAt: string }[];
  note: string;
  files: PanelFile[];
  visas: { serial: string; status: string; country: string }[];
  can: { remind: boolean; files: boolean };
};

/** the Arabic of each file state, as Basic's list says it (basic/labels.ts st_*) */
const STATE_AR: Record<FileState, string> = {
  draft: "مسودة",
  issued: "صدر — لم يُرسل للعميل",
  published: "صدر",
  sent: "أُرسل للعميل",
  expired: "انتهت صلاحية العرض",
  confirmed: "مؤكّد",
  paid_partial: "مسدّد جزئياً",
  paid_full: "مسدّد بالكامل",
  ready: "جاهز للسفر",
  travelled: "سافر",
  cancelled: "ملغى",
};
const VISA_AR: Record<string, string> = {
  new: "جديد",
  collecting: "جمع المستندات",
  ready: "جاهز للتقديم",
  submitted: "مُقدَّم",
  approved: "صدرت",
  rejected: "رُفضت",
  delivered: "سُلّمت",
  cancelled: "ملغى",
};

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;

/** The Teletel account in the link is ours — another account's conversation number means someone else. */
export function sameTeletelAccount(account: string | null): boolean {
  const ours = getTeletelConfig()?.accountId ?? "1";
  return !account || account === ours;
}

/** The follow-up page's own rule (data/followups.ts access()), for a caller without a session. */
async function followupAccess(caller: ExtCaller): Promise<FollowupAccess | null> {
  const { data } = await db().from("app_settings").select("value").eq("key", FOLLOWUP_SETTINGS_KEY).maybeSingle();
  const settings = parseFollowupSettings((data as { value?: string } | null)?.value);
  const manager = caller.can("followups.manage") || caller.can("dashboard.admin") || caller.can("developer.access");
  const work = caller.can("followups.work");
  const closer = settings.closer === "employee" && settings.closerId === caller.employeeId;
  const visaOnly = !manager && settings.visaOwner === caller.employeeId;
  return manager || work || caller.can("offers.write") || closer
    ? { employeeId: caller.employeeId, manager, claim: manager || (work && !visaOnly), closer }
    : null;
}

type LeadRow = {
  id: string;
  phone: string | null;
  name: string | null;
  destination: string | null;
  inquiry: string | null;
  assigned_to_name: string | null;
  status: string | null;
  draft_id: string | null;
  created_at: string;
  last_visit_at: string | null;
};
type DraftLite = { id: string; title: string | null; serial: string | null; destination: string | null; country: string | null; created_at: string; updated_at: string };

/** A part that could not be read is the whole panel's «unavailable» — never an empty list or an empty note. */
function must<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw new Error("unavailable");
  return r.data;
}

export async function conversationPanel(caller: ExtCaller, conversationId: number): Promise<PanelPayload> {
  const seller = caller.can("offers.write");
  const lead = must(
    await db()
      .from("client_leads")
      .select("id, phone, name, destination, inquiry, assigned_to_name, status, draft_id, created_at, last_visit_at")
      .eq("teletel_conversation_id", conversationId)
      .maybeSingle(),
  ) as LeadRow | null;
  const phone = lead?.phone ? normalizePhone(lead.phone) : "";
  const visa = visaCaller(caller.permissions, caller.employeeId);

  const [phoneFiles, followup, mine, visas] = await Promise.all([
    phone ? draftsByPhone(phone) : Promise.resolve([] as DraftLite[]),
    followupFor(caller, conversationId),
    ownMarks(caller.employeeId, conversationId),
    visa ? visasFor(conversationId, visa) : Promise.resolve([]),
  ]);
  const [returning, files] = await Promise.all([lead ? returningClient(lead, phoneFiles) : Promise.resolve(false), seller ? filesFor(lead, phoneFiles) : Promise.resolve([] as PanelFile[])]);

  return {
    ok: true,
    conversationId,
    teletelUrl: teletelConversationUrl(conversationId),
    client: lead
      ? {
          leadId: lead.id,
          name: lead.name?.trim() ?? "",
          phone,
          destination: lead.destination?.trim() ?? "",
          inquiry: lead.inquiry?.trim() ?? "",
          holder: lead.assigned_to_name?.trim() ?? "",
          open: lead.status !== "closed",
          returning,
          hasFile: Boolean(lead.draft_id),
        }
      : null,
    followup,
    reminders: mine.reminders,
    note: mine.note,
    files,
    visas,
    can: { remind: seller, files: seller },
  };
}

/**
 * «عميل سابق» as «العملاء» says it (data/leads.ts — its previousContact is kept in step here; that file is
 * "use server"): seen on an earlier visit, or an earlier conversation from the number that was closed or older
 * than a day, or a Basic file for the number made before this conversation.
 */
async function returningClient(lead: LeadRow, phoneFiles: DraftLite[]): Promise<boolean> {
  if (lead.last_visit_at) return true;
  const samePhone = must(await db().from("client_leads").select("id, created_at, status").eq("phone", lead.phone).limit(200)) as { id: string; created_at: string; status: string }[];
  const at = Date.parse(lead.created_at);
  const earlier = samePhone.some((e) => e.id !== lead.id && Date.parse(e.created_at) < at && (e.status === "closed" || at - Date.parse(e.created_at) > 86_400_000));
  // the newest file for the number, as «العملاء» reads it
  const fileAt = phoneFiles[0]?.created_at ?? null;
  return earlier || Boolean(fileAt && Date.parse(fileAt) < at);
}

async function followupFor(caller: ExtCaller, conversationId: number): Promise<PanelPayload["followup"]> {
  const access = await followupAccess(caller);
  if (!access) return null;
  const rows = must(await db().from("sla_followups").select(WORK_COLS).eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(5)) as unknown as WorkRow[];
  // the open one (at most one per conversation), else the newest
  const row = rows.find((r) => r.status === "open") ?? rows[0];
  if (!row || !mayRead(row, access)) return null;
  const holder = row.assigned_to ? (must(await db().from("employees").select("arabic_name").eq("id", row.assigned_to).maybeSingle()) as { arabic_name?: string } | null) : null;
  const s = row.summary;
  return {
    stage: STAGES[row.stage] ?? "",
    step: row.step != null ? (STEP_LABELS[row.step] ?? null) : null,
    nextAt: row.status === "open" ? row.next_followup_at : null,
    holder: holder?.arabic_name?.trim() ?? "",
    mine: row.assigned_to === caller.employeeId,
    waitingOn: s?.waiting_on ?? null,
    wants: s?.wants?.trim() ?? "",
    next: s ? [NEXT_LABEL[s.next], s.advice?.trim()].filter(Boolean).join(" — ") : "",
    advice: s?.advice?.trim() ?? "",
    heat: s ? (HEAT_LABEL[s.heat] ?? "") : "",
    draft: s?.draft?.trim() ?? "",
  };
}

async function ownMarks(employeeId: string, conversationId: number): Promise<{ reminders: PanelPayload["reminders"]; note: string }> {
  const [r, m] = await Promise.all([
    db().from("my_followup_reminders").select("id, text, due_at").eq("employee_id", employeeId).eq("conversation_id", conversationId).is("done_at", null).order("due_at").limit(10),
    db().from("my_followup_marks").select("note").eq("employee_id", employeeId).eq("key", `c:${conversationId}`).maybeSingle(),
  ]);
  return {
    reminders: (must(r) as { id: number; text: string; due_at: string }[]).map((x) => ({ id: x.id, text: x.text, dueAt: x.due_at })),
    note: (must(m) as { note?: string | null } | null)?.note?.trim() ?? "",
  };
}

/**
 * The newest 2000 files, indexed by their client's number as normalizePhone reads it — «العملاء»' own way
 * (leads.ts filesByPhone), so «05…», «+966 5…» and Arabic digits are one client. Kept a minute per process.
 */
const phoneIndex = ttlCache<"index", Map<string, DraftLite[]>>(60_000);
async function draftsByPhone(phone: string): Promise<DraftLite[]> {
  let index = phoneIndex.get("index");
  if (!index) {
    const rows = must(
      await db()
        .from("offer_drafts")
        .select("id, title, created_at, updated_at, phone:data->customer->>customer_phone, serial:data->>produced_serial, destination:data->trip->>destination, country:data->trip->>country")
        .is("partner_company_id", null)
        .order("updated_at", { ascending: false })
        .limit(2000),
    ) as (DraftLite & { phone: string | null })[];
    index = new Map();
    for (const { phone: raw, ...d } of rows) {
      const p = raw ? normalizePhone(raw) : "";
      if (p) index.set(p, [...(index.get(p) ?? []), d]);
    }
    phoneIndex.set("index", index);
  }
  return index.get(phone) ?? [];
}

const FILE_COLS = "id, title, created_at, updated_at, serial:data->>produced_serial, destination:data->trip->>destination, country:data->trip->>country";

/** The client's files: the one the conversation started, and every file for their number. */
async function filesFor(lead: LeadRow | null, phoneFiles: DraftLite[]): Promise<PanelFile[]> {
  const found = new Map(phoneFiles.map((d) => [d.id, d]));
  if (lead?.draft_id && !found.has(lead.draft_id)) {
    const d = must(await db().from("offer_drafts").select(FILE_COLS).eq("id", lead.draft_id).maybeSingle()) as DraftLite | null;
    if (d) found.set(d.id, d);
  }
  const drafts = [...found.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 8);
  const versions = await issuedVersions(drafts.map((d) => d.serial).filter((x): x is string => Boolean(x)));
  const states = await fileStatesFor(drafts.map((d) => ({ id: d.id, produced_serial: d.serial, version: d.serial ? (versions.get(d.serial) ?? null) : null })));
  return drafts.map((d) => {
    const state: FileState = states[d.id]?.state ?? (d.serial ? "issued" : "draft");
    return {
      id: d.id,
      serial: d.serial,
      title: d.title?.trim() || d.serial || "ملف",
      destination: d.destination?.trim() || d.country?.trim() || "",
      state,
      stateLabel: STATE_AR[state],
      stale: states[d.id]?.stale ?? false,
      url: `/basic/${d.id}`,
    };
  });
}

/** Each serial's newest issued version (offer_renders, the client's) — Basic's list reads it the same way (drafts.ts issuedState). */
async function issuedVersions(serials: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!serials.length) return out;
  const offers = must(await db().from("offers").select("id, serial").in("serial", serials)) as { id: string; serial: string }[];
  const bySerial = new Map(offers.map((o) => [o.id, o.serial]));
  if (!bySerial.size) return out;
  const renders = must(await db().from("offer_renders").select("offer_id, version").eq("variant", "client").in("offer_id", [...bySerial.keys()])) as { offer_id: string; version: number }[];
  for (const r of renders) {
    const serial = bySerial.get(r.offer_id);
    if (serial) out.set(serial, Math.max(out.get(serial) ?? 0, r.version));
  }
  return out;
}

/** The visa files of the conversation the visa department's rule lets this employee see (visa-files/access.ts). */
async function visasFor(conversationId: number, visa: NonNullable<ReturnType<typeof visaCaller>>): Promise<PanelPayload["visas"]> {
  const rows = must(await db().from("visa_files").select("serial, status, country, assigned_to").eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(10)) as {
    serial: string;
    status: string;
    country: string;
    assigned_to: string | null;
  }[];
  return rows
    .filter((v) => canSee({ assignedTo: v.assigned_to }, visa))
    .slice(0, 5)
    .map((v) => ({ serial: v.serial, status: VISA_AR[v.status] ?? v.status, country: v.country }));
}
