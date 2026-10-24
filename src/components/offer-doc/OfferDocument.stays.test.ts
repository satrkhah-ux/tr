import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OfferDocument, stayRuns } from "./OfferDocument";
import { AR } from "./labels";
import { emptyDraftData, normalizeDraftHotel, type DraftData } from "@/lib/offer/draft-types";
import { draftToPreviewOffer } from "@/lib/offer/preview-dto";

/**
 * Two hotels in one city (order 1, ق5): the stays print in the order the group
 * checks in, and two hotels on the very same dates print side by side under
 * «إقامة موزّعة على فندقين» — one stay, its rooms split — never as two stays
 * that double the nights.
 */
function draft(second: "same" | "after"): DraftData {
  const data = emptyDraftData();
  data.trip = { ...data.trip, country: "ماليزيا", destination: "ماليزيا", arrival_date: "2026-10-20", nights: 6, days: 7, adults: 3 };
  data.cities = [
    { city_name: "كوالالمبور", nights: 4, check_in: null, check_out: null },
    { city_name: "لنكاوي", nights: 2, check_in: null, check_out: null },
  ];
  data.hotels = [
    normalizeDraftHotel({ city_name: "كوالالمبور", hotel_name: "فندق أ", rooms_count: 2, room_type_name: "ديلوكس", board_type: "BB", ...(second === "after" ? { nights: 2 } : {}) }),
    normalizeDraftHotel({ city_name: "كوالالمبور", hotel_name: "فندق ب", rooms_count: 1, room_type_name: "جناح", board_type: "BB", ...(second === "same" ? { dates: "same" } : {}) }),
    normalizeDraftHotel({ city_name: "لنكاوي", hotel_name: "فندق ج", rooms_count: 2, room_type_name: "ديلوكس", board_type: "BB" }),
  ];
  return data;
}

const render = (data: DraftData) => renderToStaticMarkup(createElement(OfferDocument, { variant: "client", offer: draftToPreviewOffer(data) }));

describe("OfferDocument — a stay split over two hotels", () => {
  it("prints «إقامة موزّعة على فندقين» over the two hotels of the same dates, side by side (acceptance ب)", () => {
    const html = render(draft("same"));
    const heading = html.indexOf(AR.splitStay(2));
    expect(AR.splitStay(2)).toBe("إقامة موزّعة على فندقين");
    expect(heading).toBeGreaterThan(-1);
    expect(html.split(AR.splitStay(2)).length - 1).toBe(1);
    const [a, b, c] = ["فندق أ", "فندق ب", "فندق ج"].map((n) => html.indexOf(`<h3>${n}</h3>`));
    expect(heading < a && a < b && b < c).toBe(true);
    // the trip is 6 nights, not 4 + 4 + 2
    expect(html).toContain(AR.daysNights(7, 6));
  });

  it("prints two hotels one after the other as two ordinary stays", () => {
    const html = render(draft("after"));
    expect(html).not.toContain(AR.splitStay(2));
    expect(html).toContain(AR.daysNights(7, 6));
  });

  it("orders the stays by check-in and keeps same-dates hotels of one city together", () => {
    const s = (city: string, name: string, check_in: string | null, check_out: string | null) => ({ city_name: city, hotel_name: name, check_in, check_out });
    const runs = stayRuns([
      s("لنكاوي", "ج", "2026-10-24", "2026-10-26"),
      s("كوالالمبور", "أ", "2026-10-20", "2026-10-24"),
      s("بينانج", "بلا تاريخ", null, null),
      s("كوالالمبور", "ب", "2026-10-20", "2026-10-24"),
      s("لنكاوي", "د", "2026-10-24", "2026-10-25"),
    ]);
    expect(runs.map((r) => r.map((h) => h.hotel_name))).toEqual([["أ", "ب"], ["ج"], ["د"], ["بلا تاريخ"]]);
  });
});

describe("OfferDocument — the hotel's own name for the room", () => {
  it("prints beside the catalogue's name, as text", () => {
    const data = draft("after");
    data.hotels[0] = { ...data.hotels[0], rooms: data.hotels[0].rooms.map((r) => ({ ...r, hotel_room_name: "Deluxe <b>Sea</b> View" })) };
    const html = render(data);
    expect(html).toContain("ديلوكس — Deluxe &lt;b&gt;Sea&lt;/b&gt; View × 2");
    expect(html).not.toContain("<b>Sea</b>");
    // the other stays, which have none, print as before
    expect(render(draft("after"))).not.toContain(" — Deluxe");
  });
});
