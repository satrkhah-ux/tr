/**
 * «قناة المدير» — the manager's office TV (the owner, 2026-10-19, «اعمل»). It
 * runs like a news channel: everything a manager should see, good and bad.
 *
 * Two of the owner's rules shape every line here (2026-10-19):
 *  · «شاشة المدير لمعالجة الأمور اليوم وليس للأيام السابقة» — every number
 *    counts today since 00:00 Riyadh, and red or amber is only what needs
 *    handling today: today's conversations or one waiting for us right now, an
 *    operations step due today or tomorrow, a check down now. The backlog
 *    (files idle for days, last week's slow replies) stays in «عين الإدارة».
 *  · red only for the critical — a client waiting past the red threshold, a
 *    file with a critical flag due now, a system check down; everything else
 *    that needs watching is amber. `redOnlyCritical: false` (a setting) brings
 *    back the stricter colours.
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

import { agePhrase, arCount, firstName } from "@/lib/eye/anomalies";
import { backupHealth } from "@/lib/developer/backup-health";
import { fold, riyadhDay } from "@/lib/leads/sheet";
import { isWorkingTime, type Hours } from "@/lib/murad/reception";
import type { Stage } from "@/lib/leads/auto";
import type { OperationSignal } from "@/lib/operations/signals";
import type { DigestLive } from "@/lib/telegram/ops-digest";

export type Status = "green" | "amber" | "red";
export type Presence = "online" | "busy" | "offline";
export type Tile = {
  key: string;
  label: string;
  value: string;
  status: Status;
  reason: string;
  /** a Teletel agent's status — the screen's dot: green online, amber busy, grey offline */
  presence?: Presence;
};
export type PanelKey = "conversations" | "sales" | "operations" | "team" | "ads" | "murad" | "system";

/** One of a panel's four headline cards (the owner's design order for /m, 2026-10-20). */
export type Kpi = {
  /** the tile it shows */
  key: string;
  label: string;
  /** the big number, and its small unit beside it */
  num: string;
  unit?: string;
  status: Status;
  /** the line at the card's foot */
  sub: string;
  /** a target: `value` against `target` (first reply against 5 minutes) */
  ring?: { value: number; target: number };
  /** two parts of one whole (open / closed) */
  split?: { a: number; b: number; aLabel: string; bLabel: string };
};
/** A line of a content box: a bar (`share` of the longest, 0–1) or a row (`detail` beside the value). */
export type BoxItem = { label: string; value: string; share?: number; detail?: string; status?: Status; presence?: Presence };
export type Box = { title: string; note: string; kind: "bars" | "rows"; items: BoxItem[]; /** said instead of an empty box */ empty: string };

/**
 * `tiles` are every judgement the panel makes (the urgent and watch lists come
 * from them); `kpis` (four) and `boxes` (two) are how the screen shows it.
 */
export type Panel = { key: PanelKey; title: string; short: string; status: Status; tiles: Tile[]; kpis: Kpi[]; boxes: Box[] };
export type UrgentItem = Tile & { panel: PanelKey; panelTitle: string; /** what to do about it — the screen's gold «← …» */ action: string };
export type TickerItem = { at: string; text: string; red: boolean };

export type ManagerSnapshot = {
  /** when it was computed (ISO) */
  at: string;
  /** the Riyadh day it describes — every figure counts from its 00:00 */
  day: string;
  /** the worst status of everything */
  overall: Status;
  panels: Panel[];
  /** «يحتاج تدخلك الآن»: every red tile, in panel order */
  urgent: UrgentItem[];
  /** «تحت المتابعة»: every amber tile, in panel order */
  watch: UrgentItem[];
  /** today's real events of the last TICKER_HOURS, newest first */
  ticker: TickerItem[];
  /** «ملخص الساعة»: the last hour of today */
  hourly: string[];
  /** «ملخص اليوم» — the eye's own written summary of today, from the evening on; null before */
  daily: string[] | null;
  thresholds: ManagerThresholds;
};

/** What GET /api/manager-screen answers: the snapshot and the server's clock. */
export type ManagerScreenFeed = ManagerSnapshot & { now: number };

// ---------------------------------------------------------------- thresholds ----

export type ManagerThresholds = {
  /** a client waiting this many minutes for a reply turns amber… */
  waitAmberMin: number;
  /** …and red; the same pair judges today's average first reply and each agent's */
  waitRedMin: number;
  /** today's ads spend ÷ today's conversations, in the account's currency: amber… */
  adsCostAmber: number;
  /** …and red, when red is not kept for the critical */
  adsCostRed: number;
  /** red only for a client waiting past red, a critical file due now, a check down (the owner's default) */
  redOnlyCritical: boolean;
};

/**
 * The defaults until «الشاشات» edits them (app_settings `manager_screen`, JSON):
 *  · 5 / 15 minutes — Murad steps in after five minutes without a human reply
 *    (0094), and the SLA board's suggested «عميل جديد بلا رد» is red at 15; the
 *    company's median first reply in the week to 2026-10-19 was about 2 minutes;
 *  · 1.5 / 3 dollars a conversation — the account ran at about $0.70 on 18–19
 *    October 2026, so amber is about double that and red about four times;
 *  · red only for the critical — the owner's choice, 2026-10-19.
 */
export const MANAGER_DEFAULTS: ManagerThresholds = { waitAmberMin: 5, waitRedMin: 15, adsCostAmber: 1.5, adsCostRed: 3, redOnlyCritical: true };

const LIMITS: Record<Exclude<keyof ManagerThresholds, "redOnlyCritical">, { min: number; max: number; whole: boolean }> = {
  waitAmberMin: { min: 1, max: 240, whole: true },
  waitRedMin: { min: 2, max: 1440, whole: true },
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
  for (const key of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    const v = given[key];
    const n = typeof v === "number" || typeof v === "string" ? Number(v) : NaN;
    if (v === "" || !Number.isFinite(n)) continue;
    const { min, max, whole } = LIMITS[key];
    out[key] = Math.min(max, Math.max(min, whole ? Math.round(n) : n));
  }
  out.waitRedMin = Math.max(out.waitRedMin, out.waitAmberMin + 1);
  out.adsCostRed = Math.max(out.adsCostRed, out.adsCostAmber);
  // only an explicit «no» turns the stricter colours back on
  out.redOnlyCritical = !(given.redOnlyCritical === false || given.redOnlyCritical === "false");
  return out;
}

// --------------------------------------------------------------------- facts ----

/** A conversation of «العملاء» (client_leads) that opened, or came back, today. */
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
/** A Teletel agent and their status now (GET /agents availability_status). */
export type AgentFact = { name: string; status: Presence };
/** An open Teletel conversation: who holds it and when it last moved. */
export type OpenFact = { agent: string | null; activeAt: string };
export type EmployeeFact = { id: string; name: string };
export type AuditFact = { action: string; actor_id: string | null; entity_id: string | null; at: string; meta: Record<string, unknown> | null };
export type OfferFact = { id: string; serial: string; country: string | null; created_at: string };
/** a confirmation in the status history; `still`: the offer is confirmed now */
export type ConfirmFact = { offer_id: string; at: string; still: boolean; country: string | null };
/** a file opened today */
export type DraftFact = { created_at: string; issued: boolean };
export type AdFact = { campaign: string; dest: string; cost: number; clicks: number; conversions: number; updated_at: string };
export type MuradFact = { conversation_id: number; reason: string | null; error: string | null; replied: boolean; at: string };
export type IntegrationFact = { name: string; fail_streak: number; alerted: string | null; last_error: string | null; last_error_at: string | null; renews_on: string | null };

export type ManagerFacts = {
  now: number;
  day: string;
  thresholds: ManagerThresholds;
  /** the working day (Murad's reception setting, else 09:00–23:00) */
  hours: Hours;
  leads: LeadFact[];
  /** null: Teletel's conversations could not be read — said, never shown as «nobody waits» */
  waits: WaitFact[] | null;
  open: OpenFact[] | null;
  /** null: Teletel's agents could not be read */
  agents: AgentFact[] | null;
  employees: EmployeeFact[];
  audit: AuditFact[];
  /** today's offers */
  offers: OfferFact[];
  /** the confirmations of the last weeks — today's count only the first of each offer */
  confirms: ConfirmFact[];
  drafts: DraftFact[];
  ads: { currency: string; rows: AdFact[]; latest: string | null };
  murad: MuradFact[];
  integrations: IntegrationFact[];
  /** app_settings pkg_backup, as stored */
  backup: string | null;
  ops: { live: DigestLive[] };
};

// ------------------------------------------------------------------- helpers ----

const RANK: Record<Status, number> = { green: 0, amber: 1, red: 2 };
export const worst = (statuses: Status[]): Status => statuses.reduce<Status>((w, s) => (RANK[s] > RANK[w] ? s : w), "green");
const level = (value: number, amber: number, red: number): Status => (value >= red ? "red" : value >= amber ? "amber" : "green");
const tile = (key: string, label: string, value: string | number, status: Status, reason: string): Tile => ({ key, label, value: String(value), status, reason });

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;
/** a wait older than a day is the backlog the SLA board keeps, not today's handling */
const RECENT_WAIT_MIN = 1440;
export const TICKER_HOURS = 6;
const TICKER_MAX = 40;
export const INQUIRY_KINDS = ["بكج", "فنادق", "طيران", "تأشيرات", "مواصلات", "رخص دولية", "طلب غير واضح"] as const;

const minutesText = (m: number) => (m < 60 ? arCount(Math.round(m), "دقيقة", "دقيقتين", "دقائق") : agePhrase(m / 60));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const money = (n: number, currency: string) => (currency === "USD" ? `$${n.toFixed(2)}` : `${n.toFixed(2)} ${currency}`);
const names = (list: string[], n = 5) => list.slice(0, n).join("، ") + (list.length > n ? ` و${list.length - n} غيرهم` : "");
/** 00:00 of a Riyadh day (UTC+3 all year) */
export const dayStartMs = (day: string) => Date.parse(`${day}T00:00:00+03:00`);
const nextDay = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
const visitedOn = (l: LeadFact, day: string) => riyadhDay(l.created_at) === day || (l.last_visit_at != null && riyadhDay(l.last_visit_at) === day);
const recentWaits = (f: ManagerFacts) => (f.waits ?? []).filter((w) => w.minutes >= f.thresholds.waitAmberMin && w.minutes < RECENT_WAIT_MIN);

/** What is not critical is amber at most while red is kept for the critical. */
const soft = (f: ManagerFacts, s: Status): Status => (f.thresholds.redOnlyCritical && s === "red" ? "amber" : s);

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

/** What a panel decides (`tiles`) and how the screen shows it (four `kpis`, two `boxes`). */
type Section = { tiles: Tile[]; kpis: Kpi[]; boxes: Box[] };

/** A tile's card: its own label and status, with the number and the unit the screen sets apart. */
const kpi = (t: Tile, num: string | number, sub: string, extra: Partial<Kpi> = {}): Kpi => ({ key: t.key, label: t.label, num: String(num), status: t.status, sub, ...extra });
/** «3 د» / «2 س» — a duration as the cards show it */
const duration = (m: number | null): { num: string; unit?: string } =>
  m == null ? { num: "—" } : m < 60 ? { num: String(Math.round(m)), unit: "د" } : m < 2880 ? { num: String(Math.round(m / 60)), unit: "س" } : { num: String(Math.round(m / 1440)), unit: "يوم" };
const durationText = (m: number) => {
  const d = duration(m);
  return `${d.num} ${d.unit ?? ""}`.trim();
};
/** the longest first, each as a share of the longest */
const bars = (counts: [string, number][], value: (n: number) => string = String, max = 6): BoxItem[] => {
  const top = counts.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, max);
  const most = Math.max(...top.map(([, n]) => n), Number.MIN_VALUE);
  return top.map(([label, n]) => ({ label, value: value(n), share: n / most }));
};
const countBy = <T,>(xs: T[], key: (x: T) => string | null): [string, number][] => {
  const m = new Map<string, number>();
  for (const x of xs) {
    const k = key(x);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m];
};
/** «14:05» in Riyadh (UTC+3 all year) */
const clock = (iso: string) => new Date(Date.parse(iso) + 3 * 3600_000).toISOString().slice(11, 16);

/** Teletel's team today — shared by «المحادثات اليوم» and «الفريق». */
type AgentToday = { name: string; presence: Presence; open: number; replies: number; avg: number | null; status: Status };
type TeamToday = { agents: AgentToday[]; present: number; total: number; turns: number[] };

function teamToday(f: ManagerFacts): TeamToday {
  const t = f.thresholds;
  const dayStart = dayStartMs(f.day) / 1000;
  // each agent's turns today (the conversation history, 0099): how long they took to first answer
  const turns = new Map<string, number[]>();
  const all: number[] = [];
  for (const l of f.leads) {
    for (const s of l.handoffs ?? []) {
      if (s.from < dayStart || !s.reply) continue;
      const m = Math.max(0, s.reply - s.from) / 60;
      turns.set(fold(s.agent), [...(turns.get(fold(s.agent)) ?? []), m]);
      all.push(m);
    }
  }
  // the open conversations they hold that moved today — not the months-old ones Teletel keeps open
  const open = new Map<string, number>();
  for (const o of f.open ?? []) if (o.agent && riyadhDay(o.activeAt) === f.day) open.set(fold(o.agent), (open.get(fold(o.agent)) ?? 0) + 1);
  const ORDER: Record<Presence, number> = { online: 0, busy: 1, offline: 2 };
  const agents = (f.agents ?? [])
    .filter((a) => a.status !== "offline" || open.has(fold(a.name)) || turns.has(fold(a.name)))
    .map((a): AgentToday => {
      const replies = turns.get(fold(a.name)) ?? [];
      const avg = mean(replies);
      return { name: a.name, presence: a.status, open: open.get(fold(a.name)) ?? 0, replies: replies.length, avg, status: avg == null ? "green" : soft(f, level(avg, t.waitAmberMin, t.waitRedMin)) };
    })
    .sort((a, b) => ORDER[a.presence] - ORDER[b.presence] || b.open - a.open || b.replies - a.replies);
  return { agents, present: (f.agents ?? []).filter((a) => a.status !== "offline").length, total: f.agents?.length ?? 0, turns: all };
}

/** «الفريق على تليتيل»: the dot, the name, what they hold today, how fast they first answered. */
function agentBox(f: ManagerFacts, team: TeamToday, max: number): Box {
  return {
    title: "الفريق على تليتيل",
    note: f.agents === null ? "تليتيل لا يرد" : `${team.present} متصل من ${team.total}`,
    kind: "rows",
    items: team.agents.slice(0, max).map((a) => ({
      label: a.name,
      presence: a.presence,
      value: `مفتوحة ${a.open}`,
      detail: a.avg != null ? `أول رد ${durationText(a.avg)}` : a.presence === "offline" ? "غير متصل" : "لم يرد اليوم بعد",
      status: a.status,
    })),
    empty: f.agents === null ? "حالة الموظفين غير معروفة — تليتيل لا يرد" : "لا أحد متصل ولا محادثة تحركت اليوم",
  };
}

function conversations(f: ManagerFacts, today: LeadFact[], team: TeamToday): Section {
  const t = f.thresholds;
  const open = today.filter((l) => l.status === "open");
  const closed = today.length - open.length;
  const unassigned = open.filter((l) => !l.taken).length;
  const replies = today
    .filter((l) => l.first_message_at && l.first_reply_at && riyadhDay(l.first_message_at) === f.day)
    .map((l) => (Date.parse(l.first_reply_at!) - Date.parse(l.first_message_at!)) / MIN_MS)
    // a «first reply» before the message is an earlier conversation's (eye/anomalies ticketsFromLeads) — no measure
    .filter((m) => m >= 0);
  const avg = mean(replies);

  // a client waiting for us right now — today's conversation or an older one they wrote to again
  const late = recentWaits(f).sort((a, b) => b.minutes - a.minutes);
  const top = late[0];
  let waiting: Tile;
  if (f.waits === null) {
    waiting = tile("waiting", "بانتظار الرد", "—", "amber", "تعذّر الوصول إلى Teletel — لا تُعرض أوقات الانتظار");
  } else {
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

  const todayTile = tile("today", "المحادثات اليوم", today.length, "green", `${open.length} مفتوحة · ${closed} مغلقة`);
  const unassignedTile = tile("unassigned", "بلا موظف", unassigned, unassigned ? "amber" : "green", unassigned ? "مفتوحة ولم يستلمها أحد بعد" : "كل محادثة مفتوحة لها موظف");
  const firstReply =
    avg == null
      ? tile("first_reply", "متوسط أول رد", "—", "green", "لا ردود على محادثات اليوم بعد")
      : tile("first_reply", "متوسط أول رد", minutesText(avg), soft(f, level(avg, t.waitAmberMin, t.waitRedMin)), `على ${replies.length} محادثة اليوم`);
  const kinds = INQUIRY_KINDS.map((kind) => tile(`kind:${kind}`, kind, today.filter((l) => l.inquiry === kind).length, "green", `من ${today.length} محادثة اليوم`));

  return {
    tiles: [todayTile, tile("open", "مفتوحة", open.length, "green", "من محادثات اليوم"), unassignedTile, waiting, firstReply, tile("closed", "مغلقة", closed, "green", "من محادثات اليوم"), ...kinds],
    kpis: [
      kpi(todayTile, today.length, todayTile.reason, { split: { a: open.length, b: closed, aLabel: "مفتوحة", bLabel: "مغلقة" } }),
      kpi(waiting, waiting.value, waiting.reason),
      kpi(firstReply, duration(avg).num, avg == null ? firstReply.reason : `الهدف أقل من ${t.waitAmberMin} د · ${replies.length} محادثة`, {
        unit: duration(avg).unit,
        ...(avg != null ? { ring: { value: avg, target: t.waitAmberMin } } : {}),
      }),
      kpi(unassignedTile, unassigned, unassignedTile.reason),
    ],
    boxes: [
      { title: "حسب نوع الطلب", note: `${today.length} محادثة`, kind: "bars", items: bars(countBy(today, (l) => l.inquiry || "غير مصنّف")), empty: "لا محادثات اليوم بعد" },
      agentBox(f, team, 6),
    ],
  };
}

function sales(f: ManagerFacts, today: LeadFact[]): Section {
  const ofDay = (iso: string) => riyadhDay(iso) === f.day;
  const files = f.drafts.filter((d) => ofDay(d.created_at));
  const issued = f.offers.filter((o) => ofDay(o.created_at)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const sends = f.audit.filter((a) => a.action === "offer.client_sent" && ofDay(a.at));
  const sentIds = new Set(sends.map((a) => a.entity_id));
  const byMurad = new Set(sends.filter((a) => a.meta?.["by"] === "murad").map((a) => a.entity_id)).size;
  const confirmed = firstConfirmations(f.confirms).filter((c) => ofDay(c.at));
  const confirmedIds = new Set(confirmed.map((c) => c.offer_id));
  const countries = countBy(today, (l) => l.country);
  const top = [...countries].sort((a, b) => b[1] - a[1]).slice(0, 3);

  const filesTile = tile("files", "ملفات اليوم", files.length, "green", `صدر منها ${files.filter((d) => d.issued).length}`);
  const issuedTile = tile("issued", "صدرت اليوم", issued.length, "green", "عروض صدرت منذ منتصف الليل");
  const sentTile = tile("sent", "أُرسلت للعملاء اليوم", sentIds.size, "green", byMurad ? `منها ${byMurad} أرسلها مُراد` : "بزر «أرسل إلى العميل»");
  const confirmedTile = tile("confirmed", "تأكدت اليوم", confirmed.length, "green", "حجوزات أكدها العملاء اليوم");
  const topTile = tile("top", "الأكثر طلباً اليوم", top.map(([c]) => c).join("، ") || "—", "green", top.length ? top.map(([c, n]) => `${c} ${n}`).join(" · ") : "لا وجهة محددة في محادثات اليوم");
  const issuedFiles = files.filter((d) => d.issued).length;

  return {
    tiles: [filesTile, issuedTile, sentTile, confirmedTile, topTile],
    kpis: [
      kpi(filesTile, files.length, filesTile.reason, { split: { a: issuedFiles, b: files.length - issuedFiles, aLabel: "صدر", bLabel: "لم يصدر بعد" } }),
      kpi(issuedTile, issued.length, issuedTile.reason),
      kpi(sentTile, sentIds.size, sentTile.reason, { label: "أُرسلت للعملاء" }),
      kpi(confirmedTile, confirmed.length, confirmed.length ? names(confirmed.map((c) => c.country ?? "—"), 3) : confirmedTile.reason),
    ],
    boxes: [
      { title: "الوجهات الأكثر طلباً اليوم", note: "من محادثات اليوم", kind: "bars", items: bars(countries), empty: "لا وجهة محددة في محادثات اليوم بعد" },
      {
        title: "عروض اليوم",
        note: `${issued.length} عرض`,
        kind: "rows",
        items: issued.slice(0, 6).map((o) => ({
          label: o.country ?? "عرض",
          value: confirmedIds.has(o.id) ? "تأكد" : sentIds.has(o.id) ? "أُرسل" : "صدر",
          detail: `${o.serial} · ${clock(o.created_at)}`,
          status: "green" as Status,
        })),
        empty: "لم يصدر عرض اليوم بعد",
      },
    ],
  };
}

/** the board's flags (i18n ops.signal.*) in the few words a TV line holds */
const SIGNAL_SHORT: Record<OperationSignal["code"], string> = {
  travel_approaching_incomplete: "سفر قريب وحجز ناقص",
  cancellation_deadline_near: "مهلة الإلغاء تنتهي",
  passport_expiring: "جواز ينتهي قريباً",
  installment_overdue: "قسط متأخر",
  hotel_awaiting_confirmation: "فندق بانتظار التأكيد",
  unpaid_confirmed: "غير مسدّد بالكامل",
  vouchers_pending: "فاوتشر لم يصدر",
};
const signalLabel = (s: OperationSignal) => SIGNAL_SHORT[s.code];
/** «AD-2-7287-20261017» → «AD-2-7287»: the date is the file's issue day, noise on a row */
const shortSerial = (serial: string) => serial.replace(/-\d{8}$/, "");

/**
 * The live files with a step due today or tomorrow — a trip, a free-cancellation
 * deadline, a payment, or a booking the trip needs — and how loud each is: red
 * for a critical flag (operations/signals.ts SEVERITY: the trip near with
 * bookings missing, a cancellation deadline, a passport), amber for the rest.
 * An installment already overdue, a trip next week: the board's and the eye's.
 */
function operations(f: ManagerFacts): Section {
  const tomorrow = nextDay(f.day);
  const dueOn = (d: string | null) => {
    const day = d?.slice(0, 10);
    return day && day >= f.day && day <= tomorrow ? day : null;
  };
  const when = (d: string) => (d === f.day ? "اليوم" : "غداً");
  const stepOf = (c: DigestLive, s: OperationSignal): string | null =>
    s.code === "cancellation_deadline_near"
      ? dueOn(c.deadline)
      : s.code === "installment_overdue"
        ? null
        : s.code === "unpaid_confirmed"
          ? (dueOn(c.payment) ?? dueOn(c.travel_start))
          : dueOn(c.travel_start);
  const statusOf = (signals: OperationSignal[]): Status =>
    signals.length === 0 ? "green" : signals.some((s) => s.severity === "critical") || !f.thresholds.redOnlyCritical ? "red" : "amber";
  const judged = f.ops.live.map((c) => {
    const due = c.signals.filter((s) => stepOf(c, s) != null);
    const status = statusOf(due);
    const who = `${c.serial}${status === "red" && firstName(c.customer) ? ` ${firstName(c.customer)}` : ""}`;
    return { c, due, status, who };
  });

  /**
   * one tile: the files `pick` holds, coloured by their own kind of flag only
   * (`kind`) — a payment due tomorrow is amber even on a file whose trip is red
   */
  const group = (key: string, label: string, pick: (c: DigestLive) => boolean, kind: (s: OperationSignal) => boolean, quiet: string): Tile => {
    const cases = f.ops.live
      .filter(pick)
      .map((c) => {
        const due = c.signals.filter((s) => kind(s) && stepOf(c, s) != null);
        const status = statusOf(due);
        return { c, due, status, who: `${c.serial}${status === "red" && firstName(c.customer) ? ` ${firstName(c.customer)}` : ""}` };
      });
    const loud = cases.filter((x) => x.due.length).sort((a, b) => RANK[b.status] - RANK[a.status])[0];
    return tile(key, label, cases.length, worst(cases.map((x) => x.status)), loud ? `${loud.who} — ${signalLabel(loud.due[0])} ${when(stepOf(loud.c, loud.due[0])!)}` : quiet);
  };
  const isDeadline = (s: OperationSignal) => s.code === "cancellation_deadline_near";
  const isPayment = (s: OperationSignal) => s.code === "unpaid_confirmed" || s.code === "installment_overdue";

  const live = f.ops.live;
  const clean = live.filter((c) => c.signals.length === 0).length;
  const travel = group("travel", "سفر اليوم أو غداً", (c) => dueOn(c.travel_start) != null, (s) => !isDeadline(s) && !isPayment(s), "كل من يسافر اليوم أو غداً جاهز");
  const deadline = group("deadline", "مهلة إلغاء تنتهي", (c) => dueOn(c.deadline) != null && c.signals.some(isDeadline), isDeadline, "لا مهلة إلغاء مجاني تنتهي اليوم أو غداً");
  const payment = group("payment", "دفعة مستحقة", (c) => dueOn(c.payment) != null, isPayment, "لا دفعة مستحقة اليوم أو غداً");
  const liveTile = tile("live", "ملفات جارية", live.length, "green", `${clean} منها بلا ملاحظات`);
  const due = judged.filter((x) => x.due.length).sort((a, b) => RANK[b.status] - RANK[a.status]);

  return {
    tiles: [travel, deadline, payment, liveTile],
    kpis: [
      kpi(travel, travel.value, travel.reason),
      kpi(deadline, deadline.value, deadline.reason),
      kpi(payment, payment.value, payment.reason),
      kpi(liveTile, live.length, liveTile.reason, { split: { a: live.length - clean, b: clean, aLabel: "عليها ملاحظات", bLabel: "بلا ملاحظات" } }),
    ],
    boxes: [
      {
        title: "خطوات اليوم وغداً",
        note: `${due.length} ملف`,
        kind: "rows",
        items: due.slice(0, 6).map((x) => ({ label: shortSerial(x.c.serial), value: when(stepOf(x.c, x.due[0])!), detail: signalLabel(x.due[0]), status: x.status })),
        empty: "لا خطوة مستحقة اليوم أو غداً",
      },
      {
        title: "الملفات الجارية حسب الملاحظة",
        note: `${live.length} ملف`,
        kind: "bars",
        items: bars(countBy(live.flatMap((c) => c.signals), signalLabel)),
        empty: "لا ملاحظات على الملفات الجارية",
      },
    ],
  };
}

/**
 * «الفريق» in Teletel, where the sales team works (the owner, 2026-10-19): each
 * agent's status now, the conversations they hold that moved today, and how
 * fast they first answered their turns today. Red only when nobody is online in
 * working hours while clients wait.
 */
function team(f: ManagerFacts, crew: TeamToday): Section {
  const t = f.thresholds;
  const actions = countBy(
    f.audit.filter((a) => a.actor_id && riyadhDay(a.at) === f.day),
    (a) => f.employees.find((e) => e.id === a.actor_id)?.name ?? "—",
  );
  const total = actions.reduce((n, [, c]) => n + c, 0);
  const busiest = [...actions].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const inSystem = tile("system_actions", "إجراءات في النظام اليوم", total, "green", busiest.length ? busiest.map(([name, n]) => `${name} (${n})`).join(" · ") : "لا إجراء مسجّل اليوم");
  const avg = mean(crew.turns);
  const teamReply = tile("team_reply", "أول رد للفريق", avg == null ? "—" : minutesText(avg), "green", avg == null ? "لا ردود اليوم بعد" : `متوسط ${crew.turns.length} رد اليوم`);
  const openToday = crew.agents.reduce((n, a) => n + a.open, 0);

  let presence: Tile;
  if (f.agents === null) {
    presence = tile("teletel", "تليتيل لا يرد", "—", "amber", "حالة الموظفين غير معروفة الآن — فحص «الربط الخارجي» يتابعه");
  } else {
    const working = isWorkingTime(new Date(f.now), f.hours);
    const waiting = recentWaits(f).length;
    const nobody = working && crew.present === 0 && waiting > 0;
    const here = f.agents.filter((a) => a.status !== "offline").map((a) => a.name);
    presence = tile(
      "teletel",
      "متصلون على تليتيل",
      `${crew.present} من ${crew.total}`,
      nobody ? "red" : "green",
      nobody ? `لا أحد متصل و${waiting} محادثة تنتظر الرد` : here.length ? names(here) : working ? "لا أحد متصل الآن" : `خارج ساعات العمل (${f.hours.open}–${f.hours.close})`,
    );
  }
  const people = crew.agents.map((a) => ({
    ...tile(`agent:${fold(a.name)}`, a.name, `${a.open} مفتوحة اليوم`, a.status, a.avg == null ? "لم يرد على محادثة اليوم بعد" : `متوسط ردّه الأول ${minutesText(a.avg)} على ${a.replies} محادثة`),
    presence: a.presence,
  }));
  const openTile = tile("team_open", "مفتوحة مع الفريق", openToday, "green", "محادثات يحملها الفريق وتحركت اليوم");

  return {
    tiles: [presence, ...people, teamReply, openTile, inSystem],
    kpis: [
      kpi(presence, f.agents === null ? "—" : crew.present, presence.reason, f.agents === null ? {} : { label: "متصلون الآن", unit: `من ${crew.total}` }),
      kpi(openTile, f.open === null ? "—" : openToday, openTile.reason),
      kpi(teamReply, duration(avg).num, avg == null ? teamReply.reason : `الهدف أقل من ${t.waitAmberMin} د · ${crew.turns.length} رد`, {
        unit: duration(avg).unit,
        // the card shows how the average sits against the target; the tile stays green — each slow agent is on the watch list already
        status: avg == null ? "green" : soft(f, level(avg, t.waitAmberMin, t.waitRedMin)),
        ...(avg != null ? { ring: { value: avg, target: t.waitAmberMin } } : {}),
      }),
      kpi(inSystem, total, inSystem.reason, { label: "إجراءات النظام" }),
    ],
    boxes: [
      agentBox(f, crew, 7),
      { title: "إجراءات في النظام اليوم", note: `${total} إجراء`, kind: "bars", items: bars(actions), empty: "لا إجراء مسجّل في النظام اليوم" },
    ],
  };
}

function ads(f: ManagerFacts, conversationsToday: number): Section {
  const t = f.thresholds;
  const { rows, currency } = f.ads;
  const spend = rows.reduce((n, r) => n + r.cost, 0);
  const clicks = rows.reduce((n, r) => n + r.clicks, 0);
  const conversions = Math.round(rows.reduce((n, r) => n + r.conversions, 0));
  const spending = rows.filter((r) => r.cost > 0);
  const $ = (n: number) => money(n, currency);

  // judged on Google's own conversions: every campaign has them, no guessing which conversation came from which ad
  const scored = spending.filter((r) => r.conversions >= 0.5).map((r) => ({ ...r, cpa: r.cost / r.conversions }));
  const best = [...scored].sort((a, b) => a.cpa - b.cpa)[0];
  const idle = spending.filter((r) => r.conversions < 0.5).sort((a, b) => b.cost - a.cost)[0];
  const weakest = idle ?? (scored.length > 1 ? [...scored].sort((a, b) => b.cpa - a.cpa)[0] : undefined);

  const spendTile = rows.length
    ? tile("spend", "إنفاق اليوم", $(spend), "green", `${spending.length} حملة صرفت اليوم`)
    : tile("spend", "إنفاق اليوم", "—", "amber", "لم تصل أرقام Google Ads لهذا اليوم بعد");
  const per = conversationsToday ? spend / conversationsToday : null;
  const perTile =
    per != null
      ? tile("cost_per_conversation", "تكلفة المحادثة", $(per), soft(f, level(per, t.adsCostAmber, t.adsCostRed)), `${$(spend)} ÷ ${conversationsToday} محادثة من كل المصادر`)
      : tile("cost_per_conversation", "تكلفة المحادثة", "—", spend ? soft(f, level(spend, t.adsCostAmber, t.adsCostRed)) : "green", spend ? `صُرف ${$(spend)} ولا محادثة اليوم` : "لا إنفاق ولا محادثات بعد");
  const convTile = tile("conversions", "تحويلات Google", `${conversions} / ${conversationsToday}`, "green", "مقابل محادثات اليوم من كل المصادر");
  const clicksTile = tile("clicks", "النقرات", clicks, "green", "من Google Ads اليوم");
  const extra: Tile[] = [
    ...(best ? [tile("best_campaign", "أفضل حملة", best.campaign, "green", `${$(best.cpa)} لكل تحويل Google`)] : []),
    ...(weakest && weakest !== best
      ? [
          idle
            ? tile("worst_campaign", "أضعف حملة", idle.campaign, "amber", `صرفت ${$(idle.cost)} اليوم بلا تحويل`)
            : tile("worst_campaign", "أضعف حملة", weakest.campaign, "green", `${$(weakest.cost / weakest.conversions)} لكل تحويل Google`),
        ]
      : []),
  ];
  const num$ = (n: number) => (currency === "USD" ? { num: n.toFixed(2), unit: "$" } : { num: n.toFixed(2), unit: currency });

  return {
    tiles: rows.length ? [spendTile, clicksTile, convTile, perTile, ...extra] : [spendTile],
    kpis: [
      kpi(spendTile, rows.length ? num$(spend).num : "—", spendTile.reason, rows.length ? { unit: num$(spend).unit } : {}),
      kpi(perTile, per != null ? num$(per).num : "—", perTile.reason, per != null ? { unit: num$(per).unit } : {}),
      kpi(convTile, conversions, `مقابل ${conversationsToday} محادثة من كل المصادر`),
      kpi(clicksTile, clicks, clicksTile.reason),
    ],
    boxes: [
      {
        title: "الإنفاق حسب الحملة",
        note: rows.length ? $(spend) : "—",
        kind: "bars",
        items: bars(spending.map((r) => [r.campaign, r.cost] as [string, number]), $),
        empty: "لم تصل أرقام الحملات لهذا اليوم بعد",
      },
      {
        title: "تكلفة تحويل Google",
        note: `${spending.length} حملة`,
        kind: "rows",
        items: [...[...scored].sort((a, b) => a.cpa - b.cpa), ...spending.filter((r) => r.conversions < 0.5)].slice(0, 6).map((r) => ({
          label: r.campaign,
          value: r.conversions >= 0.5 ? $(r.cost / r.conversions) : "بلا تحويل",
          detail: `صرف ${$(r.cost)}`,
          status: (r.conversions >= 0.5 ? "green" : "amber") as Status,
        })),
        empty: "لا حملة صرفت اليوم بعد",
      },
    ],
  };
}

const VISA_DONE = new Set(["visa:answered", "visa:handoff", "visa:info", "visa:not_needed"]);
const isHandoff = (reason: string | null) => reason === "offer:handoff" || reason === "visa:handoff" || Boolean(reason?.startsWith("routed:"));
const muradFailed = (m: MuradFact) => m.reason === "send_failed" || m.error === "send_failed" || m.error === "note_failed";
/** a suggestion Murad left staff as a private note (its reason is free text) */
const NOTE_FOR_STAFF = "ملاحظة للموظف";
/** what a murad_log row was, in a few words — null for a turn it left alone */
function muradDid(m: MuradFact): string | null {
  const r = m.reason ?? "";
  if (muradFailed(m)) return "تعذّر الإرسال";
  if (r === "offer:sent" || r === "offer:updated") return "أصدر عرضاً وأرسله";
  if (r === "offer:handoff") return "سلّم بكج لزميل";
  if (r === "visa:handoff") return "سلّم تأشيرة لزميل";
  if (VISA_DONE.has(r)) return "أجاب عن تأشيرة";
  if (r.startsWith("routed:")) return `حوّل إلى ${r.slice(7)}`;
  if (r === "asked" || r.startsWith("offer:asked") || r.startsWith("visa:asked")) return "سأل العميل عن طلبه";
  if (r === "ack") return "طمأن العميل";
  if (r.startsWith("none:") || r === "off" || r === "duplicate" || r === "out_of_scope" || r === "unreadable" || r === "error") return null;
  return r ? NOTE_FOR_STAFF : null;
}

/** «مُراد» today, from murad_log's own reasons (murad/reception-run.ts). */
function murad(f: ManagerFacts): Section {
  const today = f.murad.filter((m) => riyadhDay(m.at) === f.day);
  const failed = today.filter(muradFailed).length;
  const replies = tile("replies", "ردود آلية", today.filter((m) => m.replied).length, "green", "رسائل أرسلها مُراد للعملاء اليوم");
  const handoffs = tile("handoffs", "سلّمها لزميل", today.filter((m) => isHandoff(m.reason)).length, "green", "طلبات جهّزها وحوّلها لفريق");
  const offers = tile("offers", "عروض أصدرها آلياً", today.filter((m) => m.reason === "offer:sent").length, "green", "عرض جاهز صدر وأُرسل دون انتظار");
  const visas = tile("visas", "طلبات تأشيرة جهّزها", new Set(today.filter((m) => VISA_DONE.has(m.reason ?? "")).map((m) => m.conversation_id)).size, "green", "أجاب عنها أو سلّمها لقسم التأشيرات");
  const failedTile = tile("failed", "تعذّر الإرسال", failed, failed ? "amber" : "green", failed ? "رسائل لم تصل إلى Teletel اليوم" : "كل ردوده اليوم وصلت");
  const did = today.map((m) => ({ m, what: muradDid(m) })).filter((x): x is { m: MuradFact; what: string } => x.what != null);

  return {
    tiles: [replies, handoffs, offers, visas, failedTile],
    kpis: [kpi(replies, replies.value, replies.reason), kpi(handoffs, handoffs.value, handoffs.reason), kpi(offers, offers.value, offers.reason, { label: "عروض آلية" }), kpi(visas, visas.value, visas.reason, { label: "طلبات تأشيرة" })],
    boxes: [
      { title: "ما فعله مُراد اليوم", note: `${did.length} مرة`, kind: "bars", items: bars(countBy(did, (x) => x.what)), empty: "لم يتدخل مُراد اليوم بعد" },
      {
        title: "آخر ما فعله",
        note: failed ? `${failed} تعذّر إرسالها` : "كل ردوده وصلت",
        kind: "rows",
        // what the client saw — the notes for staff are counted above, not listed
        items: did
          .filter((x) => x.what !== NOTE_FOR_STAFF)
          .sort((a, b) => b.m.at.localeCompare(a.m.at))
          .slice(0, 6)
          .map((x) => ({ label: x.what, value: clock(x.m.at), status: (muradFailed(x.m) ? "amber" : "green") as Status })),
        empty: "لم يرد مُراد على عميل اليوم بعد",
      },
    ],
  };
}

/** What is down NOW — an end date next week is «الربط الخارجي»'s own alert, not today's screen. */
function system(f: ManagerFacts): Section {
  // «الربط الخارجي»'s own judgement (integration-alerts.ts): «fail» = two failed checks in a row, «expiry:1» = ends within a day
  const judged = f.integrations.map((r) => {
    const status: Status = r.alerted === "fail" ? "red" : r.alerted === "expiry:1" ? soft(f, "red") : r.fail_streak === 1 ? "amber" : "green";
    const why = r.alerted === "expiry:1" ? "ينتهي خلال يوم" : (r.last_error ?? "لا يعمل");
    return { name: r.name, status, why };
  });
  const bad = judged.filter((j) => j.status !== "green").sort((a, b) => RANK[b.status] - RANK[a.status]);
  const integrations = tile(
    "integrations",
    "الربط الخارجي",
    `${judged.length - bad.length} من ${judged.length} سليم`,
    worst(bad.map((x) => x.status)),
    bad.length ? bad.slice(0, 2).map((x) => `${x.name}: ${x.why}`).join(" · ") : "كل ما يرتبط به النظام يعمل",
  );

  const b = backupHealth(f.backup, f.now);
  const backup =
    b.status === "ok"
      ? tile("backup", "النسخة الاحتياطية", b.day, "green", `${b.mb} MB · ${b.objects} ملف · قبل ${minutesText(b.hours * 60)}`)
      : tile(
          "backup",
          "النسخة الاحتياطية",
          "متوقفة",
          "red",
          { never: "لم تُسجَّل نسخة بعد", failed: `فشلت آخر نسخة (قبل ${minutesText((b.hours ?? 0) * 60)})`, stale: `آخر نسخة قبل ${minutesText((b.hours ?? 0) * 60)}`, small: "آخر نسخة أصغر من المعتاد" }[b.reason],
        );

  // the same limits as the «الربط الخارجي» check ads_fresh (developer/checks.ts): late after 2 hours, down after 6
  const age = f.ads.latest ? (f.now - Date.parse(f.ads.latest)) / MIN_MS : null;
  const feed =
    age == null
      ? tile("ads_feed", "بيانات الإعلانات", "—", "red", "لم تصل أرقام Google Ads قط")
      : tile("ads_feed", "بيانات الإعلانات", `قبل ${minutesText(age)}`, level(age, 120, 360), "آخر ما أرسله سكربت Google Ads");

  // Teletel's reachability is already said where it matters («بانتظار الرد», «الفريق») — a card here, not a third alarm
  const teletelUp = f.waits !== null && f.agents !== null;
  const teletelKpi: Kpi = {
    key: "teletel_api",
    label: "تليتيل",
    num: teletelUp ? String(f.open?.length ?? 0) : "—",
    status: teletelUp ? "green" : "amber",
    sub: teletelUp ? `محادثة مفتوحة · ${f.agents?.length ?? 0} موظف` : "لا يرد الآن",
  };
  const okCount = judged.length - bad.length;

  return {
    tiles: [integrations, backup, feed],
    kpis: [
      kpi(integrations, okCount, integrations.reason, { unit: `من ${judged.length}` }),
      kpi(backup, b.status === "ok" ? String(b.mb) : "—", b.status === "ok" ? `${b.day} · ${b.objects} ملف · قبل ${minutesText(b.hours * 60)}` : backup.reason, { label: "آخر نسخة", ...(b.status === "ok" ? { unit: "MB" } : {}) }),
      kpi(feed, duration(age).num, feed.reason, { unit: duration(age).unit }),
      teletelKpi,
    ],
    boxes: [
      {
        title: "الربط الخارجي",
        note: `${okCount} من ${judged.length} سليم`,
        kind: "rows",
        items: [
          ...bad.slice(0, 5).map((x) => ({ label: x.name, value: x.status === "red" ? "متوقف" : "تحذير", detail: x.why, status: x.status })),
          // what stumbled today and is back — today's story, not an alarm
          ...f.integrations
            .filter((r) => r.last_error_at && riyadhDay(r.last_error_at) === f.day && r.fail_streak === 0 && r.alerted !== "fail")
            .slice(0, Math.max(0, 4 - bad.length))
            .map((r) => ({ label: r.name, value: "عاد يعمل", detail: `تعثّر ${clock(r.last_error_at!)}`, status: "green" as Status })),
          ...(okCount ? [{ label: bad.length ? "الباقي" : "كل الخدمات", value: `${okCount} تعمل`, status: "green" as Status }] : []),
        ],
        empty: "لا خدمات مسجّلة في «الربط الخارجي»",
      },
      {
        title: "آخر التحديثات",
        note: "الآن",
        kind: "rows",
        items: [
          { label: "النسخة الاحتياطية", value: b.status === "ok" ? `قبل ${durationText(b.hours * 60)}` : "متوقفة", detail: b.status === "ok" ? `${b.mb} MB · ${b.objects} ملف` : backup.reason, status: backup.status },
          { label: "أرقام Google Ads", value: age == null ? "—" : `قبل ${durationText(age)}`, detail: "من سكربت الحساب", status: feed.status },
          { label: "تليتيل", value: teletelUp ? "يرد" : "لا يرد", detail: teletelUp ? `${f.open?.length ?? 0} محادثة مفتوحة` : "الانتظار والحضور غير معروفين", status: teletelUp ? ("green" as Status) : ("amber" as Status) },
        ],
        empty: "—",
      },
    ],
  };
}

// ------------------------------------------------------------- ticker, hour ----

/** Today's real events of the last hours, newest first — each from a row, none made up. */
export function ticker(f: ManagerFacts): TickerItem[] {
  const since = Math.max(dayStartMs(f.day), f.now - TICKER_HOURS * 3600_000);
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

  return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, TICKER_MAX);
}

/** «ملخص الساعة»: what the last hour of today brought, then what needs handling now. */
export function hourly(f: ManagerFacts, panels: Panel[]): string[] {
  const since = Math.max(dayStartMs(f.day), f.now - 3600_000);
  const inHour = (iso: string | null | undefined) => Boolean(iso) && Date.parse(iso!) >= since;
  const counts: [number, string][] = [
    [f.leads.filter((l) => inHour(l.created_at) || inHour(l.last_visit_at)).length, "محادثة جديدة"],
    [f.offers.filter((o) => inHour(o.created_at)).length, "عرض صدر"],
    [new Set(f.audit.filter((a) => a.action === "offer.client_sent" && inHour(a.at)).map((a) => a.entity_id)).size, "عرض أُرسل"],
    [firstConfirmations(f.confirms).filter((c) => inHour(c.at)).length, "حجز تأكد"],
    [f.murad.filter((m) => m.replied && inHour(m.at)).length, "رد آلي من مُراد"],
  ];
  const happened = counts.filter(([n]) => n > 0).map(([n, what]) => `${n} ${what}`);
  const flagged = panels
    .flatMap((p) => p.tiles)
    .filter((x) => x.status !== "green")
    .sort((a, b) => RANK[b.status] - RANK[a.status])
    .slice(0, 4)
    .map((x) => `${x.status === "red" ? "يحتاج تدخلك الآن" : "للمتابعة"} — ${x.label}: ${x.value} (${x.reason})`);
  return [happened.length ? `في آخر ساعة: ${happened.join("، ")}.` : "آخر ساعة هادئة: لا محادثة جديدة ولا عرض.", ...(flagged.length ? flagged : ["لا شيء ينتظر المعالجة الآن."])];
}

// ------------------------------------------------------------------ assembly ----

export const PANEL_TITLES: Record<PanelKey, { title: string; short: string }> = {
  conversations: { title: "المحادثات اليوم", short: "المحادثات" },
  sales: { title: "المبيعات", short: "المبيعات" },
  operations: { title: "العمليات", short: "العمليات" },
  team: { title: "الفريق", short: "الفريق" },
  ads: { title: "الإعلانات", short: "الإعلانات" },
  murad: { title: "مُراد", short: "مُراد" },
  system: { title: "النظام", short: "النظام" },
};

/** What to do about a flagged tile — the screen's gold «← …». */
const ACTIONS: Record<string, string> = {
  waiting: "أسندها لموظف متصل",
  unassigned: "وزّعها على الفريق",
  first_reply: "راجع توزيع المحادثات",
  travel: "أكمل الحجوزات قبل السفر",
  deadline: "قرّر قبل انتهاء المهلة: تأكيد أو إلغاء",
  payment: "ذكّر العميل بالدفعة",
  teletel: "اطلب من موظف الدخول إلى تليتيل",
  cost_per_conversation: "راجع الحملات الأضعف",
  worst_campaign: "أوقفها أو عدّلها",
  spend: "تحقق من سكربت Google Ads",
  failed: "راجع سجل مُراد في «المطوّر»",
  integrations: "افتح «الربط الخارجي» في «المطوّر»",
  backup: "راجع النسخ الاحتياطي على الخادم",
  ads_feed: "تحقق من سكربت Google Ads",
};
const actionFor = (key: string) => ACTIONS[key] ?? (key.startsWith("agent:") ? "راجع محادثاته المفتوحة" : "راجع القسم");

export function buildScreen(f: ManagerFacts): Pick<ManagerSnapshot, "overall" | "panels" | "urgent" | "watch" | "ticker" | "hourly"> {
  const today = f.leads.filter((l) => visitedOn(l, f.day));
  const crew = teamToday(f);
  const sections: Record<PanelKey, Section> = {
    conversations: conversations(f, today, crew),
    sales: sales(f, today),
    operations: operations(f),
    team: team(f, crew),
    ads: ads(f, today.length),
    murad: murad(f),
    system: system(f),
  };
  const panels: Panel[] = (Object.keys(PANEL_TITLES) as PanelKey[]).map((key) => ({
    key,
    ...PANEL_TITLES[key],
    status: worst(sections[key].tiles.map((x) => x.status)),
    ...sections[key],
  }));
  const flagged = (status: Status) =>
    panels.flatMap((p) => p.tiles.filter((x) => x.status === status).map((x) => ({ ...x, panel: p.key, panelTitle: p.title, action: actionFor(x.key) })));
  return { overall: worst(panels.map((p) => p.status)), panels, urgent: flagged("red"), watch: flagged("amber"), ticker: ticker(f), hourly: hourly(f, panels) };
}
