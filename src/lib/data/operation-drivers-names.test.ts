import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperationBooking } from "@/lib/data/operation-bookings";
import type { TravelerListItem } from "@/lib/operations/traveler-dto";

/**
 * The driver's programme, the arrival sign's default and the day's sheet name
 * the guest as in the passport — never the client's WhatsApp contact name
 * (the owner, 2026-10-18; «al 3r18y» on AD-2-3599).
 */

const CONTACT = "al 3r18y";
const PASSPORT = "MOHAMMED SAAD ALQAHTANI";

const state = vi.hoisted(() => ({ travelers: [] as TravelerListItem[] }));

const reception = {
  id: "b1",
  operation_id: "op1",
  kind: "transport",
  title: "المطار ← فندق طرابزون",
  city_name: "طرابزون",
  start_date: "2026-11-01",
  end_date: null,
  detail: {},
  status: "pending",
  assignee_kind: "ops",
  assignee_supplier_id: null,
  flight_legs: [],
} as unknown as OperationBooking;
const offer = { serial: "AD-2-3599", destination: "تركيا", employee_id: "emp-1", customers: { arabic_name: CONTACT } };

/** Every table answers its fixture rows; the filters are not what is under test here. */
function fakeDb() {
  const rows: Record<string, unknown[]> = {
    operation_bookings: [{ ...reception, operations: { execution_status: "pending_bookings", offers: offer } }],
    operations: [{ travel_start: "2026-11-01", travel_end: "2026-11-08", offers: offer }],
  };
  return {
    from(table: string) {
      const data = rows[table] ?? [];
      const b = {
        select: () => b,
        eq: () => b,
        in: () => b,
        neq: () => b,
        order: () => b,
        limit: () => b,
        maybeSingle: async () => ({ data: data[0] ?? null, error: null }),
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(ok),
      };
      return b;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: async () => fakeDb(), getServerUser: async () => ({ id: "u1" }) }));
vi.mock("@/lib/operations/access", () => ({
  gateRow: async () => null,
  gateOps: async () => null,
  opsAccess: async () => ({ all: true, employeeId: "emp-1" }),
  mayWork: () => true,
}));
vi.mock("@/lib/data/metrics", () => ({ getCurrentEmployeeId: async () => "emp-1" }));
vi.mock("@/lib/data/audit", () => ({ logAudit: async () => true }));
vi.mock("@/lib/data/operation-bookings", () => ({ listBookings: async () => [reception] }));
vi.mock("@/lib/data/operation-travelers", () => ({
  listTravelers: async () => state.travelers,
  listTravelersByOperation: async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, state.travelers])),
}));
vi.mock("@/lib/data/welcome-board", () => ({ getWelcomeBoard: async () => null }));
vi.mock("@/lib/providers/teletel", () => ({ conversationForPhone: async () => null, sendTeletelMessage: async () => null, sendTeletelAttachment: async () => null }));
vi.mock("@/lib/offer-doc/html", () => ({ renderDocHtml: async () => "" }));
vi.mock("@/lib/offer-doc/pdf", () => ({ offerDocumentToPdf: async () => new Uint8Array() }));

const { draftDriverProgramme, listDriverSchedule } = await import("./operation-drivers");

const traveler = (display_name: string, sort: number): TravelerListItem => ({
  id: `t${sort}`,
  traveler_kind: "adult",
  sort,
  display_name,
  name_source: display_name ? "passport" : "seed",
  passport_expiry: null,
  birth_date: null,
  age: null,
  nationality: null,
  visa_status: "not_required",
  has_passport: Boolean(display_name),
  has_scan: false,
  has_visa_file: false,
});

beforeEach(() => {
  state.travelers = [traveler("", 0), traveler(PASSPORT, 1)];
});

describe("the driver is told the passport's name", () => {
  it("in the programme's «Guest» line and the sign's default", async () => {
    const res = await draftDriverProgramme("b1");
    if (!res.ok) throw new Error(res.error);
    expect(res.draft.programme).toContain(`Guest: ${PASSPORT}`);
    expect(res.draft.programme).not.toContain(CONTACT);
    expect(res.draft.customer).toBe(PASSPORT);
  });

  it("nobody named yet: «—», not the client's contact name", async () => {
    state.travelers = [traveler("", 0)];
    const res = await draftDriverProgramme("b1");
    if (!res.ok) throw new Error(res.error);
    expect(res.draft.programme).toContain("Guest: —");
    expect(res.draft.customer).toBe("");
  });

  it("on the day's sheet copied to the drivers", async () => {
    expect((await listDriverSchedule("2026-11-01")).map((r) => r.customer)).toEqual([PASSPORT]);
  });
});
