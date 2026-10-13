import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyDraftData, normalizeDraftHotel, type DraftData } from "@/lib/offer/draft-types";

/**
 * The pricing suggestion end to end, with the database faked: what a partner's
 * file is actually sent. The lists hold OUR prices; the owner's rule is that a
 * partner sees them only at their own terms, and never a buy price.
 */

type Rows = Record<string, Record<string, unknown>[]>;

const state = vi.hoisted(() => {
  const s = {
    rows: {} as Record<string, Record<string, unknown>[]>,
    record: null as { id: string; data: unknown; updated_at: string; partner_company_id: string | null } | null,
    internal: false,
    partner: null as { terms: { kind: "markup" | "commission"; pct: number } } | null,
    /** A query builder that ignores its filters and answers with the table's rows. */
    db(rows: Record<string, Record<string, unknown>[]>) {
      return {
        from(table: string) {
          const result = { data: rows[table] ?? [], error: null };
          const builder: Record<string, unknown> = {
            then: (ok: (v: typeof result) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(result).then(ok, bad),
            maybeSingle: () => Promise.resolve({ data: result.data[0] ?? null, error: null }),
          };
          for (const m of ["select", "eq", "neq", "not", "in", "is", "order", "limit"]) builder[m] = () => builder;
          return builder;
        },
      };
    },
  };
  return s;
});

vi.mock("@/lib/supabase/server", () => ({
  getServerUser: async () => ({ id: "user-1" }),
  createSupabaseServiceClient: () => state.db(state.rows),
  createSupabaseServerClient: async () => state.db(state.rows),
}));
vi.mock("@/lib/roles/current", () => ({ currentCan: async () => state.internal }));
vi.mock("@/lib/partners/session", () => ({
  getPartnerSession: async () => state.partner,
  // the company's terms as booking_partners holds them (no commission ladder in these cases)
  partnerTermsById: async () => {
    const row = (state.rows["booking_partners"] ?? [])[0] as { price_adjust_kind: string; price_adjust_pct: number } | undefined;
    return row ? { kind: row.price_adjust_kind === "commission" ? "commission" : "markup", pct: Number(row.price_adjust_pct) } : null;
  },
}));
vi.mock("./draft-store", () => ({ loadDraft: async () => state.record }));
vi.mock("./rates-actions", () => ({ getRates: async () => ({ sarPer: { SAR: 1 } }) }));

const { suggestPricingForDraft } = await import("./pricing-suggest");

const LABELS = { hotel: "فندق", airline: "الناقل" };

/** Istanbul: a stay the agent typed (2 rooms × 500), a transfer and a tour from our lists. */
function draft(): DraftData {
  const data = emptyDraftData();
  data.trip = { ...data.trip, country: "تركيا", arrival_date: "2026-09-10", days: 4, nights: 3, adults: 2 };
  data.cities = [
    {
      city_name: "إسطنبول",
      nights: 3,
      check_in: "2026-09-10",
      check_out: "2026-09-13",
      tours: 1,
      tour_picks: [{ program_id: null, title: "جولة البوسفور", text: "", price: null }],
    },
  ];
  data.hotels = [
    normalizeDraftHotel({ city_name: "إسطنبول", hotel_name: "فندق آيوتا", rooms_count: 2, manual_price: 500, manual_currency: "SAR" }),
  ];
  data.transport = [{ from_place: "إسطنبول", to_place: "بورصة", car_type: "فان", date: null, note: "" }];
  return data;
}

const LISTS: Rows = {
  countries: [{ id: "tr", arabic_name: "تركيا" }],
  // what we PAY
  transfers: [{ id: "t1", from_city: "إسطنبول", to_city: "بورصة", car_type: "فان", price: 400, currency: "SAR", created_at: "2026-01-01" }],
  tours: [{ arabic_name: "جولة البوسفور", price: 200, currency: "SAR" }],
  booking_partners: [{ price_adjust_kind: "markup", price_adjust_pct: 35 }],
};

async function suggest(partnerCompanyId: string | null) {
  state.record = { id: "d1", data: draft(), updated_at: "", partner_company_id: partnerCompanyId };
  const res = await suggestPricingForDraft("d1", LABELS);
  if (!res.ok) throw new Error(res.error);
  const line = (type: string) => res.items.find((i) => i.item_type === type && (type !== "service" || i.description === "جولة البوسفور"));
  return { items: res.items, hotel: line("hotel"), transfer: line("transport"), tour: line("service") };
}

describe("suggestPricingForDraft — a partner's file", () => {
  beforeEach(() => {
    state.rows = { ...LISTS };
    state.internal = false;
    state.partner = { terms: { kind: "markup", pct: 35 } };
  });

  it("never quotes a partner our cost: with no margin set, our list lines go unpriced", async () => {
    const { items, transfer, tour, hotel } = await suggest("partner-1");
    expect(transfer?.sell_price).toBeNull(); // not 400, and not 400 + 35%
    expect(tour?.sell_price).toBeNull();
    expect(hotel?.sell_price).toBe(1000); // what they typed is theirs, untouched
    for (const item of items) {
      expect(item.buy_price).toBeNull();
      expect(item.profit_pct).toBeUndefined();
      expect(item.profit_amount).toBeUndefined();
    }
  });

  it("puts our default margin on before their terms — never their terms on our cost", async () => {
    state.rows = { ...LISTS, app_settings: [{ value: "20" }] };
    const { transfer, tour, hotel } = await suggest("partner-1");
    expect(transfer?.sell_price).toBe(648); // 400 → our sell 480 → +35%
    expect(tour?.sell_price).toBe(324);
    expect(hotel?.sell_price).toBe(1000);
  });

  it("is quoted at the partner's terms when staff price the partner's file — a figure staff typed included", async () => {
    state.partner = null;
    state.internal = true;
    state.rows = { ...LISTS, app_settings: [{ value: "20" }] };
    const { transfer, hotel } = await suggest("partner-1");
    expect(transfer).toMatchObject({ sell_price: 648, buy_price: null });
    // typed by staff, so ours: 1000 → 1200 → +35%
    expect(hotel).toMatchObject({ sell_price: 1620, buy_price: null });
  });

  it("leaves a staff-typed figure on a partner's file unpriced when there is no margin", async () => {
    state.partner = null;
    state.internal = true;
    const { hotel } = await suggest("partner-1");
    expect(hotel?.sell_price).toBeNull();
  });

  it("leaves our own files exactly as they were", async () => {
    state.partner = null;
    state.internal = true;
    const { transfer, tour } = await suggest(null);
    expect(transfer).toMatchObject({ sell_price: 400, buy_price: 400 });
    expect(tour).toMatchObject({ sell_price: 200, buy_price: 200 });
  });
});
