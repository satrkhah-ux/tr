import { beforeEach, describe, expect, it, vi } from "vitest";

const tables: Record<string, unknown> = {};
const inserted: Record<string, unknown>[] = [];
const events: unknown[] = [];
const draft = vi.fn();

vi.mock("./store", () => ({
  db: () => ({
    from: (t: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "like"]) b[m] = () => b;
      b.maybeSingle = async () => ({ data: tables[t] });
      b.then = (resolve: (v: unknown) => unknown) => resolve({ data: tables[t] });
      return b;
    },
  }),
  insertVisaFile: async (row: Record<string, unknown>) => (inserted.push(row), { id: `id${inserted.length}`, serial: `VF-26-000${inserted.length}` }),
  addEvents: async (_id: string, _by: unknown, e: unknown[]) => void events.push(...e),
  audit: async () => undefined,
}));
vi.mock("@/lib/data/issued-draft", () => ({ issuedDraftData: (...a: unknown[]) => draft(...a) }));
vi.mock("@/lib/providers/teletel", () => ({ intlPhone: (p: string) => (p.startsWith("05") ? `966${p.slice(1)}` : p) }));

import { openVisaFilesForSale } from "./from-sale";

const offer = { id: "o1", serial: "AD-5-3269", partner_company_id: null, customers: { arabic_name: "أحمد", mobile: "0501234567" } };

beforeEach(() => {
  inserted.length = 0;
  events.length = 0;
  tables.offers = offer;
  tables.visa_files = [];
  tables.visas = [{ id: "11111111-1111-4111-8111-111111111111", country: "الصين", country_id: null, visa_type: "سياحية", sell_price: 300, sell_currency: "SAR", arabic_requirements: "جواز ساري\nصورة شخصية", status: "Active" }];
  draft.mockResolvedValue({ scope: { visas: true }, visas: [{ country: "الصين", visa_type: "سياحية", count: 2, note: "" }] });
});

describe("a sale opens its visa files", () => {
  it("opens one new, unassigned file with the client, the heads, the price and the documents the catalogue asks for", async () => {
    expect(await openVisaFilesForSale("o1")).toEqual(["VF-26-0001"]);
    const row = inserted[0];
    expect(row).toMatchObject({ country: "الصين", client_name: "أحمد", client_phone: "966501234567", applicants: 2, fee_service: 600, currency: "SAR", assigned_to: null, created_by: null });
    expect(row.note).toBe("من البيع AD-5-3269");
    expect((row.travelers as unknown[]).length).toBe(2);
    expect((row.documents as { label: string }[]).some((d) => d.label.includes("جواز"))).toBe(true);
    expect(events).toHaveLength(1);
  });

  it("does not open a second file for the same sale and line", async () => {
    tables.visa_files = [{ country: "الصين", visa_type: "سياحية" }];
    expect(await openVisaFilesForSale("o1")).toEqual([]);
    expect(inserted).toHaveLength(0);
  });

  it("opens nothing for a partner company's file or a sale without visas", async () => {
    tables.offers = { ...offer, partner_company_id: "p1" };
    expect(await openVisaFilesForSale("o1")).toEqual([]);
    tables.offers = offer;
    draft.mockResolvedValue({ scope: { visas: false }, visas: [{ country: "الصين", count: 1 }] });
    expect(await openVisaFilesForSale("o1")).toEqual([]);
    expect(inserted).toHaveLength(0);
  });

  it("names a client who has no name by the sale", async () => {
    tables.offers = { ...offer, customers: null };
    await openVisaFilesForSale("o1");
    expect(inserted[0]).toMatchObject({ client_name: "عميل AD-5-3269", client_phone: null });
  });
});
