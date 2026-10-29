import { fold, normalizePhone } from "./sheet";

/** Pure rules of the conversation's life in Teletel — the doing is lifecycle.ts. */

export type ClosedBy = "employee" | "system" | "murad";
export type TeletelAgent = { id: number; name: string; email: string | null };

// Teletel's own activity line, Arabic and English
const CLOSED = /^تم تحديث حالة المحادثة لـ\s*"?مغلقة"?\s*بواسطة\s+(.+)$|^Conversation was marked resolved by\s+(.+)$/u;

/**
 * Who resolved it: the latest «…"مغلقة" بواسطة X» at or before `before`,
 * matched to a Teletel agent by name or email. Null when no person closed it
 * (Teletel's own auto-resolve, or no line read).
 */
export function closerOf(events: readonly { kind: string; at: number; text: string }[], before: number, agents: readonly TeletelAgent[]): { name: string; agentId: number | null; at: number } | null {
  const line = events
    .filter((e) => e.kind === "activity" && e.at <= before)
    .map((e) => ({ e, m: e.text.replace(/\s+/g, " ").trim().match(CLOSED) }))
    .filter((x) => x.m)
    .sort((a, b) => b.e.at - a.e.at)[0];
  if (!line?.m) return null;
  const name = (line.m[1] ?? line.m[2]).trim();
  const agent = agents.find((a) => fold(a.name) === fold(name) || (a.email && a.email.toLowerCase() === name.toLowerCase()));
  return { name: agent?.name.trim() ?? name, agentId: agent?.id ?? null, at: line.e.at };
}

export type ReturnDecision = { act: "assign"; agentId: number } | { act: "keep" } | { act: "unassign" };

/**
 * «@#@#@#» in a private note: the employee followed this conversation up (the owner, 2026-10-29) — no reminder
 * about it from Murad or the system for what came before the note. A newer client message is news again.
 */
export const FOLLOWED_TOKEN = "@#@#@#";
export const marksFollowed = (text: string | null | undefined): boolean => Boolean(text?.includes(FOLLOWED_TOKEN));
/** followed at or after the thing a reminder is about (a client's waiting, an offer, a due day) */
export function followedSince(followedAt: string | null | undefined, anchorMs: number): boolean {
  const t = followedAt ? Date.parse(followedAt) : NaN;
  return Number.isFinite(t) && Number.isFinite(anchorMs) && t >= anchorMs;
}

/** who bought from us: the mobiles of every confirmed or completed trip, and Teletel's «won» classification stages */
export type SaleFacts = { phones: ReadonlySet<string>; wonStages: ReadonlySet<number> };

/**
 * The owner's rule (2026-10-29, conversation 39733: «مؤكد — مسافر قريباً» closed it seven times in four days
 * while the seller was working the trip with the client): a conversation an employee holds, once the client
 * bought — a confirmed or completed trip, or Teletel's own «خدمة مكتملة» — is never closed, unassigned or
 * taken by Murad or the system.
 */
export function heldSale(c: { assigneeId: number | null; phone: string | null; stageId?: number | null }, sold: SaleFacts): boolean {
  if (!c.assigneeId) return false;
  if (c.stageId != null && sold.wonStages.has(c.stageId)) return true;
  const k = phoneKey(c.phone);
  return k !== null && sold.phones.has(k);
}

/**
 * The client wrote again: the employee who closed it gets it back (already
 * theirs: nothing to do); the system's closing comes back unassigned — Teletel's
 * intake takes it as a new request.
 */
export function decideReturn(closure: { closed_by_kind: ClosedBy; closed_by_agent_id: number | null }, assigneeId: number | null): ReturnDecision {
  if (closure.closed_by_kind !== "employee") return { act: "unassign" };
  if (!closure.closed_by_agent_id || closure.closed_by_agent_id === assigneeId) return { act: "keep" };
  return { act: "assign", agentId: closure.closed_by_agent_id };
}

/** «إدارة المحادثات»: how long without a reply before the system closes one (app_settings), null = off */
export const AUTOCLOSE_SETTING = "conversation_autoclose_hours";
export const readAutocloseHours = (raw: string | null | undefined): number | null => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 24 * 90 ? Math.round(n) : null;
};

/** The system closes only what nobody is waiting on: idle `hours` and WE spoke last — the oldest first. */
export function staleToClose<T extends { lastActivityAt: number; waitingSince: number }>(rows: readonly T[], nowSec: number, hours: number): T[] {
  if (!(hours > 0)) return [];
  return rows.filter((c) => c.waitingSince === 0 && c.lastActivityAt > 0 && c.lastActivityAt <= nowSec - hours * 3600).sort((a, b) => a.lastActivityAt - b.lastActivityAt);
}

// ---------- «مؤكد — مسافر قريباً» (the user, 2026-10-22: linked by the mobile; no file, the normal rules) ----------

export const TRAVELLERS_SETTING = "conversation_travellers_close";
export const TRAVEL_LABEL = "مسافر-قريبا";
/** operations.client_status of a confirmed trip — not awaiting the client, not done, not cancelled */
export const CONFIRMED_TRIP = ["confirmed", "paid_partial", "paid_full"];

/** the last 9 digits: one Saudi mobile however written (+9665…, 05…, 9665…) */
export function phoneKey(raw: string | null | undefined): string | null {
  const d = normalizePhone(raw ?? "");
  return d.length >= 9 ? d.slice(-9) : null;
}

/**
 * A trip the client is confirmed on, and whose it is: an operations file (its
 * operations employee, else the seller), or a trip entered by hand in
 * «المؤكدون خارج النظام» (whoever entered it).
 */
export type TravelFile = { source: "operation" | "external"; id: string; serial: string | null; destination: string | null; travelStart: string | null; travelEnd: string; phones: string[]; ownerName: string | null; ownerAgentId: number | null };

/** until when a return goes to the file's owner: the return date + 3 days */
export function travelUntil(travelEnd: string): string {
  const d = new Date(`${travelEnd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 3);
  return d.toISOString().slice(0, 10);
}

/** a traveller's conversation closes only once nobody is mid-exchange: we spoke last an hour ago */
const TRAVEL_IDLE_SEC = 3600;

/** Open conversations of confirmed travellers, matched by the mobile — the latest trip when a client has two. */
export function travellersToClose<T extends { phone: string; lastActivityAt: number; waitingSince: number }>(rows: readonly T[], files: readonly TravelFile[], nowSec: number, today: string): { c: T; file: TravelFile }[] {
  const byPhone = new Map<string, TravelFile>();
  for (const f of [...files].sort((a, b) => b.travelEnd.localeCompare(a.travelEnd))) {
    if (today > travelUntil(f.travelEnd)) continue;
    for (const p of f.phones) {
      const k = phoneKey(p);
      if (k && !byPhone.has(k)) byPhone.set(k, f);
    }
  }
  return rows.flatMap((c) => {
    const file = byPhone.get(phoneKey(c.phone) ?? "");
    return file && c.waitingSince === 0 && c.lastActivityAt > 0 && nowSec - c.lastActivityAt >= TRAVEL_IDLE_SEC ? [{ c, file }] : [];
  });
}

/** A traveller wrote: until the return + 3 days, the file's owner (already theirs: nothing to do); after, null — the normal rules. */
export function travellerReturn(until: string | null, today: string, ownerAgentId: number | null, assigneeId: number | null): ReturnDecision | null {
  if (!until || today > until) return null;
  return ownerAgentId && ownerAgentId !== assigneeId ? { act: "assign", agentId: ownerAgentId } : { act: "keep" };
}

// ---------- «المؤكدون خارج النظام» (the user, 2026-10-22): a confirmed client from before the system, by hand ----------

export const EXTERNAL_STATUS = { confirmed: "مؤكد", paid_partial: "مدفوع جزئياً", paid_full: "مدفوع بالكامل", cancelled: "ملغي" } as const;
export type ExternalStatus = keyof typeof EXTERNAL_STATUS;
export const CONFIRMED_ITEMS = ["طيران", "فندق", "مواصلات", "جولات", "تأشيرة", "تأمين"] as const;

export type ExternalTripInput = { phone: string; travelStart: string; days: number; destination: string; status: string; paidAmount: number | null; confirmed: string[] };
export type ExternalTrip = { phone: string; travel_start: string; days: number; destination: string; status: ExternalStatus; paid_amount: number | null; confirmed_items: string[] };

/** The form as typed → a row, or what to fix (in the words the form shows). */
export function readExternalTrip(i: ExternalTripInput): { ok: true; row: ExternalTrip } | { ok: false; error: string } {
  const phone = normalizePhone(i.phone);
  if (phone.length < 9) return { ok: false, error: "رقم الجوال غير صحيح" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.travelStart) || Number.isNaN(Date.parse(i.travelStart))) return { ok: false, error: "تاريخ السفر مطلوب" };
  if (!Number.isInteger(i.days) || i.days < 1 || i.days > 365) return { ok: false, error: "عدد الأيام بين 1 و365" };
  const destination = i.destination.trim().slice(0, 80);
  if (!destination) return { ok: false, error: "الوجهة مطلوبة" };
  if (!(i.status in EXTERNAL_STATUS)) return { ok: false, error: "اختر الحالة" };
  if (i.paidAmount !== null && !(Number.isFinite(i.paidAmount) && i.paidAmount >= 0 && i.paidAmount < 10_000_000)) return { ok: false, error: "المبلغ المدفوع غير صحيح" };
  const confirmed = CONFIRMED_ITEMS.filter((x) => i.confirmed.includes(x));
  return { ok: true, row: { phone, travel_start: i.travelStart, days: i.days, destination, status: i.status as ExternalStatus, paid_amount: i.paidAmount, confirmed_items: confirmed } };
}

/** the return date of a hand-entered trip: the start + its days */
export function externalTripEnd(travelStart: string, days: number): string {
  const d = new Date(`${travelStart}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------- its client, from what we already have (the owner, 2026-10-29: «رقم الجوال لا يتم سحبه من النظام!») ----------

/**
 * What is typed in «العميل»: a number's digits to find it by — 00 / 966 / 0 in front dropped, since our tables keep a
 * mobile as it was written — else a name (safe inside a PostgREST or-filter). Null while too short to ask.
 */
export function clientQuery(raw: string): { digits: string } | { name: string } | null {
  const t = raw.trim();
  if (/\p{L}/u.test(t)) {
    const name = t.replace(/[%*,()"\\]/g, " ").trim().slice(0, 60);
    return name.length >= 2 ? { name } : null;
  }
  const digits = normalizePhone(t).replace(/^(?:966|0+)/, "");
  return digits.length >= 3 ? { digits } : null;
}

/** the ways one normalised mobile is written in our tables (9665…، 05…، +9665…) — to find it with `in` */
export function phoneForms(raw: string): string[] {
  const p = normalizePhone(raw);
  if (p.length < 9) return [];
  return p.startsWith("966") ? [p, `0${p.slice(3)}`, `+${p}`] : [p, `+${p}`];
}

export type ClientSource = "lead" | "file" | "offer" | "operation";
/** the client as one of our tables has them: a Teletel conversation, a Basic file, an offer, an operations file */
export type ClientRecord = { phone: string | null; name: string | null; destination: string | null; travelStart: string | null; days: number | null; at: string | null; mine: boolean; source: ClientSource };
/** one client to pick: one mobile, the best name, and the trip to pre-fill (null: nothing recent) */
export type TripClient = { phone: string; name: string | null; mine: boolean; sources: ClientSource[]; trip: { destination: string; travelStart: string | null; days: number | null } | null };

/** a lead or an offer older than this pre-fills nothing */
const RECENT_DAYS = 120;

/**
 * Every record of the same mobile (phoneKey) is one client: the name our files hold before a WhatsApp profile name
 * (the newest of each), the trip of the newest recent record that names a destination — its own dates, never another's.
 * The employee's own clients first, then the newest.
 */
export function mergeClients(records: readonly ClientRecord[], today: string, limit = 8): TripClient[] {
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - RECENT_DAYS * 86_400_000).toISOString().slice(0, 10);
  const by = new Map<string, TripClient & { at: string; leadName: boolean }>();
  for (const r of [...records].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""))) {
    const k = phoneKey(r.phone);
    if (!k) continue;
    const c = by.get(k) ?? { phone: normalizePhone(r.phone ?? ""), name: null, mine: false, sources: [], trip: null, at: r.at ?? "", leadName: false };
    by.set(k, c);
    const name = r.name?.trim();
    if (name && (!c.name || (c.leadName && r.source !== "lead"))) {
      c.name = name;
      c.leadName = r.source === "lead";
    }
    c.mine ||= r.mine;
    if (!c.sources.includes(r.source)) c.sources.push(r.source);
    const destination = r.destination?.trim();
    if (!c.trip && destination && (r.at ?? "") >= since) c.trip = { destination, travelStart: r.travelStart || null, days: r.days && r.days > 0 ? Math.round(r.days) : null };
  }
  return [...by.values()]
    .sort((a, b) => Number(b.mine) - Number(a.mine) || b.at.localeCompare(a.at))
    .slice(0, limit)
    .map((c) => ({ phone: c.phone, name: c.name, mine: c.mine, sources: c.sources, trip: c.trip }));
}

/** What the same mobile already has: a trip entered here (not the one being edited), a confirmed operations file. */
export function sameClientTrips(
  phone: string,
  trips: readonly { id: string; phone: string; destination: string; travel_start: string }[],
  files: readonly { serial: string | null; destination: string | null; phones: readonly (string | null)[] }[],
  exceptId?: string,
): string[] {
  const k = phoneKey(phone);
  if (!k) return [];
  return [
    ...trips.filter((t) => t.id !== exceptId && phoneKey(t.phone) === k).map((t) => `له رحلة مسجّلة هنا: ${t.destination} — ${t.travel_start}`),
    ...files.filter((f) => f.phones.some((p) => phoneKey(p) === k)).map((f) => `له ملف مؤكد في العمليات: ${f.serial ?? "—"}${f.destination ? ` — ${f.destination}` : ""}`),
  ];
}

/** «3 أيام»، «36 ساعة» */
export function durationText(hours: number): string {
  if (hours % 24) return hours === 1 ? "ساعة" : hours === 2 ? "ساعتين" : `${hours} ${hours <= 10 ? "ساعات" : "ساعة"}`;
  const d = hours / 24;
  return d === 1 ? "يوم" : d === 2 ? "يومين" : `${d} ${d <= 10 ? "أيام" : "يوماً"}`;
}
