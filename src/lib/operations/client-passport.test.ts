import { describe, expect, it } from "vitest";
import { checkPassportFile, clientPassportState, latestPending, uploadAllowed, CLIENT_PASSPORT_MAX_BYTES } from "./client-passport";

describe("the client's passport upload", () => {
  it("takes a photo or a PDF up to 8 MB, and nothing else", () => {
    expect(checkPassportFile({ size: 1000, type: "image/jpeg" })).toBeNull();
    expect(checkPassportFile({ size: 1000, type: "application/pdf" })).toBeNull();
    expect(checkPassportFile({ size: CLIENT_PASSPORT_MAX_BYTES, type: "image/png" })).toBeNull();
    expect(checkPassportFile({ size: CLIENT_PASSPORT_MAX_BYTES + 1, type: "image/png" })).toBe("too_large");
    expect(checkPassportFile({ size: 0, type: "image/png" })).toBe("empty");
    expect(checkPassportFile({ size: 1000, type: "text/html" })).toBe("type");
    expect(checkPassportFile({ size: 1000, type: "" })).toBe("type");
  });

  it("allows three uploads per traveller in any 24 hours — older ones do not count", () => {
    const now = new Date("2026-10-13T12:00:00Z");
    expect(uploadAllowed([], now)).toBe(true);
    expect(uploadAllowed(["2026-10-13T09:00:00Z", "2026-10-13T10:00:00Z"], now)).toBe(true);
    expect(uploadAllowed(["2026-10-13T09:00:00Z", "2026-10-13T10:00:00Z", "2026-10-13T11:00:00Z"], now)).toBe(false);
    expect(uploadAllowed(["2026-10-12T11:59:00Z", "2026-10-12T08:00:00Z", "2026-10-13T11:00:00Z"], now)).toBe(true);
  });

  it("tells the client only received / on file / retake — a pending upload never reads as verified", () => {
    expect(clientPassportState(false, null)).toBe("needed");
    expect(clientPassportState(false, "pending")).toBe("received");
    expect(clientPassportState(true, "pending")).toBe("received");
    expect(clientPassportState(false, "accepted")).toBe("on_file");
    expect(clientPassportState(true, null)).toBe("on_file");
    expect(clientPassportState(false, "rejected")).toBe("retake");
    // staff typed it after rejecting the photo — nothing more is asked of the client
    expect(clientPassportState(true, "rejected")).toBe("on_file");
    expect(clientPassportState(false, "superseded")).toBe("needed");
  });

  it("asks for a valid passport instead of «تم الاستلام» when operations flagged the one on file", () => {
    expect(clientPassportState(true, null, true)).toBe("update");
    expect(clientPassportState(true, "accepted", true)).toBe("update");
    // the new photo is already with us — the client is not asked twice
    expect(clientPassportState(true, "pending", true)).toBe("received");
    // nothing on file: it is simply needed, flagged or not
    expect(clientPassportState(false, null, true)).toBe("needed");
  });

  it("puts the newest pending upload of each traveller in front of staff", () => {
    const rows = [
      { id: "a1", traveler_id: "t1", status: "pending" as const, created_at: "2026-10-13T09:00:00Z" },
      { id: "a2", traveler_id: "t1", status: "pending" as const, created_at: "2026-10-13T10:00:00Z" },
      { id: "a3", traveler_id: "t1", status: "rejected" as const, created_at: "2026-10-13T11:00:00Z" },
      { id: "b1", traveler_id: "t2", status: "accepted" as const, created_at: "2026-10-13T11:00:00Z" },
    ];
    const out = latestPending(rows);
    expect(out.t1?.id).toBe("a2");
    expect(out.t2).toBeUndefined();
  });
});
