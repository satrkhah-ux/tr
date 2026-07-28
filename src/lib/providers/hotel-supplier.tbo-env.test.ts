import { afterEach, describe, expect, it, vi } from "vitest";
import { buildHotelSupplier } from "./hotel-supplier";

/**
 * The sandbox guard.
 *
 * hotel_suppliers.environment existed as a column for a long time while NOTHING
 * read it: an admin could set a TBO row to 'sandbox' and every call still went to
 * the built-in production host. That is the worst kind of setting — one that
 * looks obeyed and isn't. TBO issues a separate host for testing, so the only
 * honest behaviour when marked 'sandbox' with no host entered is to refuse and
 * say so, rather than invent a hostname or silently hit live.
 *
 * These tests assert the refusal happens BEFORE any network call.
 */
const CREDS = { base_url: "", username: "u", password: "p" };

afterEach(() => {
  vi.unstubAllGlobals();
});

/** typed so `spy.mock.calls[0][0]` is the URL — that is what proves WHICH host was hit. */
type FetchLike = (url: string | URL | Request) => Promise<Response>;

/** fetch that fails the test if it is ever reached. */
function forbidFetch() {
  const spy = vi.fn<FetchLike>(() => {
    throw new Error("network call escaped the sandbox guard");
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

/** fetch that answers CountryList successfully, so we can read the host it hit. */
function okFetch() {
  const spy = vi.fn<FetchLike>(async () =>
    new Response(JSON.stringify({ Status: { Code: 200 }, CountryList: [] })),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("TBO sandbox guard", () => {
  it("refuses — without calling out — when marked sandbox with no host", async () => {
    const spy = forbidFetch();
    const tbo = buildHotelSupplier("tbo", CREDS, null, "sandbox");

    const result = await tbo.testConnection();

    expect(result.ok).toBe(false);
    expect(result.message).toContain("تجريبي");
    expect(spy).not.toHaveBeenCalled();
  });

  it("returns no hotels rather than live ones in that state", async () => {
    const spy = forbidFetch();
    const tbo = buildHotelSupplier("tbo", CREDS, null, "sandbox");

    const hotels = await tbo.searchHotels({
      city: "Dubai",
      country_code: "AE",
      check_in: "2026-09-10",
      check_out: "2026-09-14",
      adults: 2,
      children: 0,
      rooms: 1,
    });

    expect(hotels).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("proceeds once the sandbox host TBO issued is stored", async () => {
    const spy = okFetch();
    const tbo = buildHotelSupplier("tbo", CREDS, "https://sandbox.example/TBOHolidays_HotelAPI", "sandbox");

    const result = await tbo.testConnection();

    expect(result.ok).toBe(true);
    expect(spy).toHaveBeenCalledOnce();
    expect(String(spy.mock.calls[0]?.[0])).toContain("sandbox.example");
  });

  it("leaves live alone — the built-in host stays the default there", async () => {
    const spy = okFetch();
    const tbo = buildHotelSupplier("tbo", CREDS, null, "live");

    const result = await tbo.testConnection();

    expect(result.ok).toBe(true);
    expect(String(spy.mock.calls[0]?.[0])).toContain("api.tbotechnology.in");
  });
});
