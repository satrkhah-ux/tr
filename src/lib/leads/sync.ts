import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  HEADERS,
  matchEmployee,
  normalizeInquiry,
  normalizePhone,
  parseLeadsSheet,
  sheetKey,
  sheetPerson,
  sheetStatus,
  type SheetField,
  type SheetLead,
} from "./sheet";

/**
 * «العملاء» ⇄ the conversations sheet, both ways.
 *
 *  · in: the sheet's CSV (it is shared by link), from the crontab
 *    (api/leads/pull) and on opening the page. New rows are added; on a row
 *    already here only the cells that changed since the last pull are applied
 *    (sheet_raw), so an edit made in the app is not undone by an unchanged sheet.
 *  · out: when LEADS_SHEET_WEBHOOK is set (the Apps Script in
 *    docs/leads-sheet-sync.gs, deployed by the sheet's owner), every row logged
 *    or edited here is written into the sheet — the row it came from, found by
 *    its key, or a new one at the end.
 */

export const SHEET_ID = process.env.LEADS_SHEET_ID || "1jCwYe6c661ik3Az5RAu9X9jxQgOoY_TwNqGMg2YMi6s";
// no tab id: the sheet's first tab (the conversations)
const SHEET_GID = process.env.LEADS_SHEET_GID || "";

type Person = { id: string; arabic_name: string };

export async function activeTeam(supabase: SupabaseClient): Promise<Person[]> {
  const { data } = await supabase.from("employees").select("id, arabic_name").eq("status", "Active").order("arabic_name");
  return (data ?? []) as Person[];
}

/** what a sheet cell means in our columns */
function columnsFor(field: SheetField, value: string, people: Person[]): Record<string, unknown> {
  if (field === "received_by") {
    const who = sheetPerson(value);
    return { received_by_name: who || null, received_by: matchEmployee(who, people) };
  }
  if (field === "assigned_to") {
    const who = sheetPerson(value);
    return { assigned_to_name: who || null, assigned_to: matchEmployee(who, people) };
  }
  if (field === "status") return { status: sheetStatus(value) };
  if (field === "inquiry") return { inquiry: normalizeInquiry(value) || null };
  if (field === "phone") return {};
  return { [field]: value || null };
}

// «تأخير المحادثة» is the system's own clock (0098) — the sheet only ever receives it
const FIELDS = (Object.keys(HEADERS) as SheetField[]).filter((f) => f !== "phone" && f !== "delay");

export type PullResult = { read: number; added: number; updated: number; error?: string };

/** Pull the sheet into client_leads. Idempotent: a key already here is updated, never added twice. */
export async function pullSheet(supabase: SupabaseClient): Promise<PullResult> {
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv${SHEET_GID ? `&gid=${SHEET_GID}` : ""}`, { cache: "no-store" });
  if (!res.ok) return { read: 0, added: 0, updated: 0, error: `sheet ${res.status}` };
  const rows = parseLeadsSheet(await res.text());
  if (!rows.length) return { read: 0, added: 0, updated: 0 };
  const [people, { data: existing }] = await Promise.all([
    activeTeam(supabase),
    supabase.from("client_leads").select("id, sheet_key, sheet_raw").in("sheet_key", rows.map((r) => r.key)),
  ]);
  const byKey = new Map(((existing ?? []) as { id: string; sheet_key: string; sheet_raw: Partial<SheetLead> | null }[]).map((r) => [r.sheet_key, r]));
  const fresh: Record<string, unknown>[] = [];
  let updated = 0;
  for (const row of rows) {
    const had = byKey.get(row.key);
    const changed = FIELDS.filter((f) => !had || (had.sheet_raw?.[f] ?? "") !== row[f]);
    if (had && !changed.length) continue;
    const cols = Object.assign({}, ...changed.map((f) => columnsFor(f, row[f], people)));
    if (had) {
      await supabase.from("client_leads").update({ ...cols, sheet_raw: row, updated_at: new Date().toISOString() }).eq("id", had.id);
      updated += 1;
    } else {
      // a millisecond apart in the sheet's order: a phone's second row in one pull is still «عميل سابق»
      fresh.push({ ...cols, phone: normalizePhone(row.phone), source: "sheet", sheet_key: row.key, sheet_raw: row, created_at: new Date(Date.now() + fresh.length).toISOString() });
    }
  }
  // two pulls at once (a page and the crontab, or two servers) add each key once
  const { error } = fresh.length
    ? await supabase.from("client_leads").upsert(fresh, { onConflict: "sheet_key", ignoreDuplicates: true })
    : { error: null };
  return { read: rows.length, added: error ? 0 : fresh.length, updated, ...(error ? { error: error.message } : {}) };
}

export type LeadRow = {
  id: string;
  phone: string;
  inquiry: string | null;
  destination: string | null;
  received_by: string | null;
  received_by_name: string | null;
  delay: string | null;
  sent_status: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  done_text: string | null;
  status: "open" | "closed";
  next_action: string | null;
  contact_owner: string | null;
  result: string | null;
  sheet_key: string | null;
};

/**
 * Write one row into the sheet (when the webhook is set). The cells as written
 * become the row's sheet_raw and key, so the next pull reads them as unchanged.
 * Never throws: the app's row is saved either way, and the sheet catches up on
 * the next edit.
 */
export async function pushToSheet(supabase: SupabaseClient, lead: LeadRow, people: Person[]): Promise<string | null> {
  const url = process.env.LEADS_SHEET_WEBHOOK;
  if (!url) return null;
  const nameOf = (id: string | null, fallback: string | null) => people.find((p) => p.id === id)?.arabic_name ?? fallback ?? "";
  const cells: Record<SheetField, string> = {
    // the sheet keeps the local spelling staff type («05…»)
    phone: lead.phone.startsWith("966") ? `0${lead.phone.slice(3)}` : lead.phone,
    inquiry: lead.inquiry ?? "",
    destination: lead.destination ?? "",
    received_by: nameOf(lead.received_by, lead.received_by_name),
    delay: lead.delay ?? "",
    sent_status: lead.sent_status ?? "",
    assigned_to: nameOf(lead.assigned_to, lead.assigned_to_name) || "لم يتم الاسناد",
    done_text: lead.done_text ?? "",
    status: lead.status === "closed" ? "مغلق" : "مفتوح",
    next_action: lead.next_action ?? "",
    contact_owner: lead.contact_owner ?? "",
    result: lead.result ?? "",
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({ secret: process.env.LEADS_SHEET_SECRET ?? "", key: lead.sheet_key, headers: HEADERS, cells }),
      cache: "no-store",
    });
    const out = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!res.ok || !out?.ok) return out?.error ?? `webhook ${res.status}`;
    await supabase.from("client_leads").update({ sheet_key: sheetKey(cells), sheet_raw: cells }).eq("id", lead.id);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "webhook failed";
  }
}
