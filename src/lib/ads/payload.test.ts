import { describe, expect, it } from "vitest";
import { rowsFromPayload } from "./payload";

describe("the Ads Script's posts (the owner, 2026-10-19)", () => {
  it("v1 — the bot's own shape and its archives: «yesterday» closed, «today» partial, dated by when it came", () => {
    const rows = rowsFromPayload(
      {
        account: "ترافليون",
        currency: "USD",
        receivedAtKsa: "2026-08-12 23:58",
        totals: {},
        campaigns: [{ name: "003  بحث ماليزيا 🟩 كامل", status: "ENABLED", today: { cost: 0.67, clicks: 2, impressions: 7, conversions: 0 }, yesterday: { cost: 0.189346, clicks: 2, impressions: 9, conversions: 0 } }],
      },
      "2026-10-19",
    );
    expect(rows?.days).toEqual([
      { day: "2026-08-11", campaign: "003  بحث ماليزيا 🟩 كامل", status: "ENABLED", cost: 0.189346, clicks: 2, impressions: 9, conversions: 0, currency: "USD", final: true },
      { day: "2026-08-12", campaign: "003  بحث ماليزيا 🟩 كامل", status: "ENABLED", cost: 0.67, clicks: 2, impressions: 7, conversions: 0, currency: "USD", final: false },
    ]);
  });

  it("v2 — the new script: days, where the clicks were, what was searched, the hour", () => {
    const rows = rowsFromPayload(
      {
        v: 2,
        currency: "USD",
        days: [{ date: "2026-10-18", final: true, campaigns: [{ name: "بحث تايلاند", status: "ENABLED", cost: 12.5, clicks: 40, impressions: 900, conversions: 3 }] }, { date: "bad", campaigns: [{ name: "x" }] }],
        locations: [{ date: "2026-10-18", campaign: "بحث تايلاند", country: "Saudi Arabia", city: "Riyadh", clicks: 30, impressions: 600, cost: 9 }],
        terms: [{ date: "2026-10-18", campaign: "بحث تايلاند", term: "رحلة تايلاند", clicks: 5, impressions: 50, cost: 1.2, conversions: 1 }],
        hours: [{ date: "2026-10-18", campaign: "بحث تايلاند", hour: 21, clicks: 7, impressions: 80, cost: 2 }, { date: "2026-10-18", campaign: "x", hour: 24 }],
      },
      "2026-10-19",
    );
    expect(rows?.days).toHaveLength(1);
    expect(rows?.days[0]).toMatchObject({ day: "2026-10-18", final: true, cost: 12.5, clicks: 40 });
    expect(rows?.locations[0]).toMatchObject({ country: "Saudi Arabia", city: "Riyadh", clicks: 30 });
    expect(rows?.terms[0]).toMatchObject({ term: "رحلة تايلاند", conversions: 1 });
    expect(rows?.hours).toEqual([{ day: "2026-10-18", campaign: "بحث تايلاند", hour: 21, clicks: 7, impressions: 80, cost: 2 }]);
  });

  it("anything else is no post; a negative or missing number is 0", () => {
    expect(rowsFromPayload({ hello: 1 }, "2026-10-19")).toBeNull();
    expect(rowsFromPayload(null, "2026-10-19")).toBeNull();
    expect(rowsFromPayload({ v: 2, days: [{ date: "2026-10-18", campaigns: [{ name: "a", cost: -3, clicks: "x" }] }] }, "2026-10-19")?.days[0]).toMatchObject({ cost: 0, clicks: 0 });
  });
});
