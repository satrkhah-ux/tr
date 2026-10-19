import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { ttlCache } from "@/lib/ttl-cache";
import { allRows } from "@/lib/data/all-rows";
import { buildEyeReport, riyadhParts } from "@/lib/eye/report";
import { textSummary } from "@/lib/eye/script";
import { buildOpsDigest } from "@/lib/telegram/ops-digest";
import { listOpenConversations } from "@/lib/providers/teletel";
import { slaClock } from "@/lib/sla/classify";
import { loadPlaces } from "@/lib/leads/teletel-pull";
import { campaignDestination, resolvePlace } from "@/lib/leads/places";
import { riyadhDay } from "@/lib/leads/sheet";
import type { Place, Stage } from "@/lib/leads/auto";
import { buildScreen, normalizeManagerThresholds, TICKER_HOURS, type ManagerFacts, type ManagerSnapshot } from "./rules";

export type { ManagerScreenFeed, ManagerSnapshot } from "./rules";

/**
 * «قناة المدير»'s one snapshot (the owner, 2026-10-19): read in parallel with
 * the service role, judged by rules.ts, kept 60 seconds in this process — the
 * TVs poll, nobody computes from raw rows on a screen. Reads only: the SLA
 * board's own loader (getSlaBoard) moves conversations, so its clock is taken
 * from the same cached Teletel list instead (listOpenConversations + slaClock).
 */

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
const DAY_MS = 86_400_000;
/** «ملخص اليوم» from the evening on: the hour the eye's own briefing goes out (api/eye/daily, 0 20 * * *) */
const DAY_END = "20:00";

const LEAD_COLS =
  "id, name, inquiry, destination, status, assigned_to, received_by, received_by_name, auto_route, created_at, last_visit_at, first_message_at, first_reply_at, handoffs";

type LeadRow = {
  id: string;
  name: string | null;
  inquiry: string | null;
  destination: string | null;
  status: string;
  assigned_to: string | null;
  received_by: string | null;
  received_by_name: string | null;
  auto_route: string | null;
  created_at: string;
  last_visit_at: string | null;
  first_message_at: string | null;
  first_reply_at: string | null;
  handoffs: Stage[] | null;
};

/** A plain read's rows — a failed read fails the snapshot rather than showing a zero that is not true. */
function rows<T>(res: { data: unknown; error: { message: string } | null }): T[] {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as T[];
}

const countryOf = (text: string | null, places: Place[]) => {
  const r = resolvePlace(text, places);
  return r.kind === "destination" ? r.country : null;
};

/**
 * The snapshot itself, unchecked — the caller holds dashboard.admin
 * (managerSnapshot below), as buildEyeReport leaves its check to its callers.
 */
export async function computeManagerSnapshot(): Promise<ManagerSnapshot> {
  const now = Date.now();
  const day = riyadhDay(now);
  const iso = (ms: number) => new Date(ms).toISOString();
  const dayStart = Date.parse(`${day}T00:00:00+03:00`);
  const since = iso(Math.min(dayStart, now - TICKER_HOURS * 3600_000));
  const monthStart = iso(Math.min(Date.parse(`${day.slice(0, 7)}-01T00:00:00+03:00`), Date.parse(since)));
  const evening = riyadhParts(now).time >= DAY_END;
  const service = db();

  const [settings, leads, open, employees, attendance, presence, audit, offers, confirms, unissued, filesToday, adRows, adLatest, murad, integrations, places, ops, eye] =
    await Promise.all([
      service.from("app_settings").select("key, value").in("key", ["manager_screen", "pkg_backup"]),
      allRows<LeadRow>((a, b) => service.from("client_leads").select(LEAD_COLS).or(`created_at.gte.${since},last_visit_at.gte.${since}`).order("id").range(a, b)),
      // the SLA board's clocks, from the list the leads pull keeps warm (cached; a cold process waits ~10 s once)
      listOpenConversations(),
      service.from("employees").select("id, arabic_name, status"),
      service.from("attendance_days").select("employee_id, first_seen_at").eq("day", day),
      service.from("presence").select("employee_id, last_seen_at"),
      allRows((a, b) => service.from("audit_logs").select("action, actor_id, entity_id, created_at, meta").gte("created_at", since).order("created_at").order("id").range(a, b)),
      // the staff's offers — the partners' portal is a test bed today
      service.from("offers").select("id, serial, destination, created_at").is("partner_company_id", null).gte("created_at", monthStart),
      // forty days back, as «العملاء»'s own count: an offer first confirmed last month is not this month's
      service.from("offer_status_history").select("offer_id, created_at, offers!inner(status, destination, partner_company_id)").eq("to_status", "confirmed").gte("created_at", iso(now - 40 * DAY_MS)),
      service.from("offer_drafts").select("created_at, created_by").is("partner_company_id", null).is("data->>produced_serial", null),
      service.from("offer_drafts").select("created_at, serial:data->>produced_serial").is("partner_company_id", null).gte("created_at", iso(dayStart)),
      service.from("ad_stats").select("campaign, cost, clicks, conversions, currency, updated_at").eq("day", day),
      service.from("ad_stats").select("updated_at").order("updated_at", { ascending: false }).limit(1),
      service.from("murad_log").select("conversation_id, reason, error, reply_message_id, created_at").gte("created_at", since),
      service.from("integrations").select("name, fail_streak, alerted, last_error, last_error_at, renews_on").eq("unused", false),
      loadPlaces(service),
      buildOpsDigest(5),
      // the eye's written summary, without client names (visitors sit in the office)
      evening ? buildEyeReport({ clientNames: false }) : Promise.resolve(null),
    ]);

  const setting = new Map(rows<{ key: string; value: string | null }>(settings).map((s) => [s.key, s.value]));
  const team = rows<{ id: string; arabic_name: string | null; status: string | null }>(employees);
  const nameOf = new Map(team.map((e) => [e.id, e.arabic_name ?? "—"]));
  const arrived = new Map(rows<{ employee_id: string; first_seen_at: string }>(attendance).map((a) => [a.employee_id, a.first_seen_at]));
  const seen = new Map(rows<{ employee_id: string; last_seen_at: string }>(presence).map((p) => [p.employee_id, p.last_seen_at]));
  const nowSec = Math.floor(now / 1000);

  const facts: ManagerFacts = {
    now,
    day,
    thresholds: normalizeManagerThresholds(setting.get("manager_screen")),
    leads: leads.data.map((l) => ({
      id: l.id,
      name: l.name,
      inquiry: l.inquiry,
      country: countryOf(l.destination, places),
      status: l.status,
      taken: Boolean(l.assigned_to || l.received_by || l.received_by_name || l.auto_route || l.handoffs?.length),
      created_at: l.created_at,
      last_visit_at: l.last_visit_at,
      first_message_at: l.first_message_at,
      first_reply_at: l.first_reply_at,
      handoffs: l.handoffs,
    })),
    waits:
      open?.rows
        .map((c) => ({ c, clock: slaClock(c, nowSec) }))
        .filter(({ clock }) => clock.kind !== "cold")
        .map(({ c, clock }) => ({ minutes: clock.minutes, since: iso(now - clock.minutes * 60_000), agent: c.assignee, client: c.name })) ?? null,
    employees: team.map((e) => ({
      id: e.id,
      name: e.arabic_name ?? "—",
      active: (e.status ?? "Active") === "Active",
      firstSeenAt: arrived.get(e.id) ?? null,
      lastSeenAt: seen.get(e.id) ?? null,
    })),
    audit: (audit.data as { action: string; actor_id: string | null; entity_id: string | null; created_at: string; meta: Record<string, unknown> | null }[]).map((a) => ({
      action: a.action,
      actor_id: a.actor_id,
      entity_id: a.entity_id,
      at: a.created_at,
      meta: a.meta,
    })),
    offers: rows<{ id: string; serial: string; destination: string | null; created_at: string }>(offers).map((o) => ({
      id: o.id,
      serial: o.serial,
      country: countryOf(o.destination, places),
      created_at: o.created_at,
    })),
    confirms: rows<{ offer_id: string; created_at: string; offers: { status: string; destination: string | null; partner_company_id: string | null } | null }>(confirms)
      .filter((c) => !c.offers?.partner_company_id)
      .map((c) => ({ offer_id: c.offer_id, at: c.created_at, still: c.offers?.status === "confirmed", country: countryOf(c.offers?.destination ?? null, places) })),
    drafts: [
      ...rows<{ created_at: string; created_by: string | null }>(unissued).map((d) => ({ created_at: d.created_at, issued: false, owner: d.created_by ? (nameOf.get(d.created_by) ?? null) : null })),
      // today's issued ones; today's unissued are already above
      ...rows<{ created_at: string; serial: string | null }>(filesToday).filter((d) => d.serial).map((d) => ({ created_at: d.created_at, issued: true, owner: null })),
    ],
    ads: (() => {
      const today = rows<{ campaign: string; cost: number | string; clicks: number; conversions: number | string; currency: string | null; updated_at: string }>(adRows);
      return {
        currency: today.find((r) => r.currency)?.currency ?? "USD",
        rows: today.map((r) => ({ campaign: r.campaign.replace(/\s+/g, " ").trim(), dest: campaignDestination(r.campaign, places), cost: Number(r.cost), clicks: Number(r.clicks), conversions: Number(r.conversions), updated_at: r.updated_at })),
        latest: rows<{ updated_at: string }>(adLatest)[0]?.updated_at ?? null,
      };
    })(),
    murad: rows<{ conversation_id: number; reason: string | null; error: string | null; reply_message_id: number | null; created_at: string }>(murad).map((m) => ({
      conversation_id: m.conversation_id,
      reason: m.reason,
      error: m.error,
      replied: m.reply_message_id != null,
      at: m.created_at,
    })),
    integrations: rows(integrations),
    backup: setting.get("pkg_backup") ?? null,
    ops,
  };

  return {
    at: iso(now),
    day,
    ...buildScreen(facts),
    // Telegram's HTML marks off — the screen draws its own
    daily: eye ? textSummary({ ...eye, sales: { ...eye.sales, totalToday: null } }).replace(/<[^>]+>/g, "").split("\n") : null,
    thresholds: facts.thresholds,
  };
}

const screens = ttlCache<"screen", ManagerSnapshot>(60_000, 1);
// two TVs asking at once share one computation
let computing: Promise<ManagerSnapshot> | null = null;

/** The screen for a dashboard.admin session; null for anyone else. Computed at most once a minute. */
export async function managerSnapshot(): Promise<ManagerSnapshot | null> {
  if (!(await currentCan("dashboard.admin"))) return null;
  const hit = screens.get("screen");
  if (hit) return hit;
  computing ??= computeManagerSnapshot()
    .then((s) => {
      screens.set("screen", s);
      return s;
    })
    .finally(() => {
      computing = null;
    });
  return computing;
}
