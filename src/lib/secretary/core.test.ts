import { describe, expect, it } from "vitest";
import type { WorkRow } from "@/lib/followups/rules";
import { parseSecretarySettings, planText, type SecretaryBriefing, type SecretaryEmployee } from "./core";

const employee: SecretaryEmployee = { id: "e1", name: "رشا", agentId: 5, chatId: null };
const row = (over: Partial<WorkRow>): WorkRow => ({
  id: "f1", conversation_id: 100, contact_name: "أبو فهد", contact_phone: null, status: "open", stage: "working",
  assigned_to: "e1", assigned_at: null, request_started_at: "", created_at: "", next_followup_at: null, first_followed_at: null,
  last_attempt_at: null, last_client_at: null, last_synced_at: null, source: "teletel", source_team_id: null, transfer_reason: null,
  outcome: null, external_status: null, attempt_count: 0, send_lock: null, done_at: null, offer_id: null, offer_at: null,
  offer_line: null, destination: null, step: 1, client_line: null, client_waiting: false, close_reason: null,
  summary: null, last_line: null, last_by: null, murad_note_at: null, ...over,
} as WorkRow);

describe("«سكرتيري الخاص» settings", () => {
  it("defaults and survives bad JSON", () => {
    expect(parseSecretarySettings(undefined)).toEqual({ off: false, dailyLimit: 60 });
    expect(parseSecretarySettings("not json")).toEqual({ off: false, dailyLimit: 60 });
    expect(parseSecretarySettings('{"off":true,"dailyLimit":10}')).toEqual({ off: true, dailyLimit: 10 });
  });
});

describe("the day plan", () => {
  it("orders: who replied, then hot, then due — and a quiet day says so", () => {
    const b: SecretaryBriefing = {
      followups: [], conversations: [],
      clientWaiting: [row({ id: "w", contact_name: "منتظِر" })],
      hot: [row({ id: "h", contact_name: "ساخن" })],
      dueToday: [row({ id: "d", contact_name: "مستحق" })],
    };
    const text = planText(employee, b);
    expect(text.indexOf("منتظِر")).toBeGreaterThan(-1);
    expect(text.indexOf("منتظِر")).toBeLessThan(text.indexOf("ساخن"));
    expect(text.indexOf("ساخن")).toBeLessThan(text.indexOf("مستحق"));
    expect(text).toContain("رشا");

    const quiet = planText(employee, { followups: [], conversations: [], clientWaiting: [], hot: [], dueToday: [] });
    expect(quiet).toContain("يوم هادئ");
  });
});
