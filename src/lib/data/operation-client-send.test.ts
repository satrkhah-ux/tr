import { beforeEach, describe, expect, it, vi } from "vitest";
import { clientSummaryMessage, type SummaryBooking } from "@/lib/operations/client-summary";

/**
 * «أرسل للعميل» (operations order 6): the message drafted from the file, and
 * the send — through the shared Teletel path (mocked: no real message leaves),
 * to the file's own mobile, never a partner's client, kept in the log.
 */

const state = vi.hoisted(() => ({
  partner: null as string | null,
  mobile: "0541638023" as string | null,
  token: "TOKEN123" as string | null,
  sends: [] as { phone: string | null | undefined; text: string }[],
  extras: [] as unknown[],
  result: "sent" as string,
  gate: null as string | null,
  dispatches: [] as Record<string, unknown>[],
  audits: [] as { action: string; entity_id: string; meta?: Record<string, unknown> }[],
}));

const BOOKINGS: SummaryBooking[] = [
  { kind: "transport", title: "فندق بالي ← المطار", city_name: "بالي", start_date: "2026-11-07", end_date: null, status: "confirmed", confirmation_number: "TRF-DEP", detail: { الوقت: "يُحدَّد لاحقاً" } },
  { kind: "hotel", title: "نوفوتيل بالي نوسا دوا", city_name: "بالي", start_date: "2026-11-03", end_date: "2026-11-07", status: "confirmed", confirmation_number: "HTL-BALI", detail: { الغرفة: "غرفة مزدوجة — إفطار" } },
  { kind: "hotel", title: "جراند استون بونشاك", city_name: "بونشاك", start_date: "2026-10-31", end_date: "2026-11-03", status: "pending", confirmation_number: null, company_ref: "AD-4-8573-20261015-H1", detail: {} },
  { kind: "transport", title: "المطار ← فندق بونشاك", city_name: "بونشاك", start_date: "2026-10-31", end_date: null, status: "confirmed", confirmation_number: "TRF-ARR", detail: { الوقت: "14:45" } },
  { kind: "service", title: "جولة: استكشاف بونشاك", city_name: "بونشاك", start_date: "2026-11-01", end_date: null, status: "cancelled", confirmation_number: "X", detail: {} },
];

function fakeDb() {
  return {
    from(table: string) {
      const data =
        table === "operations"
          ? [
              {
                id: "op-1",
                client_token: state.token,
                client_token_revoked_at: null,
                offers: {
                  serial: "AD-4-8573-20261015",
                  destination: "اندونيسيا",
                  total: 6000,
                  currency: "SAR",
                  employee_id: "emp-1",
                  partner_company_id: state.partner,
                  customers: { arabic_name: "عميل تجريبي", mobile: state.mobile },
                },
              },
            ]
          : table === "operation_bookings"
            ? BOOKINGS
            : table === "operation_payments"
              ? [{ amount: "3000", kind: "deposit" }, { amount: 500, kind: "final" }]
              : [];
      const result = { data, error: null };
      const builder: Record<string, unknown> = {
        then: (ok: (v: typeof result) => unknown) => Promise.resolve(result).then(ok),
        maybeSingle: () => Promise.resolve({ data: data[0] ?? null, error: null }),
        insert: (row: Record<string, unknown>) => (table === "operation_dispatches" && state.dispatches.push(row), Promise.resolve({ error: null })),
        update: () => builder,
      };
      for (const m of ["select", "eq", "in", "not", "is", "order", "limit"]) builder[m] = () => builder;
      return builder;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  getServerUser: async () => ({ id: "user-1" }),
  createSupabaseServiceClient: () => fakeDb(),
  createSupabaseServerClient: async () => fakeDb(),
}));
vi.mock("@/lib/roles/current", () => ({ currentCan: async () => true }));
vi.mock("@/lib/data/metrics", () => ({ getCurrentEmployeeId: async () => "emp-9" }));
vi.mock("@/lib/data/audit", () => ({
  logAudit: async (a: { action: string; entity_id: string; meta?: Record<string, unknown> }) => (state.audits.push(a), true),
}));
// the shared Teletel path — mocked: nothing is ever sent from a test
vi.mock("@/lib/data/client-whatsapp", () => ({
  greeting: (name: string | null | undefined) => `عميلنا ${name?.trim() || "العزيز"}،`,
  clientWhatsappAllowed: async (offer: { partner_company_id: string | null }) => (offer.partner_company_id ? "partner" : state.gate),
  messageClient: async (offer: { partner_company_id: string | null; customer: { mobile: string | null } | null }, text: string, extra?: unknown) => {
    if (offer.partner_company_id) return "partner";
    state.sends.push({ phone: offer.customer?.mobile, text });
    state.extras.push(extra);
    return state.result;
  },
}));

const { draftClientMessage, listPreparedMessages, sendClientMessageNow } = await import("./operation-client-send");

beforeEach(() => {
  state.partner = null;
  state.mobile = "0541638023";
  state.token = "TOKEN123";
  state.sends = [];
  state.extras = [];
  state.result = "sent";
  state.gate = null;
  state.dispatches = [];
  state.audits = [];
});

describe("the client's message", () => {
  const text = clientSummaryMessage({
    hello: "عميلنا عميل تجريبي،",
    destination: "اندونيسيا",
    serial: "AD-4-8573-20261015",
    bookings: BOOKINGS,
    link: "https://pkg.traveliun.com/trip/TOKEN123",
    remaining: 2500,
    currency: "SAR",
  });

  it("lists the hotels in date order with their numbers — ours until the hotel gives its own, never «قيد التأكيد»", () => {
    expect(text).toContain("هذه حجوزات رحلتك إلى اندونيسيا (AD-4-8573-20261015):");
    const hotels = text.slice(text.indexOf("الفنادق:"), text.indexOf("التنقلات والجولات:"));
    expect(hotels.indexOf("جراند استون بونشاك")).toBeLessThan(hotels.indexOf("نوفوتيل بالي نوسا دوا"));
    expect(hotels).toContain("• نوفوتيل بالي نوسا دوا (بالي) — من 2026-11-03 إلى 2026-11-07\n  الغرفة: غرفة مزدوجة — إفطار\n  رقم التأكيد: HTL-BALI");
    expect(hotels).toContain("• جراند استون بونشاك (بونشاك) — من 2026-10-31 إلى 2026-11-03\n  رقم الحجز: AD-4-8573-20261015-H1");
  });

  it("dates the drives with their time when known, and leaves out what was cancelled", () => {
    expect(text).toContain("• 2026-10-31 14:45 — المطار ← فندق بونشاك · رقم التأكيد: TRF-ARR");
    expect(text).toContain("• 2026-11-07 — فندق بالي ← المطار · رقم التأكيد: TRF-DEP");
    expect(text).not.toContain("استكشاف بونشاك");
  });

  it("ends with the trip link and the balance — or says it is paid", () => {
    expect(text).toContain("ملف رحلتك ومستنداتك:\nhttps://pkg.traveliun.com/trip/TOKEN123");
    expect(text).toContain("المتبقي من المبلغ: 2,500 SAR");
    expect(clientSummaryMessage({ hello: "", destination: null, serial: "S", bookings: [], link: null, remaining: 0, currency: "SAR" })).toContain("تم سداد كامل المبلغ");
  });
});

describe("«أرسل للعميل»", () => {
  it("drafts from the file: its client, its mobile, the balance after payments", async () => {
    const res = await draftClientMessage("op-1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.draft.to_phone).toBe("0541638023");
    expect(res.draft.body).toContain("عميلنا عميل تجريبي،");
    expect(res.draft.body).toContain("المتبقي من المبلغ: 2,500 SAR");
    expect(res.draft.body).toContain("/trip/TOKEN123");
    expect(res.draft.blocked).toBeNull();
  });

  it("says when the gate would refuse it, so the agent can only copy", async () => {
    state.gate = "not_allowed";
    const res = await draftClientMessage("op-1");
    expect(res.ok && res.draft.blocked).toBe("ops.err.clientNotAllowed");
  });

  it("sends the reviewed text to the file's mobile and keeps it in the log", async () => {
    const res = await sendClientMessageNow({ operation_id: "op-1", body: "نص معدّل" });
    expect(res).toEqual({ ok: true, result: "sent" });
    expect(state.sends).toEqual([{ phone: "0541638023", text: "نص معدّل" }]);
    expect(state.dispatches[0]).toMatchObject({ audience: "client", channel: "whatsapp", template: "client_summary", body: "نص معدّل", status: "sent", to_address: "0541638023" });
    expect(state.audits.map((a) => [a.action, a.entity_id])).toEqual([["dispatch.sent", "op-1"]]);
  });

  it("outside WhatsApp's 24 hours: held as a note, logged as held — never claimed as sent", async () => {
    state.result = "window";
    expect(await sendClientMessageNow({ operation_id: "op-1", body: "نص" })).toEqual({ ok: true, result: "window" });
    expect(state.dispatches[0]).toMatchObject({ status: "failed", sent_at: null });
    expect(state.audits.map((a) => a.action)).toEqual(["dispatch.held"]);
  });

  it("prepares the trip link with our numbers, and sends it only when pressed — as its template after the 24 hours", async () => {
    const res = await listPreparedMessages("op-1");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.list.items.map((m) => m.key)).toEqual(["trip_link"]);
    expect(res.list.items[0].body).toContain("• جراند استون بونشاك: AD-4-8573-20261015-H1");
    expect(state.sends).toEqual([]);

    expect(await sendClientMessageNow({ operation_id: "op-1", body: res.list.items[0].body, key: "trip_link" })).toEqual({ ok: true, result: "sent" });
    expect(state.extras[0]).toMatchObject({ template: { key: "bookings_confirmed" } });
    expect(state.dispatches[0]).toMatchObject({ audience: "client", template: "trip_link", status: "sent" });
  });

  it("refuses a prepared key that is no longer ready", async () => {
    expect(await sendClientMessageNow({ operation_id: "op-1", body: "نص", key: "hotel:x:y" })).toEqual({ ok: false, error: "trip.status.preparedGone" });
    expect(state.sends).toEqual([]);
  });

  it("never writes to a partner's client", async () => {
    state.partner = "partner-1";
    expect(await draftClientMessage("op-1")).toEqual({ ok: false, error: "ops.err.clientPartner" });
    expect(await sendClientMessageNow({ operation_id: "op-1", body: "نص" })).toEqual({ ok: false, error: "ops.err.clientPartner" });
    expect(state.sends).toEqual([]);
    expect(state.dispatches).toEqual([]);
  });

  it("refuses a file with no mobile, and records nothing when the provider refuses", async () => {
    state.mobile = null;
    expect(await draftClientMessage("op-1")).toEqual({ ok: false, error: "ops.err.clientNoPhone" });
    state.mobile = "0541638023";
    state.result = "off";
    expect(await sendClientMessageNow({ operation_id: "op-1", body: "نص" })).toEqual({ ok: false, error: "ops.err.clientOff" });
    expect(state.dispatches).toEqual([]);
    expect(state.audits).toEqual([]);
  });
});
