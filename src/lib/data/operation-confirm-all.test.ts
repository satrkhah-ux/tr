import { beforeEach, describe, expect, it, vi } from "vitest";
import { entriesToSave } from "@/lib/operations/confirm-all";

/**
 * «تأكيد الكل» (operations order 5): several bookings confirmed in one action,
 * through the same write as one — each in the audit log, the case's statuses
 * moved once by operation-sync.
 */

const state = vi.hoisted(() => ({
  bookings: [] as { id: string; status: string; title: string; operation_id: string }[],
  updates: [] as { id: string; patch: Record<string, unknown> }[],
  audits: [] as { action: string; entity_id: string; meta?: Record<string, unknown> }[],
  synced: [] as string[],
  can: true,
}));

/** operation_bookings only: the select honours eq/in, an update records its patch. */
function fakeDb() {
  return {
    from() {
      const filters: ((b: (typeof state.bookings)[number]) => boolean)[] = [];
      let patch: Record<string, unknown> | null = null;
      const builder = {
        select: () => builder,
        update: (p: Record<string, unknown>) => ((patch = p), builder),
        eq: (col: string, value: string) => {
          if (patch) {
            state.updates.push({ id: value, patch });
            return Promise.resolve({ error: null });
          }
          filters.push((b) => (b as Record<string, unknown>)[col] === value);
          return builder;
        },
        in: (col: string, values: string[]) => {
          filters.push((b) => values.includes((b as Record<string, unknown>)[col] as string));
          return builder;
        },
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: state.bookings.filter((b) => filters.every((f) => f(b))), error: null }).then(ok),
      };
      return builder;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  getServerUser: async () => ({ id: "user-1", email: "ops@traveliun.com" }),
  createSupabaseServerClient: async () => fakeDb(),
  createSupabaseServiceClient: () => fakeDb(),
}));
vi.mock("@/lib/roles/current", () => ({ currentCan: async () => state.can }));
vi.mock("@/lib/data/metrics", () => ({ getCurrentEmployeeId: async () => "emp-1" }));
vi.mock("@/lib/data/audit", () => ({
  logAudit: async (a: { action: string; entity_id: string; meta?: Record<string, unknown> }) => (state.audits.push(a), true),
}));
vi.mock("@/lib/data/operation-sync", () => ({
  syncOperation: async (id: string) => void state.synced.push(id),
  syncOperationOfBooking: async (id: string) => void state.synced.push(`booking:${id}`),
}));
vi.mock("@/lib/data/ops-notify", () => ({ notifyBookingChanged: async () => ({ whatsapp: false, telegram: 0 }), notifyPartnerCase: async () => undefined }));
vi.mock("@/lib/data/operation-travelers", () => ({ listTravelers: async () => [] }));
vi.mock("@/lib/data/flight-follow", () => ({ followFlight: async () => undefined }));

const { confirmBookings } = await import("./operation-bookings");

beforeEach(() => {
  state.bookings = [
    { id: "h1", status: "pending", title: "فندق بونشاك", operation_id: "op-1" },
    { id: "h2", status: "pending", title: "فندق بالي", operation_id: "op-1" },
    { id: "t1", status: "prebooked", title: "المطار ← فندق بونشاك", operation_id: "op-1" },
    { id: "done", status: "confirmed", title: "مؤكد سابقاً", operation_id: "op-1" },
    { id: "other", status: "pending", title: "حجز حالة أخرى", operation_id: "op-2" },
  ];
  state.updates = [];
  state.audits = [];
  state.synced = [];
  state.can = true;
});

describe("what «تأكيد الكل» saves", () => {
  it("keeps only typed numbers on bookings still waiting, each once", () => {
    const held = [
      { id: "a", status: "pending" },
      { id: "b", status: "confirmed" },
      { id: "c", status: "in_flight" },
      { id: "d", status: "failed" },
    ];
    expect(
      entriesToSave(
        [
          { booking_id: "a", confirmation_number: " X1 ", supplier_name: " مورد ", net_charged: 500 },
          { booking_id: "a", confirmation_number: "X2" },
          { booking_id: "b", confirmation_number: "X3" },
          { booking_id: "c", confirmation_number: "X4" },
          { booking_id: "d", confirmation_number: "  " },
          { booking_id: "zz", confirmation_number: "X5" },
        ],
        held,
      ),
    ).toEqual([{ booking_id: "a", confirmation_number: "X1", supplier_name: "مورد", net_charged: 500 }]);
    expect(entriesToSave([{ booking_id: "a", confirmation_number: "X", net_charged: -3 }], held)).toEqual([{ booking_id: "a", confirmation_number: "X" }]);
  });
});

describe("confirmBookings", () => {
  it("confirms one supplier's bookings with one number — an audit row each, one status sync", async () => {
    const res = await confirmBookings({
      operation_id: "op-1",
      entries: [
        { booking_id: "h1", confirmation_number: "GRP-77" },
        { booking_id: "h2", confirmation_number: "GRP-77", net_charged: 1800 },
        { booking_id: "t1", confirmation_number: "TRF-1", supplier_name: "Bali Trans" },
      ],
    });
    expect(res).toEqual({ ok: true, confirmed: 3 });
    expect(state.updates.map((u) => [u.id, u.patch.status, u.patch.confirmation_number])).toEqual([
      ["h1", "confirmed", "GRP-77"],
      ["h2", "confirmed", "GRP-77"],
      ["t1", "confirmed", "TRF-1"],
    ]);
    // what was not typed is left as it was — the pull's cancellation terms stay
    expect(state.updates[0].patch).not.toHaveProperty("cancellation_policy");
    expect(state.updates[0].patch).not.toHaveProperty("net_charged");
    expect(state.updates[1].patch.net_charged).toBe(1800);
    expect(state.updates[2].patch.supplier_name).toBe("Bali Trans");
    expect(state.audits.filter((a) => a.action === "booking.confirmed").map((a) => a.entity_id)).toEqual(["h1", "h2", "t1"]);
    expect(state.synced).toEqual(["op-1"]);
  });

  it("never confirms another case's booking, nor one already confirmed", async () => {
    const res = await confirmBookings({
      operation_id: "op-1",
      entries: [
        { booking_id: "other", confirmation_number: "X" },
        { booking_id: "done", confirmation_number: "Y" },
      ],
    });
    expect(res).toEqual({ ok: false, error: "ops.err.confirmationRequired" });
    expect(state.updates).toEqual([]);
    expect(state.synced).toEqual([]);
  });

  it("refuses without operations.write", async () => {
    state.can = false;
    expect(await confirmBookings({ operation_id: "op-1", entries: [{ booking_id: "h1", confirmation_number: "X" }] })).toEqual({ ok: false, error: "ops.err.forbidden" });
    expect(state.updates).toEqual([]);
  });
});
