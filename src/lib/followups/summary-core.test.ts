import { expect, it } from "vitest";
import { parseSummary, renderThread, toSummaryMsg, unheardAfterUs } from "./summary-core";

const base = { upto: 1, seen: 1, step: 1, at: "2026-10-23T00:00:00Z", unheard: false };
const answer = { wants: "موسكو 10–16 ديسمبر", destination: "موسكو", people: "1", dates: "10–16 ديسمبر", offered: "7650 ريال", stopped: "ننتظره", waiting_on: "client", heat: "warm", heat_why: "سأل", next: "message", advice: "تابعه", draft: "حياك الله…" };

it("keeps a checked summary, and never a draft over a voice note nobody heard", () => {
  expect(parseSummary(JSON.stringify(answer), base)).toMatchObject({ heat: "warm", draft: "حياك الله…" });
  expect(parseSummary(JSON.stringify(answer), { ...base, unheard: true })?.draft).toBe("");
  expect(parseSummary(JSON.stringify({ ...answer, heat: "boiling" }), base)).toBeNull();
  expect(parseSummary("not json", base)).toBeNull();
});

it("names a client's voice note after our last message as unheard", () => {
  const msgs = [
    toSummaryMsg({ id: 1, created_at: 10, message_type: 1, content: "السعر 7650 ريال" }),
    toSummaryMsg({ id: 2, created_at: 20, message_type: 0, content: null, attachments: [{ file_type: "audio", data_url: "x.ogg" }] }),
  ].filter((m) => m !== null);
  expect(unheardAfterUs(msgs)).toBe(true);
  expect(renderThread(msgs)).toContain("[رسالة صوتية لم تُسمع]");
  expect(unheardAfterUs([...msgs, { at: 30, text: "وصلت؟", fromClient: false, audio: false }])).toBe(false);
});
