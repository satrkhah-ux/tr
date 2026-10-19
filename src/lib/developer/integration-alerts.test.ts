import { describe, expect, it } from "vitest";
import { nextAlert } from "./integration-alerts";

const today = "2026-10-19";
const fresh = { fail_streak: 0, alerted: null };

describe("«الربط الخارجي» alerts — once per problem (the owner, 2026-10-19)", () => {
  it("a check failing twice in a row is said once; a single blip is not", () => {
    const one = nextAlert(fresh, { status: "down" }, null, today);
    expect(one).toMatchObject({ fail_streak: 1, alert: null });
    const two = nextAlert(one, { status: "down" }, null, today);
    expect(two).toMatchObject({ fail_streak: 2, alerted: "fail", alert: "fail" });
    expect(nextAlert(two, { status: "down" }, null, today)).toMatchObject({ fail_streak: 3, alert: null });
    // well again: the memory clears, so the next failure is said too
    expect(nextAlert(two, { status: "ok" }, null, today)).toMatchObject({ fail_streak: 0, alerted: null, alert: null });
  });

  it("an end date within 14, 7, 1 days — the typed one or the check's — each said once", () => {
    expect(nextAlert(fresh, null, "2026-10-30", today)).toMatchObject({ alert: "expiry:14", days: 11 });
    expect(nextAlert({ fail_streak: 0, alerted: "expiry:14" }, null, "2026-10-30", today).alert).toBeNull();
    expect(nextAlert({ fail_streak: 0, alerted: "expiry:14" }, null, "2026-10-25", today).alert).toBe("expiry:7");
    expect(nextAlert(fresh, { status: "warn", days: 1 }, null, today).alert).toBe("expiry:1");
    expect(nextAlert(fresh, { status: "ok", days: 67 }, "2027-03-01", today)).toMatchObject({ alert: null, alerted: null });
  });
});

describe("where a secret lives — a name or a path, never the value", () => {
  it("refuses what reads as a key or a token", async () => {
    const { looksLikeSecret } = await import("./integration-kinds");
    expect(looksLikeSecret("OPENAI_API_KEY، TELETEL_API_TOKEN")).toBe(false);
    expect(looksLikeSecret("/home/deploy/apps/traveliun-bot/.env (BOT_TOKEN، ADS_HOOK_KEY)")).toBe(false);
    expect(looksLikeSecret("سكربت داخل حساب Google Ads")).toBe(false);
    expect(looksLikeSecret("sk-proj-abcdefghijklmnopqrstuvwxyz123456")).toBe(true);
    expect(looksLikeSecret("7781234567:AAHk3jXyZabcdefghijklmnopqrstu")).toBe(true);
  });
});
