import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VoucherDTO } from "@/lib/operations/voucher-dto";

/**
 * «اسم الواتساب ليس اسم الجواز» (the owner, 2026-10-18; AD-2-3599): the
 * client's contact name — the WhatsApp name on the customer — never names a
 * traveller, and the passport's name is the one every paper and message prints.
 * Each builder runs against an in-memory database whose customer is «al 3r18y».
 */

const CONTACT = "al 3r18y";
const PASSPORT = "MOHAMMED SAAD ALQAHTANI";

type Row = Record<string, unknown>;
const state = vi.hoisted(() => {
  // the vault, so a passport blob can be saved like in production
  process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  return { tables: {} as Record<string, Record<string, unknown>[]>, updates: [] as { table: string; patch: Record<string, unknown> }[] };
});

/** select/insert/update with eq/in/is/neq filters — enough for the builders under test. */
function fakeDb() {
  return {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let insert: Row | Row[] | null = null;
      let patch: Row | null = null;
      const run = (): { data: Row[]; error: null } => {
        const all = (state.tables[table] ??= []);
        if (insert) {
          const made = (Array.isArray(insert) ? insert : [insert]).map((r) => ({ id: `${table}-${all.length + 1}`, ...r }));
          all.push(...made);
          return { data: made, error: null };
        }
        const hit = all.filter((r) => filters.every((f) => f(r)));
        if (patch) {
          for (const r of hit) Object.assign(r, patch);
          state.updates.push({ table, patch });
        }
        return { data: hit, error: null };
      };
      const b = {
        select: () => b,
        order: () => b,
        limit: () => b,
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
        neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), b),
        in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), b),
        is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
        insert: (r: Row | Row[]) => ((insert = r), b),
        update: (p: Row) => ((patch = p), b),
        maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
        single: async () => {
          const row = run().data[0];
          return row ? { data: row, error: null } : { data: null, error: { message: "no row" } };
        },
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, ko),
      };
      return b;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  getServerUser: async () => ({ id: "user-1", email: "ops@traveliun.com" }),
  createSupabaseServerClient: async () => fakeDb(),
  createSupabaseServiceClient: () => fakeDb(),
}));
vi.mock("@/lib/operations/access", () => ({ gateOperation: async () => null, gateRow: async () => null, gateRows: async () => null }));
vi.mock("@/lib/roles/current", () => ({ currentCan: async () => true }));
vi.mock("@/lib/data/audit", () => ({ logAudit: async () => true }));
vi.mock("@/lib/data/ops-notify", () => ({ notifyPartnerCase: async () => undefined, notifyOps: async () => undefined, notifyBookingChanged: async () => undefined }));
vi.mock("@/lib/data/operation-sync", () => ({ syncOperationOfBooking: async () => undefined }));
vi.mock("@/lib/partners/session", () => ({ isStaffSession: async () => true, getPartnerSession: async () => null }));
vi.mock("@/lib/data/doc-brand", () => ({
  resolveDocBrand: async () => ({ brand: { font: "tajawal", nameAr: "ترافليون", nameLatin: "Traveliun", logoUrl: null, vars: null } }),
}));

const { upsertTraveler } = await import("./operation-travelers");
const { issueDocumentNow } = await import("./document-issue");
const { getWelcomeBoard } = await import("./welcome-board");
const { getDriverDay, getSupplierLinkView } = await import("./public-links");

const TOKEN = "T".repeat(32);
const offer = { serial: "AD-2-3599", destination: "تركيا", adults: 2, children: 0, infants: 0, customers: { arabic_name: CONTACT, mobile: "+966500000000" } };

beforeEach(() => {
  state.updates = [];
  state.tables = {
    offers: [{ id: "of1", serial: "AD-2-3599", destination: "تركيا", partner_company_id: null, customers: offer.customers }],
    operations: [{ id: "op1", offer_id: "of1", offers: offer }],
    // traveller 1 still unnamed, traveller 2's passport read
    operation_travelers: [
      { id: "t1", operation_id: "op1", sort: 0, display_name: "", name_source: "seed", traveler_kind: "adult", nationality: null },
      { id: "t2", operation_id: "op1", sort: 1, display_name: PASSPORT, name_source: "passport", traveler_kind: "adult", nationality: "SAU" },
    ],
    operation_bookings: [
      {
        id: "b1",
        operation_id: "op1",
        kind: "transport",
        status: "confirmed",
        title: "المطار ← فندق طرابزون",
        city_name: "طرابزون",
        start_date: "2026-11-01",
        end_date: null,
        detail: { "جوال السائق": "+90 555 111 2233" },
        confirmation_number: "TR-1",
        supplier_name: "",
        cancellation_policy: null,
        is_paid: false,
        company_ref: null,
        handoff_note: null,
        assignee_supplier_id: "s1",
        operations: { execution_status: "pending_bookings", offers: offer },
        company_suppliers: { arabic_name: "وكيل طرابزون", contact_name: null, request_lang: "ar" },
      },
    ],
    offer_days: [],
    operation_documents: [],
    operation_links: [
      { id: "l1", token: TOKEN, kind: "supplier", booking_id: "b1", supplier_id: "s1", driver_phone: null, driver_name: null, service_date: null, expires_at: "2099-01-01T00:00:00Z", revoked_at: null },
      { id: "l2", token: "D".repeat(32), kind: "driver", booking_id: null, supplier_id: null, driver_phone: "00905551112233", driver_name: "Murat", service_date: "2026-11-01", expires_at: "2099-01-01T00:00:00Z", revoked_at: null },
    ],
  };
});

const traveler = (id: string) => state.tables.operation_travelers.find((t) => t.id === id)!;
const passport = { full_name: PASSPORT, number: "A1234567", nationality: "SAU" };

describe("a passport read names the traveller (upsertTraveler → savedName)", () => {
  it("replaces a name seeded from the client's contact name", async () => {
    Object.assign(traveler("t1"), { display_name: CONTACT, name_source: "seed" });
    // the bulk step sends the row's name as it is, and the passport
    const res = await upsertTraveler({ id: "t1", operation_id: "op1", display_name: CONTACT, passport_name: PASSPORT, passport });
    expect(res.ok).toBe(true);
    expect(traveler("t1")).toMatchObject({ display_name: PASSPORT, name_source: "passport" });
  });

  it("keeps a name a person typed, and takes the passport's only when asked («استبدال بالاسم من الجواز»)", async () => {
    Object.assign(traveler("t1"), { display_name: "محمد", name_source: "manual" });
    await upsertTraveler({ id: "t1", operation_id: "op1", display_name: "محمد", passport_name: PASSPORT, passport });
    expect(traveler("t1")).toMatchObject({ display_name: "محمد", name_source: "manual" });
    expect(state.updates.some((u) => "name_source" in u.patch)).toBe(false);

    await upsertTraveler({ id: "t1", operation_id: "op1", display_name: PASSPORT, passport_name: PASSPORT });
    expect(traveler("t1")).toMatchObject({ display_name: PASSPORT, name_source: "passport" });
  });

  it("asks rather than overwrites a name of unknown source (a database before 0091)", async () => {
    const legacy = traveler("t1");
    delete legacy.name_source;
    legacy.display_name = CONTACT;
    await upsertTraveler({ id: "t1", operation_id: "op1", display_name: CONTACT, passport_name: PASSPORT });
    expect(legacy.display_name).toBe(CONTACT);
  });

  it("names a traveller the case did not have from the passport", async () => {
    const res = await upsertTraveler({ operation_id: "op1", display_name: "", passport_name: PASSPORT, sort: 2 });
    expect(res.ok && traveler(res.id)).toMatchObject({ display_name: PASSPORT, name_source: "passport" });
  });
});

describe("a passport typed by hand is checked on the server (AD-2-3599)", () => {
  it("refuses a birth date in the future and an Arabic passport number, and saves nothing", async () => {
    const before = { ...traveler("t1") };
    expect(await upsertTraveler({ id: "t1", operation_id: "op1", display_name: "", birth_date: "2999-01-01" })).toEqual({ ok: false, error: "ops.trav.err.birthFuture" });
    expect(await upsertTraveler({ id: "t1", operation_id: "op1", display_name: "", passport: { ...passport, number: "سش" } })).toEqual({
      ok: false,
      error: "ops.trav.err.passportNo",
    });
    expect(traveler("t1")).toEqual(before);
  });

  it("stores the number as checked: upper case, no spaces", async () => {
    const { decryptJson } = await import("@/lib/crypto/secrets");
    expect((await upsertTraveler({ id: "t1", operation_id: "op1", display_name: "", passport: { ...passport, number: "a12 345 67" } })).ok).toBe(true);
    expect(decryptJson<{ number: string }>(traveler("t1").passport_encrypted as string)?.number).toBe("A1234567");
  });
});

describe("every paper and message prints the passport's name, never the contact name", () => {
  const issued = () => state.tables.operation_documents.at(-1)!.snapshot_json as VoucherDTO;

  it("the issued documents: the lead guest, the travellers, the arrival sign", async () => {
    expect((await issueDocumentNow({ operation_id: "op1", kind: "booking_summary" }, null)).ok).toBe(true);
    expect(issued().customer.name).toBe(PASSPORT);
    expect(issued().travelers.map((t) => t.name)).toEqual(["", PASSPORT]);

    expect((await issueDocumentNow({ operation_id: "op1", kind: "welcome_board" }, null)).ok).toBe(true);
    expect(issued().welcome_name).toBe(PASSPORT);
    expect(JSON.stringify(state.tables.operation_documents)).not.toContain(CONTACT);
  });

  it("the arrival sign printed on demand", async () => {
    const board = await getWelcomeBoard("AD-2-3599");
    expect(board).toMatchObject({ defaultName: PASSPORT, board: { name: PASSPORT } });
    // nobody named yet: the serial, not the contact name
    traveler("t2").display_name = "";
    expect((await getWelcomeBoard("AD-2-3599"))?.board.name).toBe("AD-2-3599");
  });

  it("the supplier's link under «الأسماء كما في الجواز»", async () => {
    const view = await getSupplierLinkView(TOKEN);
    expect(view?.body).toContain(PASSPORT);
    expect(view?.body).not.toContain(CONTACT);
    // nobody on the case yet: «تُرسل لاحقاً», not the client in their place
    state.tables.operation_travelers = [];
    const later = await getSupplierLinkView(TOKEN);
    expect(later?.body).toContain("الأسماء تُرسل لاحقاً");
    expect(later?.body).not.toContain(CONTACT);
  });

  it("the driver's day: who to look for in arrivals", async () => {
    const day = await getDriverDay("D".repeat(32));
    expect(day?.pickups.map((p) => p.lead)).toEqual([PASSPORT]);
  });
});
