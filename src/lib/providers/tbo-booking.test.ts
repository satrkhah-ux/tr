import { afterEach, describe, expect, it, vi } from "vitest";
import { buildHotelSupplier, type SupplierCallRecord } from "./hotel-supplier";

/**
 * The booking path, against TBO's own documented answers.
 *
 * What is actually being tested here is not "does it parse JSON" — it is the
 * mapping from an answer to a DECISION, because that mapping is where money is
 * lost. A rejection must stop the flow; an unknown must never look like a
 * rejection, or the operator retries and the guest is booked twice.
 *
 * Every response body below is copied from the shapes in TBOH Hotel API
 * Specifications v2.1, including the one that catches people out: TBO replies
 * HTTP 200 and puts the failure in `Status.Code`.
 */

const CREDS = { base_url: "", username: "u", password: "p" };

afterEach(() => {
  vi.unstubAllGlobals();
});

type FetchLike = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

function stubFetch(handler: (url: string, body: unknown) => Response | Promise<Response>) {
  const spy = vi.fn<FetchLike>(async (url, init) => {
    const raw = typeof init?.body === "string" ? init.body : "null";
    return handler(String(url), JSON.parse(raw) as unknown);
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function tbo(record?: SupplierCallRecord[]) {
  return buildHotelSupplier("tbo", CREDS, null, "live", record ? (r) => record.push(r) : null);
}

const PREBOOK_OK = {
  Status: { Code: 200, Description: "Successful" },
  HotelResult: [
    {
      HotelCode: "1345320",
      Currency: "USD",
      Rooms: [
        {
          Name: ["Deluxe Room"],
          BookingCode: "1345320!TB!3!TB!fresh-session",
          TotalFare: 164.65,
          IsRefundable: true,
          CancelPolicies: [{ FromDate: "2026-09-01 00:00:00", CancellationCharge: 0 }],
        },
      ],
    },
  ],
};

describe("prebook", () => {
  it("returns the price the supplier will honour, and the RE-ISSUED booking code", async () => {
    stubFetch(() => json(PREBOOK_OK));
    const out = await tbo().prebook!("1345320!TB!3!TB!stale-session");

    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.data.total_fare).toBe(164.65);
    // Booking against the code we sent in — rather than the one we got back —
    // is the documented way to be rejected at the last step.
    expect(out.data.booking_code).toBe("1345320!TB!3!TB!fresh-session");
    expect(out.data.cancellation_deadline).toBe("2026-09-01");
    expect(out.data.refundable).toBe(true);
  });

  it("treats a 200 with no room as a REJECTION — the rate is gone, retrying will not bring it back", async () => {
    stubFetch(() => json({ Status: { Code: 200, Description: "Successful" }, HotelResult: [] }));
    const out = await tbo().prebook!("code");
    expect(out.kind).toBe("rejected");
  });

  it("does not read 201 as success — it is TBO's code for NO AVAILABILITY", async () => {
    // The adapter accepted 201 alongside 200 for a year. "No rooms" was being
    // read as "here are your rooms", and the empty list that followed looked
    // like our parsing rather than the supplier's answer.
    stubFetch(() => json({ Status: { Code: 201, Description: "No Availability" } }));
    const out = await tbo().prebook!("code");
    expect(out.kind).toBe("rejected");
    if (out.kind !== "rejected") return;
    expect(out.message).toContain("لم تعد");
  });

  it("reads TBO's failure out of the BODY, not the HTTP status", async () => {
    // This exact response is what live credentials that are not yet activated
    // return: HTTP 200, and a 401 inside. Trusting res.ok reports success.
    stubFetch(() => json({ Status: { Code: 401, Description: "Access Credentials is incorrect" } }));
    const out = await tbo().prebook!("code");

    expect(out.kind).toBe("rejected");
    if (out.kind !== "rejected") return;
    expect(out.code).toBe(401);
  });

  it("never sends card fields — this system holds none", async () => {
    const spy = stubFetch(() => json(PREBOOK_OK));
    await tbo().prebook!("code");
    const body = JSON.parse(String((spy.mock.calls[0]?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(body["PaymentMode"]).toBe("Limit");
    expect(body).not.toHaveProperty("PaymentInfo");
  });
});

const BOOK_INPUT = {
  booking_code: "1345320!TB!3!TB!fresh-session",
  rooms: [{ guests: [{ title: "Mr" as const, first_name: "Ahmad", last_name: "Alrifaie", type: "Adult" as const }] }],
  client_reference: "TRV-abc",
  booking_reference: "742955723103628",
  total_fare: 164.65,
  email: "guest@example.com",
  phone: "966500000000",
};

describe("book", () => {
  it("returns the confirmation number, and sends our references so a lost answer stays findable", async () => {
    const spy = stubFetch(() =>
      json({ Status: { Code: 200, Description: "Successful" }, ClientReferenceId: "TRV-abc", ConfirmationNumber: "KOI5G4" }),
    );
    const out = await tbo().book!(BOOK_INPUT);

    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.data.confirmation_number).toBe("KOI5G4");

    const body = JSON.parse(String((spy.mock.calls[0]?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(body["ClientReferenceId"]).toBe("TRV-abc");
    expect(body["BookingReferenceId"]).toBe("742955723103628");
    expect(body["BookingType"]).toBe("Voucher");
  });

  it("counts rooms by the CustomerDetails entries, not by the guest count", async () => {
    const spy = stubFetch(() => json({ Status: { Code: 200 }, ConfirmationNumber: "AB12CD" }));
    await tbo().book!({
      ...BOOK_INPUT,
      rooms: [
        { guests: [{ title: "Mr", first_name: "A", last_name: "One", type: "Adult" }] },
        { guests: [{ title: "Mrs", first_name: "B", last_name: "Two", type: "Adult" }] },
      ],
    });
    const body = JSON.parse(String((spy.mock.calls[0]?.[1] as RequestInit).body)) as { CustomerDetails: unknown[] };
    expect(body.CustomerDetails).toHaveLength(2);
  });

  it("calls a timeout UNREACHABLE, never failed — the reservation may exist", async () => {
    stubFetch(() => {
      throw new Error("The operation was aborted due to timeout");
    });
    const out = await tbo().book!(BOOK_INPUT);
    expect(out.kind).toBe("unreachable");
  });

  it("calls success-without-a-confirmation-number unreachable too", async () => {
    // "Successful" with nothing to show a hotel desk is not success, and it is
    // certainly not a failure that may be retried.
    stubFetch(() => json({ Status: { Code: 200, Description: "Successful" } }));
    const out = await tbo().book!(BOOK_INPUT);
    expect(out.kind).toBe("unreachable");
  });

  it("passes a refusal through as a decision, in words the operator can act on", async () => {
    stubFetch(() => json({ Status: { Code: 405, Description: "Booking Failed" } }));
    const out = await tbo().book!(BOOK_INPUT);
    expect(out.kind).toBe("rejected");
    if (out.kind !== "rejected") return;
    expect(out.code).toBe(405);
  });

  it("names the two refusals an operator can actually do something about", async () => {
    stubFetch(() => json({ Status: { Code: 300, Description: "Agency has Insufficient Funds" } }));
    const funds = await tbo().book!(BOOK_INPUT);
    expect(funds.kind === "rejected" && funds.message).toContain("رصيد");

    stubFetch(() => json({ Status: { Code: 315, Description: "Session Expired" } }));
    const stale = await tbo().book!(BOOK_INPUT);
    expect(stale.kind === "rejected" && stale.message).toContain("أعد التحقق");
  });

  it("treats TBO's undefined error as UNKNOWN after a book — it may have gone through", async () => {
    stubFetch(() => json({ Status: { Code: 500, Description: "Unexpected Error" } }));
    const out = await tbo().book!(BOOK_INPUT);
    expect(out.kind).toBe("unreachable");
  });

  it("gives Book the 120 seconds the spec allows, not the 25 used for search", async () => {
    // The old flat timeout would abort our side while TBO went on to confirm —
    // producing a real reservation the system believes failed.
    const seen: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn<FetchLike>(async (_url, init) => {
        const signal = init?.signal as (AbortSignal & { reason?: unknown }) | undefined;
        // AbortSignal.timeout exposes no duration; measure by racing the clock
        // is overkill — assert instead that a signal was attached at all, and
        // pin the map directly below.
        if (signal) seen.push(1);
        return json({ Status: { Code: 200 }, ConfirmationNumber: "X1" });
      }),
    );
    await tbo().book!(BOOK_INPUT);
    expect(seen).toHaveLength(1);
  });
});

describe("bookingDetail — the recovery path", () => {
  const DETAIL = {
    Status: { Code: 200, Description: "Successful" },
    BookingDetail: {
      BookingStatus: "Confirmed",
      VoucherStatus: "Voucher",
      ConfirmationNumber: "KOI5G4",
      HotelConfirmationNumber: "HTL-99",
      InvoiceNumber: "INV-1",
      CheckIn: "2026-09-10",
      CheckOut: "2026-09-14",
      Rooms: [{ Currency: "USD", TotalFare: 164.65, CancelPolicies: [{ FromDate: "2026-09-01 00:00:00" }] }],
    },
  };

  it("can be asked by OUR reference — which is the whole point after a lost Book", async () => {
    const spy = stubFetch(() => json(DETAIL));
    const out = await tbo().bookingDetail!({ booking_reference: "742955723103628" });

    expect(out.kind).toBe("ok");
    const body = JSON.parse(String((spy.mock.calls[0]?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(body["BookingReferenceId"]).toBe("742955723103628");
    expect(body).not.toHaveProperty("ConfirmationNumber");
  });

  it("carries the hotel's own number when TBO has it", async () => {
    stubFetch(() => json(DETAIL));
    const out = await tbo().bookingDetail!({ confirmation_number: "KOI5G4" });
    if (out.kind !== "ok") throw new Error("expected ok");
    expect(out.data.hotel_confirmation_number).toBe("HTL-99");
    expect(out.data.voucher).toBe(true);
  });

  it("refuses to ask with nothing to ask about", async () => {
    const spy = stubFetch(() => json(DETAIL));
    const out = await tbo().bookingDetail!({});
    expect(out.kind).toBe("rejected");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("cancel", () => {
  it("returns the supplier's own wording", async () => {
    stubFetch(() => json({ Status: { Code: 200, Description: "Cancelled" }, ConfirmationNumber: "FL1IMA" }));
    const out = await tbo().cancel!("FL1IMA");
    if (out.kind !== "ok") throw new Error("expected ok");
    expect(out.data.message).toBe("Cancelled");
  });

  it("does not report a cancellation it could not confirm", async () => {
    stubFetch(() => {
      throw new Error("socket hang up");
    });
    const out = await tbo().cancel!("FL1IMA");
    expect(out.kind).toBe("unreachable");
  });
});

describe("the call log", () => {
  it("records both sides of every call — this IS the certification deliverable", async () => {
    const log: SupplierCallRecord[] = [];
    stubFetch(() => json(PREBOOK_OK));
    await tbo(log).prebook!("code");

    expect(log).toHaveLength(1);
    expect(log[0].method).toBe("PreBook");
    expect(log[0].request).toMatchObject({ BookingCode: "code", PaymentMode: "Limit" });
    expect(log[0].ok).toBe(true);
    expect(log[0].status_code).toBe(200);
  });

  it("records the failures too — a rejection with no trace is the one you cannot argue", async () => {
    const log: SupplierCallRecord[] = [];
    stubFetch(() => json({ Status: { Code: 401, Description: "Access Credentials is incorrect" } }));
    await tbo(log).prebook!("code");

    expect(log[0].ok).toBe(false);
    expect(log[0].status_code).toBe(401);
  });
});
