import { describe, expect, it } from "vitest";
import type { OperationCard } from "@/lib/data/operations";
import type { TravelerListItem } from "@/lib/operations/traveler-dto";
import { calmDone, calmRows, calmUrgency, nextNow } from "./calm";
import type { WizardCase } from "./types";

/** Every name and reference in the fixtures is invented. */
const TODAY = "2026-10-17";

const op = (over: Partial<OperationCard> = {}): OperationCard => ({
  id: "op1", offer_id: "of1", render_id: null, client_status: "confirmed", execution_status: "pending_bookings",
  travel_start: "2026-11-10", travel_end: "2026-11-16", confirm_channel: "phone", confirmed_at: "2026-10-01T09:00:00Z",
  note: null, serial: "AD-2-7287", destination: "تركيا", customer_name: "عميل", customer_phone: null,
  total: 10000, currency: "SAR", paid: 0, travelers_count: 2, partner_name: null, partner_id: null, ...over,
});

const traveler = (over: Partial<TravelerListItem> = {}): TravelerListItem => ({
  id: "t1", traveler_kind: "adult", sort: 0, display_name: "", passport_expiry: "2030-01-01", birth_date: "1990-05-05",
  age: null, nationality: "SAU", visa_status: "not_required", has_passport: true, has_scan: true, has_visa_file: false, ...over,
});

const wizardCase = (over: Partial<WizardCase> = {}): WizardCase => ({
  operation: op(), travelers: [traveler()], bookings: [], payments: [], installments: [], documents: [],
  supplierWork: null, clientToken: null, waits: {}, readyExceptions: {}, hasDays: true, today: TODAY,
  sold: { adults: 1, children: 0, infants: 0 }, guide: null, ...over,
});

describe("«التالي الآن» (the owner, 2026-10-26)", () => {
  it("offers exactly one next thing — the first mandatory gap in step order", () => {
    const next = nextNow(wizardCase());
    expect(next).not.toBeNull();
    // a fresh file's first gap sits in the earliest step that has one
    expect(next!.item).not.toBeNull();
    expect(next!.item!.ok).toBe(false);
    expect(next!.item!.optional ?? false).toBe(false);
  });

  it("the quiet list leaves the next step out and counts the rest of each step's gaps", () => {
    const data = wizardCase();
    const next = nextNow(data)!;
    const rows = calmRows(data, next.step);
    expect(rows.some((r) => r.step === next.step)).toBe(false);
    for (const r of rows) if (r.more > 0) expect(r.first).not.toBeNull();
  });

  it("red only when travel is on top of us", () => {
    expect(calmUrgency("2026-11-10", TODAY)).toBe("normal");
    expect(calmUrgency("2026-10-23", TODAY)).toBe("soon");
    expect(calmUrgency("2026-10-19", TODAY)).toBe("late");
    expect(calmUrgency("2026-10-10", TODAY)).toBe("late");
    expect(calmUrgency(null, TODAY)).toBe("normal");
  });

  it("a finished step folds into the ✓ line", () => {
    const data = wizardCase();
    const done = calmDone(data);
    const rows = calmRows(data);
    const next = nextNow(data);
    const all = new Set([...done.map((d) => d.step), ...rows.map((r) => r.step)]);
    if (next) all.add(next.step);
    expect(all.size).toBe(6);
  });
});
