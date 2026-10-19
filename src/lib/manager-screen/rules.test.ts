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

/**
 * «قناة المدير» against an injected clock: 2026-10-19 15:00 in Riyadh. Every
 * colour moves with the clock, not the data — the same reason eye/anomalies is
 * built this way.
 */

const NOW = Date.parse("2026-10-19T12:00:00Z");
const DAY = "2026-10-19";
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function facts(over: Partial<ManagerFacts> = {}): ManagerFacts {
  return {
    now: NOW,
    day: DAY,
    thresholds: MANAGER_DEFAULTS,
    leads: [],
    waits: [],
    employees: [],
    audit: [],
    offers: [],
    confirms: [],
    drafts: [],
    ads: { currency: "USD", rows: [], latest: ago(30) },
    murad: [],
    integrations: [],
    backup: JSON.stringify({ day: DAY, ok: true, at: ago(180), dump_bytes: 1_700_000, objects: 66 }),
    ops: { liveCases: 0, needsAction: 0, critical: 0, travelIncomplete: 0, unpaid: 0, urgent: [] },
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

const panel = (screen: { panels: Panel[] }, key: PanelKey) => screen.panels.find((p) => p.key === key)!;
const tileOf = (screen: { panels: Panel[] }, key: PanelKey, tile: string) => panel(screen, key).tiles.find((t) => t.key === tile)!;

describe("thresholds", () => {
  it("falls back to the defaults on nothing or garbage", () => {
    expect(normalizeManagerThresholds(null)).toEqual(MANAGER_DEFAULTS);
    expect(normalizeManagerThresholds("{not json")).toEqual(MANAGER_DEFAULTS);
  });

  it("clamps, rounds minutes, and keeps red after amber", () => {
    const t = normalizeManagerThresholds(JSON.stringify({ waitAmberMin: 30.4, waitRedMin: 10, fileRedDays: 99, adsCostAmber: "2", adsCostRed: 1, extra: 5 }));
    expect(t).toEqual({ waitAmberMin: 30, waitRedMin: 31, fileRedDays: 30, adsCostAmber: 2, adsCostRed: 2 });
  });
});

describe("«المحادثات اليوم»", () => {
  it("counts the day's conversations — a client who came back today too", () => {
    const s = buildScreen(facts({ leads: [lead(), lead({ id: "l2", created_at: "2026-10-10T09:00:00Z", last_visit_at: ago(30), status: "closed" }), lead({ id: "old", created_at: "2026-10-18T10:00:00Z" })] }));
    expect(tileOf(s, "conversations", "today").value).toBe("2");
    expect(tileOf(s, "conversations", "closed").value).toBe("1");
    expect(tileOf(s, "conversations", "kind:بكج").value).toBe("2");
  });

  it("colours a wait by the thresholds, naming the client only once it is red", () => {
    const amber = buildScreen(facts({ waits: [{ minutes: 8, since: ago(8), agent: "رشا", client: "سارة القحطاني" }] }));
    expect(tileOf(amber, "conversations", "waiting").status).toBe("amber");
    expect(tileOf(amber, "conversations", "waiting").reason).not.toContain("سارة");

    const red = buildScreen(facts({ waits: [{ minutes: 25, since: ago(25), agent: "رشا", client: "سارة القحطاني" }] }));
    const waiting = tileOf(red, "conversations", "waiting");
    expect(waiting.status).toBe("red");
    expect(waiting.reason).toBe("أطولها منذ 25 دقيقة — رشا · العميل سارة");
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

  it("averages today's first replies against the same thresholds", () => {
    const s = buildScreen(
      facts({ leads: [lead({ first_message_at: ago(100), first_reply_at: ago(80) }), lead({ id: "borrowed", first_message_at: ago(100), first_reply_at: "2026-09-27T13:50:29Z" })] }),
    );
    expect(tileOf(s, "conversations", "first_reply")).toMatchObject({ value: "20 دقيقة", status: "red", reason: "على 1 محادثة اليوم" });
  });
});

describe("«المبيعات»", () => {
  it("turns a file red once it has gone unissued past the days", () => {
    const s = buildScreen(facts({ drafts: [{ created_at: ago(3 * 1440), issued: false, owner: "هاني" }, { created_at: ago(60), issued: false, owner: "ريم" }] }));
    expect(tileOf(s, "sales", "late_files")).toMatchObject({ value: "1", status: "red", reason: "أقدمها منذ 3 يوم — هاني" });
  });

  it("counts a confirmation once, on its first day, and only while it holds", () => {
    const rows = [
      { offer_id: "a", at: ago(30), still: true, country: "جورجيا" },
      { offer_id: "a", at: "2026-10-01T10:00:00Z", still: true, country: "جورجيا" },
      { offer_id: "b", at: ago(20), still: false, country: null },
    ];
    expect(firstConfirmations(rows).map((r) => r.at)).toEqual(["2026-10-01T10:00:00Z"]);
    const s = buildScreen(facts({ confirms: rows, offers: [{ id: "a", serial: "AD-1", country: null, created_at: ago(90) }] }));
    expect(tileOf(s, "sales", "confirmed_today").value).toBe("0");
    expect(tileOf(s, "sales", "confirmed_month").value).toBe("1");
    expect(tileOf(s, "sales", "conversion").value).toBe("100%");
  });
});

describe("«العمليات»", () => {
  it("wears the board's colours, the client by first name on the red tile", () => {
    const s = buildScreen(
      facts({ ops: { liveCases: 5, needsAction: 2, critical: 1, travelIncomplete: 1, unpaid: 1, urgent: [{ id: "o1", serial: "AD-9", customer: "نورة الشهري", worst: "جواز على وشك الانتهاء" }] } }),
    );
    expect(tileOf(s, "operations", "needs_action")).toMatchObject({ status: "red", reason: "AD-9 نورة — جواز على وشك الانتهاء" });
    expect(tileOf(s, "operations", "travel_incomplete").status).toBe("amber");
    expect(tileOf(s, "operations", "unpaid").status).toBe("amber");
    expect(tileOf(s, "operations", "all_good").value).toBe("3");
  });
});

describe("«الفريق»", () => {
  it("shows who is online and who never opened the system, and each one's reply time", () => {
    const s = buildScreen(
      facts({
        employees: [
          { id: "e1", name: "رشا", active: true, firstSeenAt: ago(300), lastSeenAt: ago(1) },
          { id: "e2", name: "هاني", active: true, firstSeenAt: null, lastSeenAt: null },
          { id: "e3", name: "قديم", active: false, firstSeenAt: null, lastSeenAt: null },
        ],
        audit: [{ action: "offer.created", actor_id: "e1", entity_id: "x", at: ago(10), meta: null }],
        leads: [lead({ handoffs: [{ agent: "رشا", from: (NOW - 50 * 60_000) / 1000, reply: (NOW - 30 * 60_000) / 1000, handed: null, by: null }] })],
      }),
    );
    expect(tileOf(s, "team", "online")).toMatchObject({ value: "1", reason: "رشا" });
    expect(tileOf(s, "team", "absent")).toMatchObject({ value: "1", status: "amber", reason: "هاني" });
    expect(tileOf(s, "team", "employee:e1")).toMatchObject({ value: "1 إجراء", status: "red" });
    expect(tileOf(s, "team", "employee:e1").reason).toContain("متوسط الرد 20 دقيقة");
  });
});

describe("«الإعلانات»", () => {
  const row = (campaign: string, cost: number, conversions: number) => ({ campaign, dest: "عام", cost, clicks: 10, conversions, updated_at: ago(20) });

  it("sets today's spend against today's conversations, and names the best and the weakest campaign", () => {
    const s = buildScreen(facts({ leads: [lead(), lead({ id: "l2" })], ads: { currency: "USD", rows: [row("ماليزيا", 3, 3), row("تركيا", 8, 2), row("أوروبا", 2.4, 0)], latest: ago(20) } }));
    expect(tileOf(s, "ads", "cost_per_conversation")).toMatchObject({ value: "$6.70", status: "red" });
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

describe("«النظام»", () => {
  it("takes the integrations' own alert state, the backup's health and the ads feed's age", () => {
    const s = buildScreen(
      facts({
        integrations: [
          { name: "Teletel", fail_streak: 2, alerted: "fail", last_error: "ردّ بخطأ 401", last_error_at: ago(40), renews_on: null },
          { name: "الطقس", fail_streak: 1, alerted: null, last_error: "503", last_error_at: ago(5), renews_on: null },
          { name: "النطاق", fail_streak: 0, alerted: null, last_error: null, last_error_at: null, renews_on: null },
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
  it("carries real events of the last hours only, newest first", () => {
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
});

describe("the whole screen", () => {
  it("has nothing urgent and nothing late on a quiet day", () => {
    const s = buildScreen(facts());
    expect(s.urgent).toEqual([]);
    expect(s.panels.find((p) => p.key === "ads")?.status).toBe("amber");
    expect(s.hourly).toEqual(["آخر ساعة هادئة: لا محادثة جديدة ولا عرض.", "لا شيء متأخر الآن."]);
  });

  it("is as bad as its worst tile, and the hour's summary says what is late", () => {
    const s = buildScreen(facts({ leads: [lead({ created_at: ago(10) })], drafts: [{ created_at: ago(5 * 1440), issued: false, owner: null }] }));
    expect(s.overall).toBe("red");
    expect(s.urgent).toHaveLength(1);
    expect(s.hourly[0]).toBe("في آخر ساعة: 1 محادثة جديدة.");
    expect(s.hourly[1]).toBe("متأخر الآن — ملفات لم تصدر: 1 (أقدمها منذ 5 يوم — بلا موظف)");
  });
});
