import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { ttlCache } from "@/lib/ttl-cache";
import { allRows } from "@/lib/data/all-rows";
import { buildEyeReport, riyadhParts } from "@/lib/eye/report";
import { textSummary } from "@/lib/eye/script";
import { teletelEmployees } from "@/lib/eye/anomalies";
import { buildOpsDigest } from "@/lib/telegram/ops-digest";
import { listOpenConversations, teletelGet } from "@/lib/providers/teletel";
import { slaClock } from "@/lib/sla/classify";
import { loadPlaces } from "@/lib/leads/teletel-pull";
import { campaignDestination, resolvePlace } from "@/lib/leads/places";
import { riyadhDay } from "@/lib/leads/sheet";
import { parseHours } from "@/lib/murad/reception";
import { SETTING } from "@/lib/murad/core";
import type { Place, Stage } from "@/lib/leads/auto";
import { exemptConversation } from "@/lib/leads/lateness";
import { exemptNow } from "./exempt";
import { buildScreen, dayStartMs, decisionTicker, normalizeManagerThresholds, type AgentFact, type DecisionFact, type ClosureFact, type ExternalTripFact, type ManagerFacts, type ManagerSnapshot } from "./rules";
import { presenceOnlineAgentIds } from "@/lib/routing/presence";

export type { ManagerScreenFeed, ManagerSnapshot } from "./rules";

/**
 * «قناة المدير»'s one snapshot (the owner, 2026-10-19): read in parallel with
 * the service role, judged by rules.ts, kept 60 seconds in this process — the
 * TVs poll, nobody computes from raw rows on a screen. Today only: every read
 * starts at 00:00 Riyadh («شاشة المدير لمعالجة الأمور اليوم وليس للأيام
 * السابقة»), except the confirmations' history, which only tells a first
 * confirmation from a repeated one.
 *
 * Reads only: the SLA board's own loader (getSlaBoard) moves conversations, so
 * its clock is taken from the same cached Teletel list instead
 * (listOpenConversations + slaClock), and the agents' status from GET /agents.
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

const PRESENCE = new Set(["online", "busy", "offline"]);

/**
 * The snapshot itself, unchecked — the caller holds dashboard.admin
 * (managerSnapshot below), as buildEyeReport leaves its check to its callers.
 */
export async function computeManagerSnapshot(): Promise<ManagerSnapshot> {
  const now = Date.now();
  const day = riyadhDay(now);
  const iso = (ms: number) => new Date(ms).toISOString();
  const since = iso(dayStartMs(day));
  const evening = riyadhParts(now).time >= DAY_END;
  const service = db();

  const [settings, leads, open, agentsRaw, employees, audit, offers, confirms, files, adRows, adLatest, murad, integrations, places, ops, eye, closures, trips, inSystem, exempt] =
    await Promise.all([
      service.from("app_settings").select("key, value").in("key", ["manager_screen", "pkg_backup", SETTING.receptionHours]),
      allRows<LeadRow>((a, b) => service.from("client_leads").select(LEAD_COLS).or(`created_at.gte.${since},last_visit_at.gte.${since}`).order("id").range(a, b)),
      // the SLA board's clocks, from the list the leads pull keeps warm (cached; a cold process waits ~10 s once)
      listOpenConversations(),
      // each agent's status now — Teletel keeps no history of it (8 s, the client's own limit)
      teletelGet<{ id?: number; name?: string | null; availability_status?: string | null }[]>("/agents"),
      service.from("employees").select("id, arabic_name"),
      allRows((a, b) => service.from("audit_logs").select("action, actor_id, entity_id, created_at, meta").gte("created_at", since).order("created_at").order("id").range(a, b)),
      // the staff's offers — the partners' portal is a test bed today
      service.from("offers").select("id, serial, destination, created_at").is("partner_company_id", null).gte("created_at", since),
      // forty days back, as «العملاء»'s own count: only to tell today's FIRST confirmation from a repeated one
      service.from("offer_status_history").select("offer_id, created_at, offers!inner(status, destination, partner_company_id)").eq("to_status", "confirmed").gte("created_at", iso(now - 40 * DAY_MS)),
      service.from("offer_drafts").select("created_at, serial:data->>produced_serial").is("partner_company_id", null).gte("created_at", since),
      service.from("ad_stats").select("campaign, cost, clicks, conversions, currency, updated_at").eq("day", day),
      service.from("ad_stats").select("updated_at").order("updated_at", { ascending: false }).limit(1),
      service.from("murad_log").select("conversation_id, reason, error, reply_message_id, created_at").gte("created_at", since),
      service.from("integrations").select("name, fail_streak, alerted, last_error, last_error_at, renews_on").eq("unused", false),
      loadPlaces(service),
      buildOpsDigest(5),
      // the eye's written summary of today, without client names (visitors sit in the office)
      evening ? buildEyeReport({ clientNames: false, since }) : Promise.resolve(null),
      // today's closings in Teletel and the returns (order 2's lifecycle)
      service.from("conversation_closures").select("closed_at, closed_by_kind, reopened_at, reopen_action, travel_until").or(`closed_at.gte.${since},reopened_at.gte.${since}`).limit(2000),
      // confirmed trips from outside the system leaving today or tomorrow — no phone read
      service.from("external_trips").select("travel_start, destination, status").gte("travel_start", day).lte("travel_start", new Date(Date.parse(`${day}T12:00:00Z`) + DAY_MS).toISOString().slice(0, 10)),
      // «فاتح النظام = متصل»: live sessions in our system, shown online whatever Teletel says
      presenceOnlineAgentIds(service),
      // «لا يُحسب عليهم تأخير»: the administration's exempt colleagues — and the exempt teams' (the visa department's) — carry no wait
      // and no reply time on the channel
      exemptNow(service, true),
    ]);

  const setting = new Map(rows<{ key: string; value: string | null }>(settings).map((s) => [s.key, s.value]));
  const team = rows<{ id: string; arabic_name: string | null }>(employees).map((e) => ({ id: e.id, name: e.arabic_name ?? "—" }));
  const agents: AgentFact[] | null = Array.isArray(agentsRaw)
    ? agentsRaw
        .filter((a) => a.name?.trim())
        .map((a) => {
          const status = typeof a.id === "number" && inSystem.has(a.id) ? "online" : PRESENCE.has(a.availability_status ?? "") ? a.availability_status : "offline";
          return { name: a.name!.trim(), status: status as AgentFact["status"] };
        })
    : null;
  const nowSec = Math.floor(now / 1000);
  // their names as Teletel spells them (its /agents list), beside the ones the system and the exempt teams give
  const exemptNames = [
    ...new Set([...exempt.names, ...(Array.isArray(agentsRaw) ? agentsRaw.filter((a) => typeof a.id === "number" && exempt.agentIds.has(a.id) && a.name?.trim()).map((a) => a.name!.trim()) : [])]),
  ];

  const facts: ManagerFacts = {
    now,
    day,
    thresholds: normalizeManagerThresholds(setting.get("manager_screen")),
    hours: parseHours(setting.get(SETTING.receptionHours)),
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
        .filter((c) => !exemptConversation(c, exempt))
        .map((c) => ({ c, clock: slaClock(c, nowSec) }))
        .filter(({ clock }) => clock.kind !== "cold")
        .map(({ c, clock }) => ({
          minutes: clock.minutes,
          since: iso(now - clock.minutes * 60_000),
          agent: c.assignee?.trim() || null,
          client: c.name,
          phone: c.phone || null,
          preview: c.preview || null,
        })) ?? null,
    exemptAgents: exemptNames,
    open: open?.rows.map((c) => ({ agent: c.assignee?.trim() || null, activeAt: iso((c.lastActivityAt || c.createdAt) * 1000) })) ?? null,
    agents,
    employees: team,
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
    drafts: rows<{ created_at: string; serial: string | null }>(files).map((d) => ({ created_at: d.created_at, issued: Boolean(d.serial) })),
    ads: (() => {
      const today = rows<{ campaign: string; cost: number | string; clicks: number; conversions: number | string; currency: string | null; updated_at: string }>(adRows);
      return {
        currency: today.find((r) => r.currency)?.currency ?? "USD",
        rows: today.map((r) => ({ campaign: r.campaign.replace(/\s+/g, " ").trim(), dest: campaignDestination(r.campaign, places), cost: Number(r.cost), clicks: Number(r.clicks), conversions: Number(r.conversions), updated_at: r.updated_at })),
        latest: rows<{ updated_at: string }>(adLatest)[0]?.updated_at ?? null,
      };
    })(),
    closures: rows<{ closed_at: string; closed_by_kind: ClosureFact["kind"]; reopened_at: string | null; reopen_action: ClosureFact["action"]; travel_until: string | null }>(closures).map((c) => ({
      closed_at: c.closed_at,
      kind: c.closed_by_kind,
      reopened_at: c.reopened_at,
      action: c.reopen_action,
      travel: c.travel_until != null,
    })),
    externalTrips: rows<ExternalTripFact>(trips),
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

  const built = buildScreen(facts);
  // «قرار الإدارة يحتاج تنفيذ»: each decision with who carries it out and the step (rules.ts decisionTicker)
  const decisions = await db().from("management_decisions").select("title, due_on, status, owner_id, source_key").neq("status", "done").order("due_on").limit(20);
  const decisionNews = decisionTicker((decisions.data ?? []) as DecisionFact[], new Map(team.map((e) => [e.id, e.name])), day, iso(now));
  return {
    at: iso(now),
    day,
    ...built,
    ticker: [...decisionNews, ...built.ticker],
    daily: eye ? dailyLines(eye, agents, team) : null,
    thresholds: facts.thresholds,
  };
}

/**
 * The eye's written summary for the screen: today's, with no money (the sales
 * total is not ads spend), none of the backlog's notes («بلا تسعير» is days old
 * by definition), and nobody listed as absent who works in Teletel.
 */
function dailyLines(eye: Awaited<ReturnType<typeof buildEyeReport>>, agents: AgentFact[] | null, team: { id: string; name: string }[]): string[] {
  const inTeletel = teletelEmployees(agents?.map((a) => a.name) ?? [], team.map((e) => ({ id: e.id, arabic_name: e.name })));
  const teletelNames = new Set(team.filter((e) => inTeletel.has(e.id)).map((e) => e.name));
  const today = {
    ...eye,
    attendance: { ...eye.attendance, absent: eye.attendance.absent.filter((n) => !teletelNames.has(n)) },
    sales: { ...eye.sales, totalToday: null },
    notes: eye.notes.filter((n) => n.code !== "offer_unpriced"),
  };
  // Telegram's HTML marks off — the screen draws its own
  return textSummary(today).replace(/<[^>]+>/g, "").split("\n");
}

const screens = ttlCache<"screen", ManagerSnapshot>(60_000, 1);
// two TVs asking at once share one computation
let computing: Promise<ManagerSnapshot> | null = null;

/** The screen for a dashboard.admin session; null for anyone else. Computed at most once a minute. */
export async function managerSnapshot(): Promise<ManagerSnapshot | null> {
  if (!(await currentCan("dashboard.admin")) && !(await currentCan("developer.access"))) return null;
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
