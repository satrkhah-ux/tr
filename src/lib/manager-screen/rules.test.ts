import { describe, expect, it } from "vitest";
import {
  buildScreen,
  firstConfirmations,
  MANAGER_DEFAULTS,
  normalizeManagerThresholds,
  ticker,
  type LeadFact,
  type ManagerFacts,
  type Panel,
  type PanelKey,
} from "./rules";
import type { DigestLive } from "@/lib/telegram/ops-digest";

/**
 * «قناة المدير» against an injected clock: 2026-10-19 15:00 in Riyadh, inside
 * the working day. Every colour moves with the clock, not the data — the same
 * reason eye/anomalies is built this way.
 */

const NOW = Date.parse("2026-10-19T12:00:00Z");
const DAY = "2026-10-19";
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const STRICT = { ...MANAGER_DEFAULTS, redOnlyCritical: false };

function facts(over: Partial<ManagerFacts> = {}): ManagerFacts {
  return {
    now: NOW,
    day: DAY,
    thresholds: MANAGER_DEFAULTS,
    hours: { open: "09:00", close: "23:00" },
    leads: [],
    waits: [],
    open: [],
    agents: [],
    employees: [],
    audit: [],
    offers: [],
    confirms: [],
    drafts: [],
    ads: { currency: "USD", rows: [], latest: ago(30) },
    murad: [],
    integrations: [],
    backup: JSON.stringify({ day: DAY, ok: true, at: ago(180), dump_bytes: 1_700_000, objects: 66 }),
    ops: { live: [] },
    ...over,
  };
}

const lead = (over: Partial<LeadFact> = {}): LeadFact => ({
  id: "l1",
  name: "محمد العتيبي",
  inquiry: "بكج",
  country: "تركيا",
  status: "open",
  taken: true,
  created_at: ago(60),
  last_visit_at: null,
  first_message_at: ago(60),
  first_reply_at: ago(58),
  handoffs: null,
  ...over,
});

const file = (over: Partial<DigestLive> = {}): DigestLive => ({
  id: "o1",
  serial: "AD-9",
  customer: "نورة الشهري",
  travel_start: "2026-11-20",
  signals: [],
  deadline: null,
  payment: null,
  ...over,
});
const flag = (code: DigestLive["signals"][number]["code"], severity: DigestLive["signals"][number]["severity"]) => ({ code, severity, subjects: [] });

const panel = (screen: { panels: Panel[] }, key: PanelKey) => screen.panels.find((p) => p.key === key)!;
const tileOf = (screen: { panels: Panel[] }, key: PanelKey, tile: string) => panel(screen, key).tiles.find((t) => t.key === tile)!;

describe("thresholds", () => {
  it("falls back to the defaults on nothing or garbage — red kept for the critical", () => {
    expect(normalizeManagerThresholds(null)).toEqual(MANAGER_DEFAULTS);
    expect(normalizeManagerThresholds("{not json")).toEqual(MANAGER_DEFAULTS);
    expect(MANAGER_DEFAULTS.redOnlyCritical).toBe(true);
  });

  it("clamps, rounds minutes, keeps red after amber, and turns strict colours on only when told", () => {
    const t = normalizeManagerThresholds(JSON.stringify({ waitAmberMin: 30.4, waitRedMin: 10, adsCostAmber: "2", adsCostRed: 1, redOnlyCritical: false, fileRedDays: 4 }));
    expect(t).toEqual({ waitAmberMin: 30, waitRedMin: 31, adsCostAmber: 2, adsCostRed: 2, redOnlyCritical: false });
    expect(normalizeManagerThresholds({ redOnlyCritical: "false" }).redOnlyCritical).toBe(false);
    expect(normalizeManagerThresholds({ redOnlyCritical: "no" }).redOnlyCritical).toBe(true);
  });
});

describe("«المحادثات اليوم»", () => {
  it("counts today's conversations — a client who came back today too, nobody from yesterday", () => {
    const s = buildScreen(facts({ leads: [lead(), lead({ id: "l2", created_at: "2026-10-10T09:00:00Z", last_visit_at: ago(30), status: "closed" }), lead({ id: "old", created_at: "2026-10-18T10:00:00Z" })] }));
    expect(tileOf(s, "conversations", "today").value).toBe("2");
    expect(tileOf(s, "conversations", "closed").value).toBe("1");
    expect(tileOf(s, "conversations", "kind:بكج").value).toBe("2");
  });

  it("is red for a client waiting past the threshold, naming them only then", () => {
    const amber = buildScreen(facts({ waits: [{ minutes: 8, since: ago(8), agent: "رشا", client: "سارة القحطاني" }] }));
    expect(tileOf(amber, "conversations", "waiting").status).toBe("amber");
    expect(tileOf(amber, "conversations", "waiting").reason).not.toContain("سارة");

    const red = buildScreen(facts({ waits: [{ minutes: 25, since: ago(25), agent: "رشا", client: "سارة القحطاني" }] }));
    expect(tileOf(red, "conversations", "waiting")).toMatchObject({ status: "red", reason: "أطولها منذ 25 دقيقة — رشا · العميل سارة" });
    expect(red.urgent.map((u) => u.key)).toContain("waiting");
  });

  it("never puts a phone on the screen, even when Teletel lists the client by it", () => {
    const s = buildScreen(facts({ waits: [{ minutes: 40, since: ago(40), agent: null, client: "966501234567" }] }));
    expect(JSON.stringify(s)).not.toMatch(/9665\d+/);
  });

  it("leaves the backlog of old waits out — and says so when Teletel cannot be read", () => {
    const old = buildScreen(facts({ waits: [{ minutes: 3 * 1440, since: ago(3 * 1440), agent: "رشا", client: null }] }));
    expect(tileOf(old, "conversations", "waiting").status).toBe("green");
    const down = buildScreen(facts({ waits: null }));
    expect(tileOf(down, "conversations", "waiting")).toMatchObject({ value: "—", status: "amber" });
  });

  it("averages today's first replies: slow is amber, red only in the stricter colours", () => {
    const leads = [lead({ first_message_at: ago(100), first_reply_at: ago(80) }), lead({ id: "borrowed", first_message_at: ago(100), first_reply_at: "2026-09-27T13:50:29Z" })];
    expect(tileOf(buildScreen(facts({ leads })), "conversations", "first_reply")).toMatchObject({ value: "20 دقيقة", status: "amber", reason: "على 1 محادثة اليوم" });
    expect(tileOf(buildScreen(facts({ leads, thresholds: STRICT })), "conversations", "first_reply").status).toBe("red");
  });
});

describe("«المبيعات» — today only", () => {
  it("counts today's files, offers and first confirmations, with no month and no backlog", () => {
    const confirms = [
      { offer_id: "a", at: ago(30), still: true, country: "جورجيا" },
      { offer_id: "a", at: "2026-10-01T10:00:00Z", still: true, country: "جورجيا" },
      { offer_id: "b", at: ago(20), still: true, country: null },
      { offer_id: "c", at: ago(10), still: false, country: null },
    ];
    expect(firstConfirmations(confirms).map((r) => r.offer_id).sort()).toEqual(["a", "b"]);
    const s = buildScreen(facts({ confirms, drafts: [{ created_at: ago(60), issued: true }, { created_at: ago(30), issued: false }], offers: [{ id: "x", serial: "AD-1", country: null, created_at: ago(90) }] }));
    expect(tileOf(s, "sales", "confirmed").value).toBe("1");
    expect(tileOf(s, "sales", "files")).toMatchObject({ value: "2", reason: "صدر منها 1" });
    expect(panel(s, "sales").tiles.map((t) => t.key)).toEqual(["files", "issued", "sent", "confirmed", "top"]);
    expect(panel(s, "sales").status).toBe("green");
  });
});

describe("«العمليات» — a step due today or tomorrow", () => {
  it("is red for a critical flag on a trip tomorrow, the client by first name", () => {
    const s = buildScreen(facts({ ops: { live: [file({ travel_start: "2026-10-20", signals: [flag("travel_approaching_incomplete", "critical")] })] } }));
    expect(tileOf(s, "operations", "travel")).toMatchObject({ value: "1", status: "red", reason: "AD-9 نورة — سفر قريب وحجز ناقص غداً" });
  });

  it("keeps an ordinary flag amber — red only in the stricter colours", () => {
    const live = [file({ travel_start: DAY, signals: [flag("hotel_awaiting_confirmation", "warn")] })];
    const soft = tileOf(buildScreen(facts({ ops: { live } })), "operations", "travel");
    expect(soft).toMatchObject({ status: "amber", reason: "AD-9 — فندق بانتظار التأكيد اليوم" });
    expect(tileOf(buildScreen(facts({ ops: { live }, thresholds: STRICT })), "operations", "travel").status).toBe("red");
  });

  it("names a cancellation deadline and a payment due today or tomorrow", () => {
    const s = buildScreen(
      facts({
        ops: {
          live: [
            file({ id: "d", serial: "AD-D", deadline: DAY, signals: [flag("cancellation_deadline_near", "critical")] }),
            file({ id: "p", serial: "AD-P", payment: "2026-10-20", signals: [flag("unpaid_confirmed", "warn")] }),
          ],
        },
      }),
    );
    expect(tileOf(s, "operations", "deadline")).toMatchObject({ value: "1", status: "red" });
    expect(tileOf(s, "operations", "payment")).toMatchObject({ value: "1", status: "amber", reason: "AD-P — غير مسدّد بالكامل غداً" });
  });

  it("leaves next week's trip and an installment already overdue to the board and the eye", () => {
    const s = buildScreen(
      facts({
        ops: {
          live: [
            file({ travel_start: "2026-10-24", signals: [flag("travel_approaching_incomplete", "critical")] }),
            file({ id: "late", travel_start: "2026-12-01", signals: [flag("installment_overdue", "critical")] }),
          ],
        },
      }),
    );
    expect(panel(s, "operations").status).toBe("green");
    expect(tileOf(s, "operations", "live").value).toBe("2");
  });
});

describe("«الفريق» — in Teletel", () => {
  const agents = [
    { name: "رشا", status: "online" as const },
    { name: "هاني", status: "busy" as const },
    { name: "قديم", status: "offline" as const },
  ];

  it("shows each agent with their dot, today's open conversations and first-reply average", () => {
    const s = buildScreen(
      facts({
        agents,
        open: [{ agent: "رشا", activeAt: ago(10) }, { agent: "رشا", activeAt: "2026-10-01T10:00:00Z" }],
        leads: [lead({ handoffs: [{ agent: "رشا", from: (NOW - 50 * 60_000) / 1000, reply: (NOW - 42 * 60_000) / 1000, handed: null, by: null }] })],
      }),
    );
    expect(tileOf(s, "team", "teletel")).toMatchObject({ value: "2 من 3", status: "green", reason: "رشا، هاني" });
    expect(tileOf(s, "team", "agent:رشا")).toMatchObject({ value: "1 مفتوحة اليوم", presence: "online", status: "amber", reason: "متوسط ردّه الأول 8 دقائق على 1 محادثة" });
    expect(tileOf(s, "team", "agent:هاني").presence).toBe("busy");
    expect(tileOf(s, "team", "agent:قديم")).toBeUndefined();
    expect(panel(s, "team").tiles.some((t) => t.label === "لم يفتح النظام اليوم")).toBe(false);
  });

  it("is red only when nobody is online in working hours while clients wait", () => {
    const away = agents.map((a) => ({ ...a, status: "offline" as const }));
    const waits = [{ minutes: 9, since: ago(9), agent: null, client: null }];
    expect(tileOf(buildScreen(facts({ agents: away, waits })), "team", "teletel").status).toBe("red");
    expect(tileOf(buildScreen(facts({ agents: away, waits: [] })), "team", "teletel").status).toBe("green");
    const evening = tileOf(buildScreen(facts({ agents: away, waits, hours: { open: "16:00", close: "23:00" } })), "team", "teletel");
    expect(evening).toMatchObject({ status: "green", reason: "خارج ساعات العمل (16:00–23:00)" });
  });

  it("says «تليتيل لا يرد» in amber when the agents cannot be read", () => {
    expect(tileOf(buildScreen(facts({ agents: null })), "team", "teletel")).toMatchObject({ label: "تليتيل لا يرد", status: "amber" });
  });

  it("colours a slow agent red only in the stricter colours", () => {
    const slow = { agents, leads: [lead({ handoffs: [{ agent: "رشا", from: (NOW - 90 * 60_000) / 1000, reply: (NOW - 60 * 60_000) / 1000, handed: null, by: null }] })] };
    expect(tileOf(buildScreen(facts(slow)), "team", "agent:رشا").status).toBe("amber");
    expect(tileOf(buildScreen(facts({ ...slow, thresholds: STRICT })), "team", "agent:رشا").status).toBe("red");
  });
});

describe("«الإعلانات»", () => {
  const row = (campaign: string, cost: number, conversions: number) => ({ campaign, dest: "عام", cost, clicks: 10, conversions, updated_at: ago(20) });
  const spendy = { leads: [lead(), lead({ id: "l2" })], ads: { currency: "USD", rows: [row("ماليزيا", 3, 3), row("تركيا", 8, 2), row("أوروبا", 2.4, 0)], latest: ago(20) } };

  it("sets today's spend against today's conversations — expensive is amber unless strict", () => {
    const s = buildScreen(facts(spendy));
    expect(tileOf(s, "ads", "cost_per_conversation")).toMatchObject({ value: "$6.70", status: "amber" });
    expect(tileOf(buildScreen(facts({ ...spendy, thresholds: STRICT })), "ads", "cost_per_conversation").status).toBe("red");
    expect(tileOf(s, "ads", "best_campaign")).toMatchObject({ value: "ماليزيا", reason: "$1.00 لكل تحويل Google" });
    expect(tileOf(s, "ads", "worst_campaign")).toMatchObject({ value: "أوروبا", status: "amber" });
  });

  it("says so when the day's numbers have not arrived, rather than showing zero", () => {
    expect(tileOf(buildScreen(facts()), "ads", "spend")).toMatchObject({ value: "—", status: "amber" });
  });
});

describe("«مُراد»", () => {
  it("reads its day from murad_log's reasons", () => {
    const m = (reason: string | null, replied = true, conversation_id = 1) => ({ conversation_id, reason, error: null, replied, at: ago(15) });
    const s = buildScreen(facts({ murad: [m("offer:sent"), m("visa:asked1", true, 2), m("visa:handoff", true, 2), m("routed:بكج", false, 3), m("send_failed", false, 4)] }));
    const v = (k: string) => tileOf(s, "murad", k).value;
    expect([v("replies"), v("handoffs"), v("offers"), v("visas"), v("failed")]).toEqual(["3", "2", "1", "1", "1"]);
    expect(tileOf(s, "murad", "failed").status).toBe("amber");
  });
});

describe("«النظام» — what is down now", () => {
  it("is red for a check down, amber for one failure, quiet about an end date next week", () => {
    const s = buildScreen(
      facts({
        integrations: [
          { name: "Teletel", fail_streak: 2, alerted: "fail", last_error: "ردّ بخطأ 401", last_error_at: ago(40), renews_on: null },
          { name: "الطقس", fail_streak: 1, alerted: null, last_error: "503", last_error_at: ago(5), renews_on: null },
          { name: "النطاق", fail_streak: 0, alerted: "expiry:7", last_error: null, last_error_at: null, renews_on: "2026-10-25" },
        ],
        backup: JSON.stringify({ ok: false, at: ago(600), error: "disk" }),
        ads: { currency: "USD", rows: [], latest: ago(200) },
      }),
    );
    expect(tileOf(s, "system", "integrations")).toMatchObject({ value: "1 من 3 سليم", status: "red", reason: "Teletel: ردّ بخطأ 401 · الطقس: 503" });
    expect(tileOf(s, "system", "backup").status).toBe("red");
    expect(tileOf(s, "system", "ads_feed").status).toBe("amber");
  });
});

describe("the ticker", () => {
  it("carries today's real events only, newest first", () => {
    const items = ticker(
      facts({
        leads: [lead({ created_at: ago(5) }), lead({ id: "old", created_at: ago(8 * 60) })],
        offers: [{ id: "o", serial: "AD-6-1", country: "جورجيا", created_at: ago(30) }],
        audit: [{ action: "offer.client_sent", actor_id: null, entity_id: "o", at: ago(29), meta: { serial: "AD-6-1", by: "murad" } }],
        waits: [{ minutes: 25, since: ago(25), agent: "رشا", client: "سارة" }],
      }),
    );
    expect(items.map((i) => i.text)).toEqual([
      "محادثة جديدة — بكج · تركيا",
      "محادثة بانتظار الرد منذ 25 دقيقة — رشا",
      "مُراد أرسل العرض AD-6-1 للعميل",
      "صدر عرض جورجيا AD-6-1",
      "تمت النسخة الاحتياطية",
    ]);
    expect(items.find((i) => i.text.startsWith("محادثة بانتظار"))?.red).toBe(true);
  });

  it("does not reach back past midnight, even within its hours", () => {
    const early = Date.parse("2026-10-18T21:30:00Z"); // 00:30 Riyadh on the 19th
    const items = ticker(
      facts({
        now: early,
        backup: null,
        leads: [lead({ id: "yesterday", created_at: "2026-10-18T20:45:00Z" }), lead({ id: "today", created_at: "2026-10-18T21:10:00Z", inquiry: "طيران", country: null })],
      }),
    );
    expect(items.map((i) => i.text)).toEqual(["محادثة جديدة — طيران"]);
  });
});

describe("the whole screen", () => {
  it("has nothing to handle on a quiet day", () => {
    const s = buildScreen(facts());
    expect(s.urgent).toEqual([]);
    expect(s.hourly).toEqual(["آخر ساعة هادئة: لا محادثة جديدة ولا عرض.", "للمتابعة — إنفاق اليوم: — (لم تصل أرقام Google Ads لهذا اليوم بعد)"]);
  });

  it("is as bad as its worst tile, and the hour's summary says what needs handling", () => {
    const s = buildScreen(facts({ agents: [{ name: "رشا", status: "online" }], leads: [lead({ created_at: ago(10) })], waits: [{ minutes: 30, since: ago(30), agent: "رشا", client: null }] }));
    expect(s.overall).toBe("red");
    expect(s.urgent.map((u) => `${u.panel}/${u.key}`)).toEqual(["conversations/waiting"]);
    expect(s.hourly[0]).toBe("في آخر ساعة: 1 محادثة جديدة.");
    expect(s.hourly[1]).toBe("يحتاج تدخلك الآن — بانتظار الرد: 1 (أطولها منذ 30 دقيقة — رشا)");
  });
});

describe("what the screen draws (the owner's design order, 2026-10-20)", () => {
  const busy = facts({
    agents: [{ name: "رشا", status: "online" }, { name: "هاني", status: "offline" }],
    open: [{ agent: "رشا", activeAt: ago(5) }],
    leads: [
      lead({ first_message_at: ago(30), first_reply_at: ago(28), handoffs: [{ agent: "رشا", from: (NOW - 30 * 60_000) / 1000, reply: (NOW - 28 * 60_000) / 1000, handed: null, by: null }] }),
      lead({ id: "l2", inquiry: "تأشيرات", status: "closed", taken: false }),
      lead({ id: "l3", status: "open", taken: false }),
    ],
    waits: [{ minutes: 20, since: ago(20), agent: "رشا", client: null }],
  });

  it("gives every panel four cards and two boxes — a box with nothing says why", () => {
    for (const s of [buildScreen(facts()), buildScreen(busy)]) {
      for (const p of s.panels) {
        expect(p.kpis, p.key).toHaveLength(4);
        expect(p.boxes, p.key).toHaveLength(2);
        for (const b of p.boxes) expect(b.items.length > 0 || b.empty.length > 0).toBe(true);
      }
    }
  });

  it("draws today's conversations as a split, the first reply against its target, kinds as bars and the team as rows", () => {
    const s = buildScreen(busy);
    const [today, waiting, first, unassigned] = panel(s, "conversations").kpis;
    expect(today).toMatchObject({ num: "3", split: { a: 2, b: 1, aLabel: "مفتوحة", bLabel: "مغلقة" } });
    expect(waiting).toMatchObject({ num: "1", status: "red" });
    expect(first).toMatchObject({ num: "2", unit: "د", ring: { value: 2, target: 5 }, status: "green" });
    expect(unassigned).toMatchObject({ num: "1", status: "amber" });
    const [kinds, team] = panel(s, "conversations").boxes;
    expect(kinds).toMatchObject({ kind: "bars", items: [{ label: "بكج", value: "2", share: 1 }, { label: "تأشيرات", value: "1", share: 0.5 }] });
    expect(team).toMatchObject({ kind: "rows", note: "1 متصل من 2", items: [{ label: "رشا", presence: "online", value: "مفتوحة 1", detail: "أول رد 2 د", status: "green" }] });
  });

  it("tells what to do about each red item, and keeps the amber ones under «تحت المتابعة»", () => {
    const s = buildScreen(busy);
    expect(s.urgent.map((u) => [u.key, u.action])).toEqual([["waiting", "أسندها لموظف متصل"]]);
    expect(s.watch.map((u) => u.key)).toContain("unassigned");
    expect(s.watch.find((u) => u.key === "unassigned")?.action).toBe("وزّعها على الفريق");
  });

  it("lists what stumbled today and came back, beside what is down now", () => {
    const s = buildScreen(
      facts({ integrations: [{ name: "الطقس", fail_streak: 0, alerted: null, last_error: "503", last_error_at: ago(120), renews_on: null }, { name: "Teletel", fail_streak: 0, alerted: null, last_error: null, last_error_at: null, renews_on: null }] }),
    );
    expect(panel(s, "system").boxes[0].items).toEqual([
      { label: "الطقس", value: "عاد يعمل", detail: "تعثّر 13:00", status: "green" },
      { label: "كل الخدمات", value: "2 تعمل", status: "green" },
    ]);
  });
});
