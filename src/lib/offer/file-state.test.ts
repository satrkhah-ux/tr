import { describe, expect, it } from "vitest";
import { canCancelFile, fileState, fileTimeline, lastSentVersion, staleSend, type FileFacts } from "./file-state";

const base: FileFacts = { serial: "AD-1", offerStatus: "sent", validUntil: "2026-10-24", sentVersion: null, version: 1, op: null, today: "2026-10-17" };

describe("fileState — one ladder for the file", () => {
  it("reads a draft, an issued file not sent yet, and one sent to the client", () => {
    expect(fileState({ ...base, serial: null, offerStatus: null, version: null })).toBe("draft");
    expect(fileState(base)).toBe("issued");
    expect(fileState({ ...base, sentVersion: 1 })).toBe("sent");
  });

  it("claims nothing about a file issued before sends were recorded — «صدر», never «لم يُرسل»", () => {
    expect(fileState({ ...base, issuedAt: "2026-10-12T09:00:00Z" })).toBe("published");
    expect(fileState({ ...base, issuedAt: "2026-10-18T09:00:00Z" })).toBe("issued");
    expect(fileState({ ...base, issuedAt: "2026-10-12T09:00:00Z", sentVersion: 2 })).toBe("sent");
  });

  it("asks for a price check once the offer's date has passed — until the client confirms", () => {
    expect(fileState({ ...base, sentVersion: 1, validUntil: "2026-10-16" })).toBe("expired");
    expect(fileState({ ...base, validUntil: "2026-10-17" })).toBe("issued");
    expect(fileState({ ...base, validUntil: "2026-10-16", offerStatus: "confirmed" })).toBe("confirmed");
  });

  it("follows the operation once the client confirmed: payments, ready, travelled", () => {
    const op = (client_status: never, execution_status: never) => ({ ...base, offerStatus: "confirmed" as const, op: { client_status, execution_status } });
    expect(fileState(op("confirmed" as never, "pending_bookings" as never))).toBe("confirmed");
    expect(fileState(op("paid_partial" as never, "hotels_booked" as never))).toBe("paid_partial");
    expect(fileState(op("paid_full" as never, "vouchers_issued" as never))).toBe("paid_full");
    expect(fileState(op("paid_full" as never, "ready_to_travel" as never))).toBe("ready");
    expect(fileState(op("completed" as never, "travelled" as never))).toBe("travelled");
  });

  it("puts a cancellation over everything", () => {
    expect(fileState({ ...base, offerStatus: "cancelled", sentVersion: 1 })).toBe("cancelled");
    expect(fileState({ ...base, offerStatus: "confirmed", op: { client_status: "paid_full", execution_status: "cancelled" } })).toBe("cancelled");
  });

  it("says when the client has an older version than the file", () => {
    expect(staleSend({ sentVersion: 1, version: 2 })).toBe(true);
    expect(staleSend({ sentVersion: 2, version: 2 })).toBe(false);
    expect(staleSend({ sentVersion: null, version: 2 })).toBe(false);
  });
});

describe("what was really sent, and the file's history", () => {
  const audits = [
    { action: "offer.client_sent", meta: { result: "window", version: 2 }, created_at: "2026-10-17T10:00:00Z", by: "أحمد" },
    { action: "offer.client_sent", meta: { result: "sent", version: 1 }, created_at: "2026-10-16T09:00:00Z", by: "أحمد" },
    { action: "offer.reissued", meta: { version: 2 }, created_at: "2026-10-17T09:30:00Z", by: "أحمد" },
  ];

  it("counts a send or a manual one — never a note left outside WhatsApp's 24 hours", () => {
    expect(lastSentVersion(audits)).toBe(1);
    expect(lastSentVersion([...audits, { action: "offer.client_sent", meta: { result: "manual", version: 2 } }])).toBe(2);
    expect(lastSentVersion([])).toBeNull();
    // outside the 24 hours the approved template went: the client has that version
    expect(lastSentVersion([...audits, { action: "offer.client_sent", meta: { result: "template", version: 3 } }])).toBe(3);
  });

  it("merges the status history, the audit rows and each new version, newest first", () => {
    const line = fileTimeline(
      [{ to_status: "sent", note: "published v1", created_at: "2026-10-16T08:00:00Z", by: null }],
      [...audits, { action: "operation.cancelled", meta: null, created_at: "2026-10-18T08:00:00Z", by: "سارة" }],
      [
        { version: 1, at: "2026-10-16T08:00:00Z", by: null },
        { version: 2, at: "2026-10-17T09:30:00Z", by: "أحمد" },
      ],
    );
    // the version comes from its render, once — not again from offer.reissued
    expect(line.map((e) => e.key)).toEqual(["cancelled", "sentWindow", "reissued", "sent", "issued"]);
    expect(line.find((e) => e.key === "reissued")).toMatchObject({ version: 2, by: "أحمد" });
  });
});

describe("canCancelFile — only before operations hold the file", () => {
  it("lets an employee cancel an issued file nobody confirmed; refuses a partner's or a confirmed one", () => {
    expect(canCancelFile({ partner: false, hasCase: false, state: "sent" })).toBe("ok");
    expect(canCancelFile({ partner: true, hasCase: false, state: "sent" })).toBe("partner");
    expect(canCancelFile({ partner: false, hasCase: true, state: "confirmed" })).toBe("inOperations");
    expect(canCancelFile({ partner: false, hasCase: false, state: "cancelled" })).toBe("already");
  });
});
