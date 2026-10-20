import { describe, expect, it } from "vitest";
import { core, ALERT_LEAD_MS, ALERT_SHOW_MS } from "./core";
import { serviceLine } from "./config";

describe("screen alert recovery", () => {
  const events = [{ id: "101", at: 100000 }, { id: "102", at: 122000 }];
  it("recovers a late poll, including after the old nine-second window", () => {
    expect(core.nextScreenAlert(events, 160000, {}, ALERT_LEAD_MS)).toBe(0);
    expect(ALERT_SHOW_MS).toBe(20000);
  });
  it("respects the shared start and never repeats completed events", () => {
    expect(core.nextScreenAlert(events, 107999, {}, ALERT_LEAD_MS)).toBe(-1);
    expect(core.nextScreenAlert(events, 108000, {}, ALERT_LEAD_MS)).toBe(0);
    expect(core.nextScreenAlert(events, 160000, { "101": 128000 }, ALERT_LEAD_MS)).toBe(1);
    expect(core.nextScreenAlert(events, 160000, { "101": 128000, "102": 150000 }, ALERT_LEAD_MS)).toBe(-1);
  });
  it("does not replay stale requests on opening a screen", () => {
    expect(core.nextScreenAlert(events, 422001, {}, ALERT_LEAD_MS)).toBe(-1);
  });
  it("labels an inquiry honestly, without inventing a package", () => {
    expect(serviceLine("يستفسر", "إندونيسيا")).toBe("استفسار عن إندونيسيا");
  });
});
