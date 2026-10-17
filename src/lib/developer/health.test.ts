import { describe, expect, it } from "vitest";
import { ageStatus, latencyStatus, maskHost, scrub, withTimeout, worstStatus } from "./health";

const HOUR = 3_600_000;

describe("developer connection health", () => {
  it("grades a latency and a daily job's age", () => {
    expect(latencyStatus(120)).toBe("ok");
    expect(latencyStatus(2400)).toBe("warn");
    expect(ageStatus(null, 24 * HOUR)).toBe("down");
    expect(ageStatus(24.9 * HOUR, 24 * HOUR)).toBe("ok");
    expect(ageStatus(30 * HOUR, 24 * HOUR)).toBe("warn");
    expect(ageStatus(80 * HOUR, 24 * HOUR)).toBe("down");
  });

  it("shows the worst row's colour", () => {
    expect(worstStatus(["ok", "warn", "idle"])).toBe("warn");
    expect(worstStatus(["unconfigured", "ok"])).toBe("ok");
    expect(worstStatus([])).toBe("unconfigured");
  });

  it("masks a project host and never shows a path or query", () => {
    expect(maskHost("https://rpuxabcdefghijklmunq.supabase.co/rest/v1?apikey=x")).toBe("rpux…unq.supabase.co");
    expect(maskHost("chat.teletel.io")).toBe("chat.teletel.io");
    expect(maskHost("")).toBe("");
    expect(maskHost("::not a url")).toBe("");
  });

  it("cuts our secrets out of a provider's error text", () => {
    const key = "sk-live-123456789";
    expect(scrub(`bad key ${key}\n retry ${key}`, [key, undefined, "abc"])).toBe("bad key ••• retry •••");
    expect(scrub("x".repeat(400), []).length).toBe(160);
  });

  it("gives up on a check that hangs", async () => {
    const never = new Promise<string>(() => {});
    expect(await withTimeout(never, 10, () => "late")).toBe("late");
    expect(await withTimeout(Promise.resolve("fast"), 1000, () => "late")).toBe("fast");
  });
});
