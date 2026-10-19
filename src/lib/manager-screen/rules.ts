/**
 * «قناة المدير» — the manager's office TV (the owner, 2026-10-19, «اعمل»). It
 * runs like a news channel: everything a manager should see, good and bad —
 * red is critical, amber is watch, green is running smoothly.
 *
 * Pure and clock-injected, like eye/anomalies.ts: snapshot.ts reads the rows
 * and hands over the facts; every colour and every line is decided here, where
 * a test moves the clock instead of the data. Nothing is invented: a tile whose
 * source could not be read says so («—» and why) rather than showing a zero.
 *
 * Privacy — visitors sit in the manager's office: employees by name; a client
 * by first name only, and only on a red tile; never a phone; no money but the
 * ads spend.
 */

import { agePhrase, firstName } from "@/lib/eye/anomalies";
import { backupHealth } from "@/lib/developer/backup-health";
import { matchEmployee, riyadhDay } from "@/lib/leads/sheet";
import type { Stage } from "@/lib/leads/auto";
import type { OpsDigest } from "@/lib/telegram/ops-digest";

export type Status = "green" | "amber" | "red";
export type Tile = { key: string; label: string; value: string; status: Status; reason: string };
export type PanelKey = "conversations" | "sales" | "operations" | "team" | "ads" | "murad" | "system";
export type Panel = { key: PanelKey; title: string; status: Status; tiles: Tile[] };
export type UrgentItem = Tile & { panel: PanelKey; panelTitle: string };
export type TickerItem = { at: string; text: string; red: boolean };

export type ManagerSnapshot = {
  /** when it was computed (ISO) */
  at: string;
  /** the Riyadh day it describes */
  day: string;
  /** the worst status of everything */
  overall: Status;
  panels: Panel[];
  /** «يحتاج تدخلك الآن»: every red tile, in panel order */
  urgent: UrgentItem[];
  /** real events of the last TICKER_HOURS, newest first */
  ticker: TickerItem[];
  /** «ملخص الساعة» */
  hourly: string[];
  /** «ملخص اليوم» — the eye's own written summary, from the evening on; null before */
  daily: string[] | null;
  thresholds: ManagerThresholds;
};

/** What GET /api/manager-screen answers: the snapshot and the server's clock. */
export type ManagerScreenFeed = ManagerSnapshot & { now: number };

// ---------------------------------------------------------------- thresholds ----

export type ManagerThresholds = {
  /** a client waiting this many minutes for a reply turns amber… */
  waitAmberMin: number;
  /** …and red; the same pair colours today's average first reply and each employee's */
  waitRedMin: number;
  /** a file still not issued this many days after it was opened turns red */
  fileRedDays: number;
  /** today's ads spend ÷ today's conversations, in the account's currency: amber… */
  adsCostAmber: number;
  /** …and red */
  adsCostRed: number;
};

/**
 * The defaults until «الشاشات» edits them (app_settings `manager_screen`, JSON):
 *  · 5 / 15 minutes — Murad steps in after five minutes without a human reply
 *    (0094), and the SLA board's suggested «عميل جديد بلا رد» is red at 15; the
 *    company's median first reply in the week to 2026-10-19 was about 2 minutes;
 *  · 2 days — the eye's own UNPRICED_DAYS;
 *  · 1.5 / 3 dollars a conversation — the account ran at about $0.80 on 18–19
 *    October 2026, so amber is about double that and red about four times.
 */
export const MANAGER_DEFAULTS: ManagerThresholds = { waitAmberMin: 5, waitRedMin: 15, fileRedDays: 2, adsCostAmber: 1.5, adsCostRed: 3 };

const LIMITS: Record<keyof ManagerThresholds, { min: number; max: number; whole: boolean }> = {
  waitAmberMin: { min: 1, max: 240, whole: true },
  waitRedMin: { min: 2, max: 1440, whole: true },
  fileRedDays: { min: 1, max: 30, whole: true },
  adsCostAmber: { min: 0.1, max: 100, whole: false },
  adsCostRed: { min: 0.1, max: 500, whole: false },
};

/** The stored JSON (or nothing) → thresholds every rule can trust: clamped, red after amber. */
export function normalizeManagerThresholds(raw: unknown): ManagerThresholds {
  let given: Record<string, unknown> = {};
  try {
    const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === "object") given = parsed as Record<string, unknown>;
  } catch {
    /* unreadable → the defaults */
  }
  const out = { ...MANAGER_DEFAULTS };
  for (const key of Object.keys(LIMITS) as (keyof ManagerThresholds)[]) {
    const v = given[key];
    const n = typeof v === "number" || typeof v === "string" ? Number(v) : NaN;
    if (v === "" || !Number.isFinite(n)) continue;
    const { min, max, whole } = LIMITS[key];
    out[key] = Math.min(max, Math.max(min, whole ? Math.round(n) : n));
  }
  out.waitRedMin = Math.max(out.waitRedMin, out.waitAmberMin + 1);
  out.adsCostRed = Math.max(out.adsCostRed, out.adsCostAmber);
  return out;
}

// --------------------------------------------------------------------- facts ----

/** A conversation of «العملاء» (client_leads) that opened or came back in the window. */
export type LeadFact = {
  id: string;
  /** the client's name — only a first name ever leaves this file, and only on red */
  name: string | null;
  inquiry: string | null;
  /** the destination country, by resolvePlace (a Saudi place is an origin: null) */
  country: string | null;
  status: string;
  /** someone has it: a receiver, an assignee, a turn, or «المستقبل الآلي»'s routing */
  taken: boolean;
  created_at: string;
  last_visit_at: string | null;
  first_message_at: string | null;
  first_reply_at: string | null;
  handoffs: Stage[] | null;
};

/** One open Teletel conversation on the SLA board's clock (sla/classify.ts slaClock), «cold» left out. */
export type WaitFact = { minutes: number; since: string; agent: string | null; client: string | null };
export type EmployeeFact = { id: string; name: string; active: boolean; firstSeenAt: string | null; lastSeenAt: string | null };
export type AuditFact = { action: string; actor_id: string | null; entity_id: string | null; at: string; meta: Record<string, unknown> | null };
export type OfferFact = { id: string; serial: string; country: string | null; created_at: string };
/** a confirmation in the status history; `still`: the offer is confirmed now */
export type ConfirmFact = { offer_id: string; at: string; still: boolean; country: string | null };
export type DraftFact = { created_at: string; issued: boolean; owner: string | null };
export type AdFact = { campaign: string; dest: string; cost: number; clicks: number; conversions: number; updated_at: string };
export type MuradFact = { conversation_id: number; reason: string | null; error: string | null; replied: boolean; at: string };
export type IntegrationFact = { name: string; fail_streak: number; alerted: string | null; last_error: string | null; last_error_at: string | null; renews_on: string | null };
export type OpsFact = Pick<OpsDigest, "liveCases" | "needsAction" | "critical" | "travelIncomplete" | "unpaid" | "urgent">;

export type ManagerFacts = {
  now: number;
  day: string;
  thresholds: ManagerThresholds;
  leads: LeadFact[];
  /** null: Teletel could not be read — said, never shown as «nobody waits» */
  waits: WaitFact[] | null;
  employees: EmployeeFact[];
  audit: AuditFact[];
  /** this month's offers (and the ticker window's) */
  offers: OfferFact[];
  confirms: ConfirmFact[];
  /** the staff's unissued files, and every file opened today */
  drafts: DraftFact[];
  ads: { currency: string; rows: AdFact[]; latest: string | null };
  murad: MuradFact[];
  integrations: IntegrationFact[];
  /** app_settings pkg_backup, as stored */
  backup: string | null;
  ops: OpsFact;
};

// ------------------------------------------------------------------- helpers ----

const RANK: Record<Status, number> = { green: 0, amber: 1, red: 2 };
export const worst = (statuses: Status[]): Status => statuses.reduce<Status>((w, s) => (RANK[s] > RANK[w] ? s : w), "green");
const level = (value: number, amber: number, red: number): Status => (value >= red ? "red" : value >= amber ? "amber" : "green");
const tile = (key: string, label: string, value: string | number, status: Status, reason: string): Tile => ({ key, label, value: String(value), status, reason });

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;
/** online = a heartbeat within two minutes (data/metrics.ts ONLINE_WINDOW_MINUTES) */
const ONLINE_MS = 2 * MIN_MS;
/** a wait older than a day is the backlog the SLA board keeps, not today's delay */
const RECENT_WAIT_MIN = 1440;
export const TICKER_HOURS = 6;
const TICKER_MAX = 40;
export const INQUIRY_KINDS = ["بكج", "فنادق", "طيران", "تأشيرات", "يستفسر"] as const;

const minutesText = (m: number) => (m < 60 ? `${Math.round(m)} دقيقة` : agePhrase(m / 60));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const money = (n: number, currency: string) => (currency === "USD" ? `$${n.toFixed(2)}` : `${n.toFixed(2)} ${currency}`);
const names = (list: string[], n = 5) => list.slice(0, n).join("، ") + (list.length > n ? ` و${list.length - n} غيرهم` : "");
/** «14:05» in Riyadh (UTC+3 all year) */
const clock = (iso: string) => new Date(Date.parse(iso) + 3 * 3600_000).toISOString().slice(11, 16);
const visitedOn = (l: LeadFact, day: string) => riyadhDay(l.created_at) === day || (l.last_visit_at != null && riyadhDay(l.last_visit_at) === day);

/** The first confirmation of each offer still confirmed — counted once, on that day (data/leads.ts dayStats). */
export function firstConfirmations(rows: ConfirmFact[]): ConfirmFact[] {
  const first = new Map<string, ConfirmFact>();
  for (const r of rows) {
    if (!r.still) continue;
    const had = first.get(r.offer_id);
    if (!had || Date.parse(r.at) < Date.parse(had.at)) first.set(r.offer_id, r);
  }
  return [...first.values()];
}

// -------------------------------------------------------------------- panels ----

function conversations(f: ManagerFacts, today: LeadFact[]): Tile[] {
  const t = f.thresholds;
  const open = today.filter((l) => l.status === "open");
  const unassigned = open.filter((l) => !l.taken).length;
  const replies = today
    .filter((l) => l.first_message_at && l.first_reply_at && riyadhDay(l.first_message_at) === f.day)
    .map((l) => (Date.parse(l.first_reply_at!) - Date.parse(l.first_message_at!)) / MIN_MS)
    // a «first reply» before the message is an earlier conversation's (eye/anomalies ticketsFromLeads) — no measure
    .filter((m) => m >= 0);
  const avg = mean(replies);

  let waiting: Tile;
  if (f.waits === null) {
    waiting = tile("waiting", "بانتظار الرد", "—", "amber", "تعذّر الوصول إلى Teletel — لا تُعرض أوقات الانتظار");
  } else {
    const late = f.waits.filter((w) => w.minutes >= t.waitAmberMin && w.minutes < RECENT_WAIT_MIN).sort((a, b) => b.minutes - a.minutes);
    const top = late[0];
    const status = top ? level(top.minutes, t.waitAmberMin, t.waitRedMin) : "green";
    const client = status === "red" ? firstName(top?.client) : null;
    waiting = tile(
      "waiting",
      "بانتظار الرد",
      late.length,
      status,
      top
        ? `أطولها منذ ${minutesText(top.minutes)}${top.agent ? ` — ${top.agent}` : ""}${client ? ` · العميل ${client}` : ""}`
        : `لا أحد ينتظر أكثر من ${t.waitAmberMin} دقائق`,
    );
  }

  return [
    tile("today", "المحادثات اليوم", today.length, "green", `${open.length} مفتوحة · ${today.length - open.length} مغلقة`),
    tile("open", "مفتوحة", open.length, "green", "من محادثات اليوم"),
    tile("unassigned", "بلا موظف", unassigned, unassigned ? "amber" : "green", unassigned ? "مفتوحة ولم يستلمها أحد بعد" : "كل محادثة مفتوحة لها موظف"),
    waiting,
    avg == null
      ? tile("first_reply", "متوسط أول رد", "—", "green", "لا ردود على محادثات اليوم بعد")
      : tile("first_reply", "متوسط أول رد", minutesText(avg), level(avg, t.waitAmberMin, t.waitRedMin), `على ${replies.length} محادثة اليوم`),
    tile("closed", "مغلقة", today.length - open.length, "green", "من محادثات اليوم"),
    ...INQUIRY_KINDS.map((kind) => tile(`kind:${kind}`, kind, today.filter((l) => l.inquiry === kind).length, "green", `من ${today.length} محادثة اليوم`)),
  ];
}

function sales(f: ManagerFacts, today: LeadFact[]): Tile[] {
  const month = f.day.slice(0, 7);
  const ofDay = (iso: string) => riyadhDay(iso) === f.day;
  const ofMonth = (iso: string) => riyadhDay(iso).slice(0, 7) === month;

  const filesToday = f.drafts.filter((d) => ofDay(d.created_at));
  const issuedToday = f.offers.filter((o) => ofDay(o.created_at)).length;
  const issuedMonth = f.offers.filter((o) => ofMonth(o.created_at)).length;
  const sends = f.audit.filter((a) => a.action === "offer.client_sent" && ofDay(a.at));
  const sent = new Set(sends.map((a) => a.entity_id)).size;
  const byMurad = new Set(sends.filter((a) => a.meta?.["by"] === "murad").map((a) => a.entity_id)).size;
  const confirmed = firstConfirmations(f.confirms);
  const confToday = confirmed.filter((c) => ofDay(c.at)).length;
  const confMonth = confirmed.filter((c) => ofMonth(c.at)).length;

  const byCountry = new Map<string, number>();
  for (const l of today) if (l.country) byCountry.set(l.country, (byCountry.get(l.country) ?? 0) + 1);
  const top = [...byCountry].sort((a, b) => b[1] - a[1]).slice(0, 3);

  const late = f.drafts
    .filter((d) => !d.issued && f.now - Date.parse(d.created_at) >= f.thresholds.fileRedDays * DAY_MS)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  const oldest = late[0];

  return [
    tile("files", "ملفات اليوم", filesToday.length, "green", `صدر منها ${filesToday.filter((d) => d.issued).length}`),
    tile("issued", "صدرت اليوم", issuedToday, "green", `${issuedMonth} هذا الشهر`),
    tile("sent", "أُرسلت للعملاء اليوم", sent, "green", byMurad ? `منها ${byMurad} أرسلها مُراد` : "بزر «أرسل إلى العميل»"),
    tile("confirmed_today", "تأكدت اليوم", confToday, "green", "حجوزات أكدها العملاء اليوم"),
    tile("confirmed_month", "تأكدت هذا الشهر", confMonth, "green", `منذ ${month}-01`),
    issuedMonth
      ? tile("conversion", "نسبة التحويل", `${Math.round((confMonth / issuedMonth) * 100)}%`, "green", `${confMonth} تأكيد ÷ ${issuedMonth} عرض صدر هذا الشهر`)
      : tile("conversion", "نسبة التحويل", "—", "green", "لم يصدر عرض هذا الشهر بعد"),
    tile("top", "الأكثر طلباً اليوم", top.map(([c]) => c).join("، ") || "—", "green", top.length ? top.map(([c, n]) => `${c} ${n}`).join(" · ") : "لا وجهة محددة في محادثات اليوم"),
    tile(
      "late_files",
      "ملفات لم تصدر",
      late.length,
      late.length ? "red" : "green",
      oldest
        ? `أقدمها منذ ${Math.floor((f.now - Date.parse(oldest.created_at)) / DAY_MS)} يوم — ${oldest.owner ?? "بلا موظف"}`
        : `لا ملف مفتوح أكثر من ${f.thresholds.fileRedDays} يوم دون إصدار`,
    ),
  ];
}

/** The operations board's own colours (OperationsBoard, the owner 2026-10-18: «يحتاج اجراء لون احمر»). */
function operations(o: OpsFact): Tile[] {
  const first = o.urgent[0];
  const who = first ? [first.serial, firstName(first.customer)].filter(Boolean).join(" ") : "";
  return [
    tile("needs_action", "يحتاج إجراءً", o.needsAction, o.needsAction ? "red" : "green", o.needsAction && first ? `${who} — ${first.worst}` : "لا ملف ينتظر إجراءً"),
    tile("travel_incomplete", "السفر يقترب والحجوزات ناقصة", o.travelIncomplete, o.travelIncomplete ? "amber" : "green", "سفر خلال 7 أيام وحجوزات لم تكتمل"),
    tile("unpaid", "مؤكّد وغير مسدّد", o.unpaid, o.unpaid ? "amber" : "green", "أكّد العميل ولم يسدد كامل المبلغ"),
    tile("all_good", "ملفات بلا ملاحظات", o.liveCases - o.needsAction, "green", `من ${o.liveCases} ملف جارٍ`),
  ];
}

function team(f: ManagerFacts): Tile[] {
  const t = f.thresholds;
  const active = f.employees.filter((e) => e.active);
  const online = active.filter((e) => e.lastSeenAt && f.now - Date.parse(e.lastSeenAt) <= ONLINE_MS);
  const absent = active.filter((e) => !e.firstSeenAt);

  const actions = new Map<string, number>();
  for (const a of f.audit) if (a.actor_id && riyadhDay(a.at) === f.day) actions.set(a.actor_id, (actions.get(a.actor_id) ?? 0) + 1);

  // each agent's turns today (the Teletel history, 0099): how long they took to answer
  const roster = active.map((e) => ({ id: e.id, arabic_name: e.name }));
  const turns = new Map<string, { replies: number[]; pending: number }>();
  for (const l of f.leads) {
    for (const s of l.handoffs ?? []) {
      if (riyadhDay(s.from * 1000) !== f.day) continue;
      const id = matchEmployee(s.agent, roster);
      if (!id) continue;
      const mine = turns.get(id) ?? { replies: [], pending: 0 };
      if (s.reply) mine.replies.push(Math.max(0, s.reply - s.from) / 60);
      else if (l.status === "open" && s.handed == null) mine.pending += 1;
      turns.set(id, mine);
    }
  }

  const people = active
    .filter((e) => e.firstSeenAt || actions.has(e.id) || turns.has(e.id))
    .map((e) => {
      const n = actions.get(e.id) ?? 0;
      const turn = turns.get(e.id);
      const avg = turn ? mean(turn.replies) : null;
      const parts = [
        turn ? `${turn.replies.length + turn.pending} محادثة` : null,
        avg != null ? `متوسط الرد ${minutesText(avg)}` : null,
        turn?.pending ? `${turn.pending} بلا رد` : null,
        e.firstSeenAt ? `فتح النظام ${clock(e.firstSeenAt)}` : null,
      ].filter(Boolean);
      // coloured by the reply time only: a client waiting on them now is already red on «بانتظار الرد»
      return tile(`employee:${e.id}`, e.name, `${n} إجراء`, avg != null ? level(avg, t.waitAmberMin, t.waitRedMin) : "green", parts.join(" · ") || "—");
    });

  return [
    tile("online", "متصل الآن", online.length, "green", online.length ? names(online.map((e) => e.name)) : "لا أحد متصل الآن"),
    tile("absent", "لم يفتح النظام اليوم", absent.length, absent.length ? "amber" : "green", absent.length ? names(absent.map((e) => e.name)) : "الكل فتح النظام اليوم"),
    ...people,
  ];
}

function ads(f: ManagerFacts, conversationsToday: number): Tile[] {
  const t = f.thresholds;
  const { rows, currency } = f.ads;
  if (!rows.length) return [tile("spend", "إنفاق اليوم", "—", "amber", "لم تصل أرقام Google Ads لهذا اليوم بعد")];
  const spend = rows.reduce((n, r) => n + r.cost, 0);
  const clicks = rows.reduce((n, r) => n + r.clicks, 0);
  const conversions = Math.round(rows.reduce((n, r) => n + r.conversions, 0));
  const spending = rows.filter((r) => r.cost > 0);

  const perConversation = conversationsToday
    ? tile("cost_per_conversation", "تكلفة المحادثة", money(spend / conversationsToday, currency), level(spend / conversationsToday, t.adsCostAmber, t.adsCostRed), `${money(spend, currency)} ÷ ${conversationsToday} محادثة من كل المصادر`)
    : tile("cost_per_conversation", "تكلفة المحادثة", "—", spend ? level(spend, t.adsCostAmber, t.adsCostRed) : "green", spend ? `صُرف ${money(spend, currency)} ولا محادثة اليوم` : "لا إنفاق ولا محادثات بعد");

  // judged on Google's own conversions: every campaign has them, no guessing which conversation came from which ad
  const scored = spending.filter((r) => r.conversions >= 0.5).map((r) => ({ ...r, cpa: r.cost / r.conversions }));
  const best = [...scored].sort((a, b) => a.cpa - b.cpa)[0];
  const idle = spending.filter((r) => r.conversions < 0.5).sort((a, b) => b.cost - a.cost)[0];
  const weakest = idle ?? (scored.length > 1 ? [...scored].sort((a, b) => b.cpa - a.cpa)[0] : undefined);

  return [
    tile("spend", "إنفاق اليوم", money(spend, currency), "green", `${spending.length} حملة صرفت اليوم`),
    tile("clicks", "النقرات", clicks, "green", "من Google Ads اليوم"),
    tile("conversions", "تحويلات Google / المحادثات", `${conversions} / ${conversationsToday}`, "green", "المحادثات من كل المصادر، لا من الإعلانات وحدها"),
    perConversation,
    ...(best ? [tile("best_campaign", "أفضل حملة", best.campaign, "green", `${money(best.cpa, currency)} لكل تحويل Google`)] : []),
    ...(weakest && weakest !== best
      ? [
          idle
            ? tile("worst_campaign", "أضعف حملة", idle.campaign, "amber", `صرفت ${money(idle.cost, currency)} بلا تحويل`)
            : tile("worst_campaign", "أضعف حملة", weakest.campaign, "green", `${money(weakest.cost / weakest.conversions, currency)} لكل تحويل Google`),
        ]
      : []),
  ];
}

const VISA_DONE = new Set(["visa:answered", "visa:handoff", "visa:info", "visa:not_needed"]);
const isHandoff = (reason: string | null) => reason === "offer:handoff" || reason === "visa:handoff" || Boolean(reason?.startsWith("routed:"));
const muradFailed = (m: MuradFact) => m.reason === "send_failed" || m.error === "send_failed" || m.error === "note_failed";

/** «مُراد» today, from murad_log's own reasons (murad/reception-run.ts). */
function murad(f: ManagerFacts): Tile[] {
  const today = f.murad.filter((m) => riyadhDay(m.at) === f.day);
  const failed = today.filter(muradFailed).length;
  return [
    tile("replies", "ردود آلية", today.filter((m) => m.replied).length, "green", "رسائل أرسلها مُراد للعملاء اليوم"),
    tile("handoffs", "سلّمها لزميل", today.filter((m) => isHandoff(m.reason)).length, "green", "طلبات جهّزها وحوّلها لفريق"),
    tile("offers", "عروض أصدرها آلياً", today.filter((m) => m.reason === "offer:sent").length, "green", "عرض جاهز صدر وأُرسل دون انتظار"),
    tile("visas", "طلبات تأشيرة جهّزها", new Set(today.filter((m) => VISA_DONE.has(m.reason ?? "")).map((m) => m.conversation_id)).size, "green", "أجاب عنها أو سلّمها لقسم التأشيرات"),
    tile("failed", "تعذّر الإرسال", failed, failed ? "amber" : "green", failed ? "رسائل لم تصل إلى Teletel" : "كل ردوده وصلت"),
  ];
}

function system(f: ManagerFacts): Tile[] {
  const daysTo = (iso: string) => Math.floor((Date.parse(iso.slice(0, 10)) - Date.parse(f.day)) / DAY_MS);
  // «الربط الخارجي»'s own judgement (integration-alerts.ts): «fail» = two failed checks in a row, «expiry:N» = ends within N days
  const judged = f.integrations.map((r) => {
    const status: Status =
      r.alerted === "fail" || r.alerted === "expiry:1" || r.alerted === "expiry:7" ? "red" : r.alerted === "expiry:14" || r.fail_streak === 1 ? "amber" : "green";
    const why = r.alerted?.startsWith("expiry:")
      ? `${r.name} ينتهي خلال ${r.renews_on ? daysTo(r.renews_on) : r.alerted.slice(7)} يوم`
      : `${r.name}: ${r.last_error ?? "لا يعمل"}`;
    return { status, why };
  });
  const bad = judged.filter((j) => j.status !== "green").sort((a, b) => RANK[b.status] - RANK[a.status]);

  const b = backupHealth(f.backup, f.now);
  const backup =
    b.status === "ok"
      ? tile("backup", "النسخة الاحتياطية", b.day, "green", `${b.mb} MB · ${b.objects} ملف · قبل ${b.hours} ساعة`)
      : tile(
          "backup",
          "النسخة الاحتياطية",
          "متوقفة",
          "red",
          { never: "لم تُسجَّل نسخة بعد", failed: `فشلت آخر نسخة (قبل ${b.hours} ساعة)`, stale: `آخر نسخة قبل ${b.hours} ساعة`, small: "آخر نسخة أصغر من المعتاد" }[b.reason],
        );

  // the same limits as the «الربط الخارجي» check ads_fresh (developer/checks.ts): late after 2 hours, down after 6
  const age = f.ads.latest ? (f.now - Date.parse(f.ads.latest)) / MIN_MS : null;
  const feed =
    age == null
      ? tile("ads_feed", "بيانات الإعلانات", "—", "red", "لم تصل أرقام Google Ads قط")
      : tile("ads_feed", "بيانات الإعلانات", `قبل ${minutesText(age)}`, level(age, 120, 360), "آخر ما أرسله سكربت Google Ads");

  return [
    tile("integrations", "الربط الخارجي", `${judged.length - bad.length} من ${judged.length} سليم`, worst(bad.map((x) => x.status)), bad.length ? bad.slice(0, 2).map((x) => x.why).join(" · ") : "كل ما يرتبط به النظام يعمل"),
    backup,
    feed,
  ];
}

// ------------------------------------------------------------- ticker, hour ----

/** Real events of the last hours, newest first — each from a row, none made up. */
export function ticker(f: ManagerFacts): TickerItem[] {
  const since = f.now - TICKER_HOURS * 3600_000;
  const items: TickerItem[] = [];
  const push = (at: string | null | undefined, text: string, red = false) => {
    const ms = at ? Date.parse(at) : NaN;
    if (ms >= since && ms <= f.now + MIN_MS) items.push({ at: new Date(ms).toISOString(), text, red });
  };
  const t = f.thresholds;

  for (const l of f.leads) {
    const what = [l.inquiry, l.country].filter(Boolean).join(" · ");
    push(l.created_at, `محادثة جديدة${what ? ` — ${what}` : ""}`);
    push(l.last_visit_at, `عميل سابق عاد${what ? ` — ${what}` : ""}`);
  }
  // the moment a wait turned red
  for (const w of f.waits ?? []) {
    if (w.minutes >= t.waitRedMin && w.minutes < RECENT_WAIT_MIN) {
      push(new Date(Date.parse(w.since) + t.waitRedMin * MIN_MS).toISOString(), `محادثة بانتظار الرد منذ ${minutesText(w.minutes)}${w.agent ? ` — ${w.agent}` : ""}`, true);
    }
  }
  for (const o of f.offers) push(o.created_at, `صدر عرض ${o.country ? `${o.country} ` : ""}${o.serial}`);
  for (const a of f.audit) {
    if (a.action !== "offer.client_sent") continue;
    const serial = typeof a.meta?.["serial"] === "string" ? ` ${a.meta["serial"]}` : "";
    push(a.at, a.meta?.["by"] === "murad" ? `مُراد أرسل العرض${serial} للعميل` : `أُرسل العرض${serial} للعميل`);
  }
  for (const c of firstConfirmations(f.confirms)) push(c.at, `عميل أكد حجز${c.country ? ` ${c.country}` : ""}`);
  for (const m of f.murad) {
    if (m.reason === "offer:handoff") push(m.at, "مُراد جهّز طلب بكج وسلّمه لزميل");
    else if (m.reason === "visa:handoff") push(m.at, "مُراد جهّز طلب تأشيرة وسلّمه لزميل");
    else if (m.reason === "visa:answered") push(m.at, "مُراد أجاب عميلاً عن تأشيرة");
    else if (m.reason?.startsWith("routed:")) push(m.at, `مُراد حوّل محادثة إلى ${m.reason.slice(7)}`);
    else if (muradFailed(m)) push(m.at, "تعذّر على مُراد إرسال رد", true);
  }
  for (const r of [...f.ads.rows].filter((x) => x.cost >= 1).sort((a, b) => b.cost - a.cost).slice(0, 3)) {
    push(r.updated_at, `حملة ${r.dest === "عام" || r.dest === "تأشيرات" ? r.campaign : r.dest} صرفت ${money(r.cost, f.ads.currency)} اليوم`);
  }
  try {
    const run = JSON.parse(f.backup ?? "{}") as { at?: string; ok?: boolean };
    push(run.at, run.ok ? "تمت النسخة الاحتياطية" : "فشلت النسخة الاحتياطية", !run.ok);
  } catch {
    /* an unreadable run is the backup tile's to say */
  }
  for (const r of f.integrations) if (r.alerted === "fail") push(r.last_error_at, `${r.name} لا يعمل`, true);
  for (const e of f.employees) if (e.active) push(e.firstSeenAt, `${e.name} فتح النظام`);

  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, TICKER_MAX);
}

/** «ملخص الساعة»: what the last hour brought, then what is late now. */
export function hourly(f: ManagerFacts, urgent: UrgentItem[]): string[] {
  const since = f.now - 3600_000;
  const inHour = (iso: string | null | undefined) => Boolean(iso) && Date.parse(iso!) >= since;
  const counts: [number, string][] = [
    [f.leads.filter((l) => inHour(l.created_at) || inHour(l.last_visit_at)).length, "محادثة جديدة"],
    [f.offers.filter((o) => inHour(o.created_at)).length, "عرض صدر"],
    [new Set(f.audit.filter((a) => a.action === "offer.client_sent" && inHour(a.at)).map((a) => a.entity_id)).size, "عرض أُرسل"],
    [firstConfirmations(f.confirms).filter((c) => inHour(c.at)).length, "حجز تأكد"],
    [f.murad.filter((m) => m.replied && inHour(m.at)).length, "رد آلي من مُراد"],
  ];
  const happened = counts.filter(([n]) => n > 0).map(([n, what]) => `${n} ${what}`);
  return [
    happened.length ? `في آخر ساعة: ${happened.join("، ")}.` : "آخر ساعة هادئة: لا محادثة جديدة ولا عرض.",
    ...(urgent.length ? urgent.slice(0, 4).map((u) => `متأخر الآن — ${u.label}: ${u.value} (${u.reason})`) : ["لا شيء متأخر الآن."]),
  ];
}

// ------------------------------------------------------------------ assembly ----

export const PANEL_TITLES: Record<PanelKey, string> = {
  conversations: "المحادثات اليوم",
  sales: "المبيعات",
  operations: "العمليات",
  team: "الفريق",
  ads: "الإعلانات",
  murad: "مُراد",
  system: "النظام",
};

export function buildScreen(f: ManagerFacts): Pick<ManagerSnapshot, "overall" | "panels" | "urgent" | "ticker" | "hourly"> {
  const today = f.leads.filter((l) => visitedOn(l, f.day));
  const tiles: Record<PanelKey, Tile[]> = {
    conversations: conversations(f, today),
    sales: sales(f, today),
    operations: operations(f.ops),
    team: team(f),
    ads: ads(f, today.length),
    murad: murad(f),
    system: system(f),
  };
  const panels = (Object.keys(PANEL_TITLES) as PanelKey[]).map((key) => ({ key, title: PANEL_TITLES[key], status: worst(tiles[key].map((x) => x.status)), tiles: tiles[key] }));
  const urgent = panels.flatMap((p) => p.tiles.filter((x) => x.status === "red").map((x) => ({ ...x, panel: p.key, panelTitle: p.title })));
  return { overall: worst(panels.map((p) => p.status)), panels, urgent, ticker: ticker(f), hourly: hourly(f, urgent) };
}
