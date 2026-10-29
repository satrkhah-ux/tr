import { describe, expect, it } from "vitest";
import {
  cleanClient,
  DEFAULT_LIMITS,
  excuseAt,
  excusedMinutes,
  leaveRange,
  leaveWindow,
  overlaps,
  parseLimits,
  phoneDigits,
  riyadhDay,
  statusWindow,
  windowsOf,
} from "./excuse";

const at = (iso: string) => Date.parse(iso);
const MIN = 60_000;

describe("a leave covers whole Riyadh days", () => {
  it("from 00:00 of the first day to 00:00 after the last", () => {
    const w = leaveWindow({ starts_on: "2026-10-29", ends_on: "2026-10-30" });
    expect(w.from).toBe(at("2026-10-28T21:00:00Z"));
    expect(w.to).toBe(at("2026-10-30T21:00:00Z"));
    expect(riyadhDay(at("2026-10-28T21:30:00Z"))).toBe("2026-10-29");
  });

  it("makes ranges by days and spots two that share a day", () => {
    expect(leaveRange("2026-10-29", 1)).toEqual({ starts_on: "2026-10-29", ends_on: "2026-10-29" });
    expect(leaveRange("2026-10-30", 3)).toEqual({ starts_on: "2026-10-30", ends_on: "2026-11-01" });
    expect(overlaps({ starts_on: "2026-10-29", ends_on: "2026-10-31" }, { starts_on: "2026-10-31", ends_on: "2026-11-02" })).toBe(true);
    expect(overlaps({ starts_on: "2026-10-29", ends_on: "2026-10-30" }, { starts_on: "2026-10-31", ends_on: "2026-11-02" })).toBe(false);
  });
});

describe("a status button excuses until it is ended — never past its cap", () => {
  const s = { kind: "prayer" as const, started_at: "2026-10-29T09:00:00Z", cap_at: "2026-10-29T09:25:00Z" };
  it("an ended one stops at its end, a forgotten one at the cap", () => {
    expect(statusWindow({ ...s, ended_at: "2026-10-29T09:10:00Z" }).to).toBe(at("2026-10-29T09:10:00Z"));
    expect(statusWindow({ ...s, ended_at: null }).to).toBe(at("2026-10-29T09:25:00Z"));
    expect(statusWindow({ ...s, ended_at: "2026-10-29T11:00:00Z" }).to).toBe(at("2026-10-29T09:25:00Z"));
  });

  it("says who is excused at a moment, a leave before a button, and nothing outside", () => {
    const windows = windowsOf(
      [
        { employee_id: "a", starts_on: "2026-10-29", ends_on: "2026-10-29", cancelled_at: null },
        { employee_id: "a", starts_on: "2026-11-05", ends_on: "2026-11-06", cancelled_at: "2026-10-28T10:00:00Z" },
      ],
      [{ employee_id: "a", ...s, ended_at: null }],
    );
    expect(excuseAt(windows, at("2026-10-29T09:05:00Z"))?.reason).toBe("leave");
    expect(excuseAt(windows, at("2026-11-05T09:05:00Z"))).toBeNull();
    expect(excuseAt(windowsOf([], [{ employee_id: "a", ...s, ended_at: null }]), at("2026-10-29T09:30:00Z"))).toBeNull();
  });
});

describe("the excused minutes come out of a wait once", () => {
  it("clips to the wait and counts an overlap once", () => {
    const w = [
      { from: at("2026-10-29T09:00:00Z"), to: at("2026-10-29T09:20:00Z"), reason: "prayer" as const },
      { from: at("2026-10-29T09:10:00Z"), to: at("2026-10-29T09:40:00Z"), reason: "client" as const },
    ];
    // the client waited 09:05 → 10:00 (55 min): 09:05–09:40 was excused (35 min)
    expect(excusedMinutes(w, at("2026-10-29T09:05:00Z"), at("2026-10-29T10:00:00Z"))).toBe(35);
    expect(excusedMinutes(w, at("2026-10-29T10:00:00Z"), at("2026-10-29T10:00:00Z") + 30 * MIN)).toBe(0);
    expect(excusedMinutes([], 0, 1)).toBe(0);
  });
});

describe("the limits and the client's form", () => {
  it("keeps the limits sane", () => {
    expect(parseLimits(null)).toEqual(DEFAULT_LIMITS);
    expect(parseLimits('{"prayer":20,"client":2,"call":"x","meeting":700}')).toEqual({ ...DEFAULT_LIMITS, prayer: 20 });
    expect(parseLimits("not json")).toEqual(DEFAULT_LIMITS);
  });

  it("makes a phone findable whatever way it was typed", () => {
    expect(phoneDigits("0560 258 364")).toBe("966560258364");
    expect(phoneDigits("+966 56 025 8364")).toBe("966560258364");
    expect(phoneDigits("00966560258364")).toBe("966560258364");
    expect(phoneDigits("٠٥٦٠٢٥٨٣٦٤")).toBe("966560258364");
    expect(phoneDigits("560258364")).toBe("966560258364");
    expect([phoneDigits(""), phoneDigits("12"), phoneDigits(null)]).toEqual([null, null, null]);
  });

  it("asks for what the client wants, a name and a phone", () => {
    expect(cleanClient({ want: "بكج", name: " سالم ", phone: "0560258364", destination: "جورجيا" })).toEqual({
      ok: true,
      details: { want: "بكج", destination: "جورجيا", name: "سالم", phone: "966560258364", note: "" },
      phone: "966560258364",
    });
    expect(cleanClient({ want: "سيارة", name: "سالم", phone: "0560258364" })).toEqual({ ok: false, error: "اختر ماذا يريد العميل." });
    expect(cleanClient({ want: "بكج", name: "", phone: "0560258364" })).toMatchObject({ ok: false });
    expect(cleanClient({ want: "بكج", name: "سالم", phone: "12" })).toEqual({ ok: false, error: "اكتب رقم هاتف صحيحاً." });
  });
});
