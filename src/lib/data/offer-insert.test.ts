import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateOfferInput } from "./offers";

/**
 * «إصدار نسخة محدّثة» (replaceOffer) must never leave an offer with fewer rows
 * than it had: the new rows go in first, the old ones go only once every write
 * landed, and a failed write takes back what it added.
 */

type Row = Record<string, unknown> & { id: string };
const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  inserts: 0,
  failInsert: 0, // the n-th insert call answers with an error (0 = none)
  seq: 0,
}));

/** An in-memory PostgREST: select/insert/upsert/update/delete with eq/in/not-in, run when awaited. */
function fakeDb() {
  return {
    from(table: string) {
      const rows = () => (state.tables[table] ??= []);
      const filters: ((r: Row) => boolean)[] = [];
      let op: { kind: "select" | "insert" | "upsert" | "update" | "delete"; payload?: unknown; onConflict?: string } = { kind: "select" };
      let single = false;
      const run = () => {
        const match = (r: Row) => filters.every((f) => f(r));
        if (op.kind === "insert") {
          state.inserts += 1;
          if (state.inserts === state.failInsert) return { data: null, error: { message: "insert failed" } };
          const added = ([] as Record<string, unknown>[]).concat(op.payload as Record<string, unknown>).map((r) => ({ id: `new-${++state.seq}`, ...r }));
          rows().push(...added);
          return { data: added, error: null };
        }
        if (op.kind === "upsert") {
          const keys = (op.onConflict ?? "id").split(",");
          for (const r of ([] as Record<string, unknown>[]).concat(op.payload as Record<string, unknown>)) {
            const hit = rows().find((x) => keys.every((k) => x[k] === r[k]));
            if (hit) Object.assign(hit, r);
            else rows().push({ id: `new-${++state.seq}`, ...r });
          }
          return { data: null, error: null };
        }
        if (op.kind === "update") {
          rows().filter(match).forEach((r) => Object.assign(r, op.payload));
          return { data: null, error: null };
        }
        if (op.kind === "delete") {
          state.tables[table] = rows().filter((r) => !match(r));
          return { data: null, error: null };
        }
        const found = rows().filter(match);
        return { data: single ? (found[0] ?? null) : found, error: null };
      };
      const builder = {
        select: () => builder,
        insert: (payload: unknown) => ((op = { kind: "insert", payload }), builder),
        upsert: (payload: unknown, o?: { onConflict?: string }) => ((op = { kind: "upsert", payload, onConflict: o?.onConflict }), builder),
        update: (payload: unknown) => ((op = { kind: "update", payload }), builder),
        delete: () => ((op = { kind: "delete" }), builder),
        eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), builder),
        in: (col: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[col])), builder),
        not: (col: string, _in: "in", list: string) => {
          const vs = list.slice(1, -1).split(",");
          filters.push((r) => !vs.includes(String(r[col])));
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        maybeSingle: () => ((single = true), builder),
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, ko),
      };
      return builder;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  getServerUser: async () => ({ id: "user-1" }),
  createSupabaseServerClient: async () => fakeDb(),
  createSupabaseServiceClient: () => fakeDb(),
}));
vi.mock("@/lib/data/metrics", () => ({ getCurrentEmployeeId: async () => "emp-1" }));
vi.mock("@/lib/data/rates-actions", () => ({ getRates: async () => ({ sarPer: { SAR: 1 }, source: "fallback", updatedAt: null }) }));

const { replaceOffer } = await import("./offer-insert");

const OFFER = "offer-1";
const old = (table: string, n: number, extra: (i: number) => Record<string, unknown> = () => ({})) =>
  Array.from({ length: n }, (_, i) => ({ id: `old-${table}-${i}`, offer_id: OFFER, ...extra(i) }));

const input = {
  customer_id: "c1",
  destination: "بالي",
  duration: "5",
  offer_date: "2026-10-15",
  adults: 2,
  children: 0,
  infants: 0,
  total: 9000,
  total_sar: 9000,
  currency: "SAR",
  buy_total: 7000,
  cities: [{ city_name: "أوبود", hotel_name: "H", room_type: "R", nights: 4, check_in: "2026-11-01", check_out: "2026-11-05", meals: "BB" }],
  flights: [{ carrier: "SV", from_airport: "RUH", to_airport: "DPS", flight_date: "2026-11-01", passengers: 2, baggage: "23" }],
  hotels: [{ hotel_name: "H", room_type_id: null, rooms_count: 1, board_type: "BB", check_in: "2026-11-01", check_out: "2026-11-05", nights: 4, buy_price: 100, buy_currency: "SAR", sell_price: 150, sell_currency: "SAR" }],
  pricing_items: [{ item_type: "hotel", description: "H", quantity: 1, buy_price: 100, buy_currency: "SAR", sell_price: 150, sell_currency: "SAR" }],
  services: [{ label: "استقبال", kind: "included" }],
  terms: ["شرط"],
  days: [1, 2].map((n) => ({ day_number: n, day_date: null, city_name: "أوبود", title: `يوم ${n} الجديد`, activities: [], temp_max: null, temp_min: null, rain_chance: null, weather_code: null, weather_source: null, weather_fetched_at: null })),
} as unknown as CreateOfferInput;

const CHILDREN = ["offer_hotels", "offer_pricing_items", "offer_cities", "offer_flights", "offer_services", "offer_terms", "offer_days"];
const ids = (table: string) => state.tables[table].map((r) => r.id).sort();

beforeEach(() => {
  state.inserts = 0;
  state.failInsert = 0;
  state.tables = {
    offers: [{ id: OFFER, serial: "AD-1-1000-20261015", total: 5000, destination: "بالي" }],
    offer_revisions: [{ id: "rev-1", offer_id: OFFER, revision: 1 }],
    pricings: [{ id: "p-1", offer_id: OFFER, total: 5000 }],
    offer_hotels: old("offer_hotels", 2),
    offer_pricing_items: old("offer_pricing_items", 3),
    offer_cities: old("offer_cities", 2),
    offer_flights: old("offer_flights", 2),
    offer_services: old("offer_services", 2),
    offer_terms: old("offer_terms", 2),
    // three old days; the new programme has two
    offer_days: old("offer_days", 3, (i) => ({ day_number: i + 1, title: `يوم ${i + 1} القديم` })),
  };
});

describe("replaceOffer — a failed re-issue keeps the old rows", () => {
  it("the 3rd insert fails: every old row is still there, nothing new is left, the head is untouched", async () => {
    const before = Object.fromEntries(CHILDREN.map((t) => [t, ids(t)]));
    state.failInsert = 3;

    expect(await replaceOffer("AD-1-1000-20261015", input)).toEqual({ ok: false, error: "err.saveOfferFailed" });

    for (const table of CHILDREN) expect(ids(table), table).toEqual(before[table]);
    expect(state.tables.offer_days.map((d) => d.title)).toEqual(["يوم 1 القديم", "يوم 2 القديم", "يوم 3 القديم"]);
    expect(state.tables.offers[0].total).toBe(5000);
    expect(state.tables.offer_revisions).toHaveLength(1);
  });

  it("when every write lands, the new rows replace the old ones exactly", async () => {
    expect(await replaceOffer("AD-1-1000-20261015", input)).toMatchObject({ ok: true, id: OFFER });

    for (const table of ["offer_hotels", "offer_pricing_items", "offer_cities", "offer_flights", "offer_services", "offer_terms"]) {
      expect(state.tables[table], table).toHaveLength(1);
      expect(state.tables[table][0].id, table).toMatch(/^new-/);
    }
    // days upserted on their number; the surplus third day is gone
    expect(state.tables.offer_days.map((d) => [d.day_number, d.title])).toEqual([[1, "يوم 1 الجديد"], [2, "يوم 2 الجديد"]]);
    expect(state.tables.offers[0].total).toBe(9000);
    expect(state.tables.offer_revisions.map((r) => r.revision)).toEqual([1, 2]);
  });
});
