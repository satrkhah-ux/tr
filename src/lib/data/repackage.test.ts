import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepackageData } from "@/lib/repackage/repackage-types";
import { ADDITION_PRICE, georgiaData, georgiaPackage, SELL, SUPPLIER_COST } from "@/lib/repackage/fixture";
import { fakeDb } from "@/test/fake-db";

/**
 * «إعادة تصميم بكج مورّد», after the owner's order (2026-10-26): the file is the
 * client's from the start, it stays editable after it issued an offer, and a
 * second «إصدار» is that offer's next VERSION under the same serial — never a
 * second offer.
 */

const state = vi.hoisted(() => ({
  can: { "offers.write": true, "repackage.write": true } as Record<string, boolean>,
  record: null as { id: string; data: unknown; updated_at: string } | null,
  stored: [] as Record<string, unknown>[],
  inserted: [] as Record<string, unknown>[],
  replaced: [] as { serial: string; input: Record<string, unknown> }[],
  created: [] as Record<string, unknown>[],
  published: [] as { serial: string; reissued: boolean }[],
  customers: [] as { customer_name: string; customer_phone: string; reuse: boolean }[],
  audits: [] as { action: string; meta?: Record<string, unknown> }[],
  pulled: [] as string[],
  locked: false,
  sentBefore: { total: 8820 } as { total: number },
  sentAfter: { total: 9100 } as { total: number },
  published_calls: 0,
  tables: {} as Record<string, Record<string, unknown>[]>,
  /** the store's own tables: the suppliers list and the repackage rows a new file lands in */
  repo: { suppliers_repackage: [], repackage_imports: [] } as Record<string, Record<string, unknown>[]>,
  extraction: null as unknown,
}));

vi.mock("@/lib/supabase/server", () => ({
  getServerUser: async () => ({ id: "user-1" }),
  createSupabaseServiceClient: () => fakeDb(state.tables),
}));
vi.mock("@/lib/roles/current", () => ({ currentCan: async (p: string) => Boolean(state.can[p]) }));
vi.mock("@/lib/data/markup-rules", () => ({ getActiveMarkupRules: async () => [] }));
vi.mock("@/lib/repackage/fetch-public", () => ({ fetchPublic: async () => null }));
vi.mock("@/lib/repackage/extract/extract", () => ({ runExtraction: async () => state.extraction }));
vi.mock("./repackage-store", () => ({
  repackageDb: async () => fakeDb(state.repo),
  loadRepackage: async () => (state.record ? { ...state.record, data: structuredClone(state.record.data) } : null),
  writeRepackageStages: async (_id: string, slices: Record<string, unknown>) => {
    state.stored.push(slices);
    return { ok: true };
  },
}));
vi.mock("./customer-row", () => ({
  customerFor: async (c: { customer_name: string; customer_phone: string }, reuse: boolean) => (state.customers.push({ ...c, reuse }), "cust-1"),
}));
vi.mock("./rates-actions", () => ({ getRates: async () => ({ sarPer: { SAR: 1, USD: 3.75 }, source: "fallback", updatedAt: "2026-10-26" }) }));
vi.mock("./issued-draft", () => ({ reissueLocked: async () => state.locked }));
vi.mock("./offer-pull", () => ({ pullBookingsFromOffer: async (id: string) => (state.pulled.push(id), { ok: true }) }));
vi.mock("./audit", () => ({ logAudit: async (a: { action: string; meta?: Record<string, unknown> }) => (state.audits.push(a), true) }));
vi.mock("./offer-insert", () => ({
  insertOffer: async (input: Record<string, unknown>) => (state.created.push(input), { ok: true, serial: "AD-9-9000-20261026", id: "offer-9" }),
  replaceOffer: async (serial: string, input: Record<string, unknown>) => (state.replaced.push({ serial, input }), { ok: true, serial, id: "offer-1" }),
}));
vi.mock("./offers", () => ({
  publishOffer: async (serial: string, reissued = false) => (state.published.push({ serial, reissued }), { ok: true, serial, version: reissued ? 2 : 1 }),
  // first read: the version the client has now; second: the one just published
  getPublishedClientOffer: async () => ({ version: 1, file_path: null, offer: clientDoc(++state.published_calls === 1 ? state.sentBefore.total : state.sentAfter.total) }),
}));

function clientDoc(total: number) {
  return { hotels: [], flights: [], arrival_date: "2026-11-10", departure_date: "2026-11-15", adults: 2, children: 1, infants: 0, total, currency: "SAR", includes: [] };
}

const { produceRepackageOffer, saveRepackageStages, createRepackage, importFromPdf } = await import("./repackage");

const fileOf = (data: RepackageData) => ({ id: "imp-1", data, updated_at: "2026-10-26T10:00:00Z" });

beforeEach(() => {
  state.can = { "offers.write": true, "repackage.write": true };
  state.record = fileOf(georgiaData());
  state.stored = [];
  state.created = [];
  state.replaced = [];
  state.published = [];
  state.customers = [];
  state.audits = [];
  state.pulled = [];
  state.locked = false;
  state.published_calls = 0;
  state.sentBefore = { total: 8820 };
  state.sentAfter = { total: 9100 };
  state.tables = { operations: [] };
  state.repo = { suppliers_repackage: [], repackage_imports: [] };
});

describe("the offer is filed under the client the repackage is for", () => {
  it("issues for the client on the file, found or made by name and phone", async () => {
    expect(await produceRepackageOffer("imp-1")).toEqual({ ok: true, serial: "AD-9-9000-20261026" });
    expect(state.customers).toEqual([{ customer_name: "عميل تجريبي", customer_phone: "0500000000", reuse: true }]);
    expect(state.created).toHaveLength(1);
    expect(state.created[0]).toMatchObject({ customer_id: "cust-1", source_kind: "repackaged", source_import_id: "imp-1", total: SELL + ADDITION_PRICE, buy_total: SUPPLIER_COST });
  });

  it("the serial is written by the server, and the offer is published as version 1", async () => {
    await produceRepackageOffer("imp-1");
    expect(state.stored).toEqual([{ produced_serial: "AD-9-9000-20261026" }]);
    expect(state.published).toEqual([{ serial: "AD-9-9000-20261026", reissued: false }]);
  });

  it("refuses the issue for a file with no client — said as the review's own blocking items", async () => {
    state.record = fileOf(georgiaData({ customer: { customer_name: "", customer_phone: "" } }));
    expect(await produceRepackageOffer("imp-1")).toEqual({ ok: false, error: "rp.err.blockingLeft" });
    expect(state.created).toEqual([]);
    expect(state.customers).toEqual([]);
  });

  it("stops rather than store a supplier cost in a currency it cannot convert", async () => {
    state.record = fileOf(georgiaData({ extracted: georgiaPackage({ supplier_currency: "EUR" }) }));
    expect(await produceRepackageOffer("imp-1")).toEqual({ ok: false, error: "pg.err.missingRates" });
    expect(state.created).toEqual([]);
  });
});

describe("a second «إصدار» is a re-issue — the same offer, its next version", () => {
  beforeEach(() => {
    state.record = fileOf(georgiaData({ produced_serial: "AD-1-1000-20261020" }));
    state.tables = { operations: [{ id: "op-1", offer_id: "offer-1" }] };
  });

  it("re-fills the offer under its serial and creates no second one", async () => {
    const res = await produceRepackageOffer("imp-1");
    expect(res).toMatchObject({ ok: true, serial: "AD-1-1000-20261020", version: 2 });
    expect(state.created).toEqual([]);
    expect(state.replaced.map((r) => r.serial)).toEqual(["AD-1-1000-20261020"]);
    expect(state.replaced[0].input).toMatchObject({ customer_id: "cust-1", total: SELL + ADDITION_PRICE });
    // published as the next version, the way Basic's re-issue is (offers.ts freezes beside it)
    expect(state.published).toEqual([{ serial: "AD-1-1000-20261020", reissued: true }]);
    expect(state.stored).toEqual([{ produced_serial: "AD-1-1000-20261020" }]);
  });

  it("says what changed against the version the client had, and keeps it in the audit", async () => {
    const res = await produceRepackageOffer("imp-1");
    if (!res.ok) throw new Error("not issued");
    expect(res.changes).toEqual([{ kind: "price", where: null, before: "8,820 SAR", after: "9,100 SAR" }]);
    expect(state.audits).toEqual([{ action: "offer.reissued", entity: "offers", entity_id: "offer-1", meta: expect.objectContaining({ serial: "AD-1-1000-20261020", version: 2, repackage_id: "imp-1" }) }]);
  });

  it("an open case follows the newest issue (the supplier's package line takes the new cost)", async () => {
    await produceRepackageOffer("imp-1");
    expect(state.pulled).toEqual(["op-1"]);
  });

  it("sends nothing to the client — the module never reaches the client's WhatsApp", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.join(__dirname, "repackage.ts"), "utf8");
    expect(src).not.toMatch(/sendOfferToClient|client-whatsapp/);
  });

  it("is locked by the same rules as Basic's: a cancelled file, or someone without offers.write", async () => {
    state.locked = true;
    expect(await produceRepackageOffer("imp-1")).toEqual({ ok: false, error: "pg.err.issuedLocked" });
    state.locked = false;
    state.can["offers.write"] = false;
    expect(await produceRepackageOffer("imp-1")).toEqual({ ok: false, error: "pg.err.issuedLocked" });
    expect(state.replaced).toEqual([]);
    expect(state.published).toEqual([]);
  });
});

describe("the file is editable at any time — and what an issue wrote stays the server's", () => {
  it("a browser's save never names the serial: it could point the next re-issue at an offer never issued", async () => {
    state.record = fileOf(georgiaData({ produced_serial: "AD-1-1000-20261020" }));
    expect(await saveRepackageStages("imp-1", { final_total: 9000, produced_serial: "AD-5-5555-20260101" })).toEqual({ ok: true });
    expect(state.stored).toEqual([{ final_total: 9000 }]);
  });

  it("…nor links the supplier: the registry link in a saved source comes from storage", async () => {
    const base = georgiaData().source;
    state.record = fileOf(georgiaData({ source: { ...base, company_supplier_id: "sup-1" } }));
    await saveRepackageStages("imp-1", { source: { ...base, company_supplier_id: "sup-evil" } });
    expect((state.stored[0].source as { company_supplier_id: string }).company_supplier_id).toBe("sup-1");
  });

  it("a new file starts with the client asked up front — or without one, to be linked later", async () => {
    expect(await createRepackage({ customer_name: "  عميل جديد ", customer_phone: " 0500000002 " })).toMatchObject({ ok: true });
    expect(await createRepackage()).toMatchObject({ ok: true });
    const customers = state.repo.repackage_imports.map((r) => (r.data as RepackageData).customer);
    expect(customers).toEqual([{ customer_name: "عميل جديد", customer_phone: "0500000002" }, { customer_name: "", customer_phone: "" }]);
  });
});

describe("importing a supplier file into a file that already has a client and an offer", () => {
  const fileText = () => {
    const fd = new FormData();
    fd.append("text", "عرض المورّد — ".repeat(10));
    fd.append("supplier", "مورّد تجريبي");
    return fd;
  };
  beforeEach(() => {
    state.extraction = {
      extracted: georgiaPackage({ customer_name: "اسم من ملف المورّد", customer_phone: "0511111111" }),
      confidence: { country: 0.9 },
      pdf_kind: null,
      ocr_used: false,
      ocr_unavailable: false,
      how: "ai-text",
      summary: "ملخص",
    };
    state.repo.suppliers_repackage = [{ id: "s1", name: "مورّد تجريبي" }];
  });

  it("keeps the client the file was started for, the additions, and the offer it issued", async () => {
    state.record = fileOf(georgiaData({ produced_serial: "AD-1-1000-20261020", source: { ...georgiaData().source, company_supplier_id: "sup-1" } }));
    expect(await importFromPdf("imp-1", fileText())).toMatchObject({ ok: true });
    const saved = state.stored[0] as unknown as RepackageData;
    expect(saved.customer).toEqual({ customer_name: "عميل تجريبي", customer_phone: "0500000000" });
    expect(saved.additions.map((a) => a.id)).toEqual(["a1", "a2"]);
    // an issued file stays that offer: a re-import is not a new one
    expect(saved.produced_serial).toBe("AD-1-1000-20261020");
    // the same supplier keeps its registry link; the price is asked again
    expect(saved.source.company_supplier_id).toBe("sup-1");
    expect(saved.final_total).toBeNull();
  });

  it("a different supplier drops the registry link", async () => {
    state.record = fileOf(georgiaData({ source: { ...georgiaData().source, supplier_name: "مورّد آخر", company_supplier_id: "sup-1" } }));
    await importFromPdf("imp-1", fileText());
    expect((state.stored[0] as unknown as RepackageData).source.company_supplier_id).toBeNull();
  });

  it("the supplier's file only fills a client that is still empty", async () => {
    state.record = fileOf(georgiaData({ customer: { customer_name: "", customer_phone: "" } }));
    await importFromPdf("imp-1", fileText());
    expect((state.stored[0] as unknown as RepackageData).customer).toEqual({ customer_name: "اسم من ملف المورّد", customer_phone: "0511111111" });
  });
});
