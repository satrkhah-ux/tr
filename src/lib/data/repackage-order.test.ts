import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepackageData } from "@/lib/repackage/repackage-types";
import { ADDITION_PRICE, georgiaData, georgiaPackage, SELL, SUPPLIER_COST } from "@/lib/repackage/fixture";
import { fakeDb, type Row } from "@/test/fake-db";

/**
 * After a repackage is issued (the owner, 2026-10-26): the client's confirmation
 * through Basic's own confirmOffer — once —, ONE order message for the supplier,
 * prepared and sent only from a button, and the file's accounts.
 */

const state = vi.hoisted(() => ({
  can: { "offers.write": true, "operations.write": false, "dashboard.admin": false, "pricing.internal": true } as Record<string, boolean>,
  me: "emp-1",
  record: null as { id: string; data: unknown; updated_at: string } | null,
  tables: {} as Record<string, Record<string, unknown>[]>,
  confirmed: [] as { offer_id: string; channel?: string }[],
  sent: [] as Record<string, unknown>[],
  sendResult: { ok: true } as { ok: boolean; error?: string },
  stored: [] as Record<string, unknown>[],
  pulls: [] as string[],
  whatsapp: true,
  loaded: null as unknown,
  audits: [] as { action: string }[],
}));

vi.mock("@/lib/supabase/server", () => ({
  getServerUser: async () => ({ id: "user-1", email: "agent@example.test" }),
  createSupabaseServiceClient: () => fakeDb(state.tables),
}));
vi.mock("@/lib/roles/current", () => ({
  currentCan: async (p: string) => Boolean(state.can[p]),
  currentCanOpen: async () => true,
}));
vi.mock("@/lib/operations/access", () => ({ gateOperation: async () => null }));
vi.mock("@/lib/providers/teletel", () => ({ conversationForPhone: async () => (state.whatsapp ? 77 : null) }));
vi.mock("./file-status-core", () => ({
  loadFileStatus: async () => ({ offer: state.tables.offers[0], operation: state.tables.operations[0] ?? null, state: state.tables.operations[0] ? "confirmed" : "sent", version: 2 }),
}));
vi.mock("./operations", () => ({
  confirmOffer: async (i: { offer_id: string; channel?: string }) => {
    state.confirmed.push(i);
    // the case opens: the next look finds it
    state.tables.operations.push({ id: "op-1", offer_id: i.offer_id });
    return { ok: true, id: "op-1" };
  },
}));
vi.mock("./metrics", () => ({ getCurrentEmployeeId: async () => state.me }));
vi.mock("./audit", () => ({ logAudit: async (a: { action: string }) => (state.audits.push(a), true) }));
vi.mock("./operation-assign", () => ({
  sendBookingRequest: async (i: Record<string, unknown>) => (state.sent.push(i), state.sendResult),
}));
vi.mock("./offer-pull", () => ({
  pullBookingsFromOffer: async (id: string) => {
    state.pulls.push(id);
    state.tables.operation_bookings.push({ id: "line-1", operation_id: id, origin_ref: "package:offer-1", request_status: null, request_sent_at: null, assignee_kind: "ops", status: "pending" });
    return { ok: true };
  },
}));
vi.mock("./operation-money", () => ({ loadCases: async () => state.loaded }));
vi.mock("./rates-actions", () => ({ getRates: async () => ({ sarPer: { SAR: 1, USD: 3.75 }, source: "fallback", updatedAt: "2026-10-26" }) }));
vi.mock("./repackage-store", () => ({
  loadRepackage: async () => (state.record ? { ...state.record, data: structuredClone(state.record.data) } : null),
  writeRepackageStages: async (_id: string, slices: Record<string, unknown>) => (state.stored.push(slices), { ok: true }),
}));

const { getRepackageFile, confirmRepackageOrder, prepareSupplierOrder, saveSupplierContact, sendSupplierOrder, getRepackageAccounts } = await import("./repackage-order");

const issued = (over: Partial<RepackageData> = {}) => georgiaData({ produced_serial: "AD-1-1000-20261026", ...over });
const line = (over: Row = {}): Row => ({ id: "line-1", operation_id: "op-1", origin_ref: "package:offer-1", request_status: null, request_sent_at: null, assignee_kind: "ops", status: "pending", ...over });
const supplier = (over: Row = {}): Row => ({
  id: "sup-1",
  arabic_name: "مورّد تجريبي",
  english_name: null,
  contact_name: null,
  mobile: null,
  whatsapp: null,
  email: null,
  request_lang: "ar",
  status: "Active",
  ...over,
});

beforeEach(() => {
  state.can = { "offers.write": true, "operations.write": false, "dashboard.admin": false, "pricing.internal": true };
  state.me = "emp-1";
  state.record = { id: "imp-1", data: issued(), updated_at: "" };
  state.tables = {
    offers: [{ id: "offer-1", serial: "AD-1-1000-20261026", status: "sent", employee_id: "emp-1", partner_company_id: null }],
    operations: [],
    operation_bookings: [],
    operation_travelers: [],
    company_suppliers: [],
  };
  state.confirmed = [];
  state.sent = [];
  state.sendResult = { ok: true };
  state.stored = [];
  state.pulls = [];
  state.whatsapp = true;
  state.loaded = null;
  state.audits = [];
});

/** the case is open, the supplier's package line is on it */
const confirmedCase = (lineOver: Row = {}) => {
  state.tables.operations = [{ id: "op-1", offer_id: "offer-1" }];
  state.tables.operation_bookings = [line(lineOver)];
};

describe("«تأكيد الطلب» — Basic's confirmation, once", () => {
  it("confirms through confirmOffer, the one the kanban and «العميل أكّد» use, with the channel asked", async () => {
    expect(await confirmRepackageOrder("imp-1", "phone")).toEqual({ ok: true, operationId: "op-1", canOpen: true, already: false });
    expect(state.confirmed).toEqual([{ offer_id: "offer-1", channel: "phone" }]);
  });

  it("never twice: a file whose case is open answers with it and confirms nothing again", async () => {
    await confirmRepackageOrder("imp-1", "whatsapp");
    expect(await confirmRepackageOrder("imp-1", "office")).toEqual({ ok: true, operationId: "op-1", canOpen: true, already: true });
    expect(state.confirmed).toHaveLength(1);
  });

  it("a cancelled offer is not confirmed back to life", async () => {
    state.tables.offers[0].status = "cancelled";
    expect(await confirmRepackageOrder("imp-1", "phone")).toEqual({ ok: false, error: "cancelled" });
    expect(state.confirmed).toEqual([]);
  });

  it("is Basic's gate: offers.write, and a colleague's file only for its owner, operations or a manager", async () => {
    state.tables.offers[0].employee_id = "emp-2";
    expect(await confirmRepackageOrder("imp-1", "phone")).toEqual({ ok: false, error: "forbidden" });
    state.can["operations.write"] = true;
    expect(await confirmRepackageOrder("imp-1", "phone")).toMatchObject({ ok: true });
    state.can["offers.write"] = false;
    state.tables.operations = [];
    expect(await confirmRepackageOrder("imp-1", "phone")).toEqual({ ok: false, error: "forbidden" });
  });

  it("a file not yet issued has nothing to confirm", async () => {
    state.record = { id: "imp-1", data: georgiaData(), updated_at: "" };
    expect(await confirmRepackageOrder("imp-1", "phone")).toEqual({ ok: false, error: "notIssued" });
  });

  it("says where the file stands: its serial, version and whether the case is open", async () => {
    expect(await getRepackageFile("imp-1")).toMatchObject({ ok: true, serial: "AD-1-1000-20261026", version: 2, state: "sent", operationId: null, canAct: true });
    await confirmRepackageOrder("imp-1", "phone");
    expect(await getRepackageFile("imp-1")).toMatchObject({ state: "confirmed", operationId: "op-1", canOpenCase: true });
  });
});

describe("the supplier's order — prepared, reviewed, then sent from a button", () => {
  it("is for a confirmed file with a supplier price only", async () => {
    expect(await prepareSupplierOrder("imp-1")).toEqual({ ok: false, error: "notConfirmed" });
    confirmedCase();
    state.record = { id: "imp-1", data: issued({ extracted: georgiaPackage({ supplier_total: null }) }), updated_at: "" };
    expect(await prepareSupplierOrder("imp-1")).toEqual({ ok: false, error: "noCost" });
  });

  it("a registered supplier with a contact: the message is ready for its number, in its language, and nothing is sent", async () => {
    confirmedCase();
    state.tables.company_suppliers = [supplier({ whatsapp: "0500000009", contact_name: "أحمد" })];
    const draft = await prepareSupplierOrder("imp-1");
    if (!draft.ok) throw new Error("not prepared");
    expect(draft).toMatchObject({ supplier: { registered: true, reachable: true }, to_label: "مورّد تجريبي", to_phone: "0500000009", canSendWhatsapp: true, sentAt: null, choices: [] });
    expect(draft.body).toContain("السلام عليكم أحمد،");
    expect(draft.body).toContain("مرجعنا: AD-1-1000-20261026");
    expect(draft.body).toContain("المبلغ المستحق لكم: 7,391.5 SAR");
    // PREPARE → review → send: preparing sends nothing
    expect(state.sent).toEqual([]);
  });

  it("carries every detail — and never the sell price, an addition's price or the profit", async () => {
    confirmedCase();
    state.tables.company_suppliers = [supplier({ whatsapp: "0500000009" })];
    state.tables.operation_travelers = [{ operation_id: "op-1", display_name: "مسافر أول", traveler_kind: "adult", sort: 1 }];
    const draft = await prepareSupplierOrder("imp-1");
    if (!draft.ok) throw new Error("not prepared");
    for (const must of ["عميل تجريبي — 0500000000", "Twenties Hotel", "Sea Pearl", "2026-11-10 → 2026-11-15", "1. مسافر أول (بالغ)", "• الإفطار اليومي", "• جولة نهرية"]) expect(draft.body).toContain(must);
    for (const secret of [String(SELL), String(SELL + ADDITION_PRICE), String(ADDITION_PRICE), "8,500", "8,820", "الربح", "profit"]) expect(draft.body).not.toContain(secret);
  });

  it("a supplier with no contact data is told plainly: the message is there to copy, and the registry is offered to choose from", async () => {
    confirmedCase();
    state.tables.company_suppliers = [supplier(), supplier({ id: "sup-2", arabic_name: "مورّد آخر" })];
    const draft = await prepareSupplierOrder("imp-1");
    if (!draft.ok) throw new Error("not prepared");
    expect(draft.supplier).toMatchObject({ registered: true, reachable: false });
    expect(draft.to_phone).toBeNull();
    expect(draft.canSendWhatsapp).toBe(false);
    expect(draft.choices.map((c) => c.id)).toEqual(["sup-1", "sup-2"]);
    expect(draft.body).toContain("المبلغ المستحق لكم");
  });

  it("a supplier that is not registered at all: the same message, to copy and send by hand", async () => {
    confirmedCase();
    const draft = await prepareSupplierOrder("imp-1");
    if (!draft.ok) throw new Error("not prepared");
    expect(draft.supplier).toMatchObject({ name: "مورّد تجريبي", registered: false, reachable: false });
    expect(draft.to_label).toBe("مورّد تجريبي");
    expect(draft.body).toContain("طلب تأكيد باقة");
  });

  it("a case opened before the package line existed gets it now, once", async () => {
    state.tables.operations = [{ id: "op-1", offer_id: "offer-1" }];
    const draft = await prepareSupplierOrder("imp-1");
    expect(draft.ok).toBe(true);
    expect(state.pulls).toEqual(["op-1"]);
    await prepareSupplierOrder("imp-1");
    expect(state.pulls).toHaveLength(1);
  });

  it("says when it was sent before, so a second send is asked about", async () => {
    confirmedCase({ request_status: "sent", request_sent_at: "2026-10-26T09:00:00Z" });
    const draft = await prepareSupplierOrder("imp-1");
    expect(draft).toMatchObject({ ok: true, sentAt: "2026-10-26T09:00:00Z" });
  });

  it("sends the text the employee reviewed through the case's own channel, on the package line", async () => {
    confirmedCase();
    expect(await sendSupplierOrder("imp-1", { channel: "whatsapp", to_label: "مورّد تجريبي", to_phone: "0500000009", body: "  النص بعد المراجعة  " })).toEqual({ ok: true });
    expect(state.sent).toEqual([{ booking_id: "line-1", operation_id: "op-1", channel: "whatsapp", to_label: "مورّد تجريبي", to_phone: "0500000009", body: "النص بعد المراجعة" }]);
    // sent by hand: logged on the case all the same
    await sendSupplierOrder("imp-1", { channel: "manual", to_label: "مورّد تجريبي", to_phone: null, body: "نص" });
    expect(state.sent[1]).toMatchObject({ channel: "manual", booking_id: "line-1" });
  });

  it("refuses an empty text, an unconfirmed file, a cancelled one — and reports the channel's own refusal", async () => {
    expect(await sendSupplierOrder("imp-1", { channel: "manual", to_label: "م", to_phone: null, body: "نص" })).toEqual({ ok: false, error: "notConfirmed" });
    confirmedCase();
    expect(await sendSupplierOrder("imp-1", { channel: "manual", to_label: "م", to_phone: null, body: "   " })).toEqual({ ok: false, error: "empty" });
    state.sendResult = { ok: false, error: "ops.err.noConversation" };
    expect(await sendSupplierOrder("imp-1", { channel: "whatsapp", to_label: "م", to_phone: "05", body: "نص" })).toEqual({ ok: false, error: "failed" });
    state.tables.offers[0].status = "cancelled";
    expect(await sendSupplierOrder("imp-1", { channel: "manual", to_label: "م", to_phone: null, body: "نص" })).toEqual({ ok: false, error: "cancelled" });
  });
});

describe("the supplier's contact — typed or chosen once, kept on the supplier", () => {
  beforeEach(() => confirmedCase());

  it("a registered supplier gets only what it lacks; a saved number is never overwritten; the file is linked and the line handed to it", async () => {
    state.tables.company_suppliers = [supplier({ contact_name: "المسؤول القديم", mobile: "0500000001", whatsapp: "0500000001" })];
    expect(await saveSupplierContact("imp-1", { contact_name: "اسم جديد", phone: "0599999999", email: "s@example.test" })).toEqual({ ok: true, supplierId: "sup-1" });
    expect(state.tables.company_suppliers[0]).toMatchObject({ contact_name: "المسؤول القديم", mobile: "0500000001", whatsapp: "0500000001", email: "s@example.test" });
    expect((state.stored[0].source as { company_supplier_id: string }).company_supplier_id).toBe("sup-1");
    expect(state.tables.operation_bookings[0]).toMatchObject({ assignee_kind: "supplier", assignee_supplier_id: "sup-1" });
  });

  it("a supplier the registry does not know is made under the name the import carried", async () => {
    expect(await saveSupplierContact("imp-1", { contact_name: "سعيد", phone: "0500000005", email: "", lang: "en" })).toMatchObject({ ok: true });
    expect(state.tables.company_suppliers).toHaveLength(1);
    expect(state.tables.company_suppliers[0]).toMatchObject({ arabic_name: "مورّد تجريبي", contact_name: "سعيد", mobile: "0500000005", whatsapp: "0500000005", request_lang: "en" });
    const id = state.tables.company_suppliers[0].id;
    expect(state.tables.operation_bookings[0]).toMatchObject({ assignee_kind: "supplier", assignee_supplier_id: id });
  });

  it("a supplier chosen from the registry is the one linked", async () => {
    state.tables.company_suppliers = [supplier(), supplier({ id: "sup-2", arabic_name: "مورّد آخر" })];
    expect(await saveSupplierContact("imp-1", { supplier_id: "sup-2", phone: "0500000006" })).toEqual({ ok: true, supplierId: "sup-2" });
    expect(state.tables.company_suppliers[1]).toMatchObject({ mobile: "0500000006" });
    expect((state.stored[0].source as { company_supplier_id: string }).company_supplier_id).toBe("sup-2");
  });

  it("a line the clerk already handed to someone else stays with them", async () => {
    state.tables.operation_bookings = [line({ assignee_kind: "employee" })];
    await saveSupplierContact("imp-1", { phone: "0500000005" });
    expect(state.tables.operation_bookings[0].assignee_kind).toBe("employee");
  });

  it("with no supplier named at all there is nothing to register", async () => {
    state.record = { id: "imp-1", data: issued({ source: { ...georgiaData().source, supplier_name: "" } }), updated_at: "" };
    expect(await saveSupplierContact("imp-1", { phone: "0500000005" })).toEqual({ ok: false, error: "empty" });
  });
});

describe("«الحسابات» — cost and profit only for those who may see cost", () => {
  const facts = {
    sale: { amount: 8820, currency: "SAR" },
    expectedCost: [{ amount: SUPPLIER_COST, currency: "SAR" }],
    partner: false,
    invoice: null,
    clientPayments: [{ amount: 3000, currency: "SAR", kind: "deposit" }],
    supplierPayments: [],
    bookings: [{ status: "confirmed", is_paid: false, start_date: null, deadline: null, cost: { amount: SUPPLIER_COST, currency: "SAR" } }],
  };

  it("nothing without pricing.internal — the client's price is not the figure here, the cost is", async () => {
    state.can["pricing.internal"] = false;
    expect(await getRepackageAccounts("imp-1")).toBeNull();
  });

  it("a confirmed file reads the case's own figures: cost, received, remaining, profit", async () => {
    confirmedCase();
    state.loaded = [{ facts, total: 8820, currency: "SAR", paid: 3000 }];
    const a = await getRepackageAccounts("imp-1");
    expect(a).toMatchObject({ hasCase: true, operationId: "op-1", paid: 3000, remaining: 5820, sale: { amount: 8820, currency: "SAR" } });
    expect(a?.expected[0]).toMatchObject({ revenue: 8820, cost: SUPPLIER_COST, profit: 1428.5 });
    expect(a?.supplierOwed).toEqual([{ currency: "SAR", amount: SUPPLIER_COST }]);
  });

  it("before the case exists they are the file's own prices", async () => {
    const a = await getRepackageAccounts("imp-1");
    expect(a).toMatchObject({ hasCase: false, operationId: null, remaining: 8820 });
    expect(a?.expected[0]).toMatchObject({ revenue: 8820, cost: SUPPLIER_COST, profit: 1428.5 });
  });

  it("the supplier's cost is converted into the sell currency, so a profit is a difference of one currency", async () => {
    state.record = { id: "imp-1", data: issued({ extracted: georgiaPackage({ supplier_total: 2000, supplier_currency: "USD" }) }), updated_at: "" };
    const a = await getRepackageAccounts("imp-1");
    expect(a?.expected[0]).toMatchObject({ currency: "SAR", cost: 7500, profit: 1320 });
  });
});
