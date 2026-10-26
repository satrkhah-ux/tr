import { describe, expect, it } from "vitest";
import type { DayItem, DayKind } from "@/lib/mine/rank";
import { parseSecretarySettings, planText, type SecretaryEmployee } from "./core";

const employee: SecretaryEmployee = { id: "e1", name: "رشا", agentId: 5, chatId: null };
const item = (kind: DayKind, name: string): DayItem => ({
  key: `${kind}:${name}`, kind, tags: [], conversationId: 1, name, phone: null, since: Date.now() - 3600_000,
  wants: null, next: null, advice: null, heat: kind === "hot" ? "hot" : null, offerLine: null, destination: null,
  followupId: null, step: null, canReply: null, preview: null, reminder: null, note: null,
});

describe("«سكرتيري الخاص» settings", () => {
  it("defaults and survives bad JSON", () => {
    const defaults = { off: false, dailyLimit: 60, suggest: { on: true, silentHours: 24, maxPerDay: 10, proposals: 2 } };
    expect(parseSecretarySettings(undefined)).toEqual(defaults);
    expect(parseSecretarySettings("not json")).toEqual(defaults);
    expect(parseSecretarySettings('{"off":true,"dailyLimit":10,"suggest":{"on":false,"silentHours":48}}')).toEqual({
      off: true, dailyLimit: 10, suggest: { on: false, silentHours: 48, maxPerDay: 10, proposals: 2 },
    });
  });
});

describe("the day plan", () => {
  it("groups in «متابعتي»'s order (waiting → silent → hot → offer → reminder) and a quiet day says so", () => {
    const items = [item("waiting", "منتظِر"), item("silent", "ساكت"), item("hot", "ساخن"), item("offer", "مستحق")];
    const text = planText(employee, { items, teletel: true });
    expect(text.indexOf("منتظِر")).toBeGreaterThan(-1);
    expect(text.indexOf("منتظِر")).toBeLessThan(text.indexOf("ساكت"));
    expect(text.indexOf("ساكت")).toBeLessThan(text.indexOf("ساخن"));
    expect(text.indexOf("ساخن")).toBeLessThan(text.indexOf("مستحق"));
    expect(text).toContain("رشا");

    const quiet = planText(employee, { items: [], teletel: true });
    expect(quiet).toContain("يوم هادئ");
    expect(planText(employee, { items: [], teletel: false })).toContain("تعذّرت قراءة تيلي تيل");
  });
});
