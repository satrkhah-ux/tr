import { describe, expect, it } from "vitest";
import { draftToPreviewOffer, repackageToPreviewOffer } from "./preview-dto";
import { emptyDraftData } from "./draft-types";
import { emptyRepackageData, type ExtractedPackage } from "@/lib/repackage/repackage-types";

/**
 * Both wizards preview the real client document through these adapters. Two
 * things must hold: the preview agrees with what production will create, and —
 * for the repackage path especially — the SUPPLIER'S price never leaks into a
 * tree the client can see.
 */
function extracted(over: Partial<ExtractedPackage> = {}): ExtractedPackage {
  return {
    destination: "ماليزيا",
    country: "ماليزيا",
    cities: [{ city_name: "كوالالمبور", nights: 4 }],
    trip_nights: 4,
    arrival_date: "2026-08-01",
    departure_date: "2026-08-05",
    adults: 2,
    children: 1,
    infants: 0,
    hotels: [
      {
        city_name: "كوالالمبور",
        hotel_name: "فندق سيزونز",
        room_type: "ديلوكس",
        board: "شامل الإفطار",
        nights: 4,
        check_in: "2026-08-01",
        check_out: "2026-08-05",
      },
    ],
    flights: [],
    transfers: ["الاستقبال من المطار"],
    includes: ["الفنادق"],
    excludes: ["الطيران الدولي"],
    visas: ["تأشيرة ماليزيا"],
    terms: ["بند تجريبي"],
    supplier_total: 3833.33,
    supplier_currency: "SAR",
    ...over,
  };
}

describe("repackageToPreviewOffer", () => {
  const data = { ...emptyRepackageData(), extracted: extracted(), final_total: 4600, final_currency: "SAR" };
  const preview = repackageToPreviewOffer(data)!;

  it("returns null before anything is imported", () => {
    expect(repackageToPreviewOffer(emptyRepackageData())).toBeNull();
  });

  it("shows OUR sell price, never the supplier's cost", () => {
    expect(preview.total).toBe(4600);
    expect(JSON.stringify(preview)).not.toContain("3833");
    expect(JSON.stringify(preview)).not.toContain("supplier");
  });

  it("pairs each city with its hotel and normalizes the board text", () => {
    expect(preview.hotels).toHaveLength(1);
    expect(preview.hotels[0].city_name).toBe("كوالالمبور");
    expect(preview.hotels[0].hotel_name).toBe("فندق سيزونز");
    // «شامل الإفطار» is free text on a supplier PDF; the document needs a code
    expect(preview.hotels[0].board_type).toBe("BB");
  });

  it("falls back to positional pairing when the city names do not match", () => {
    const odd = repackageToPreviewOffer({
      ...data,
      extracted: extracted({ cities: [{ city_name: "مدينة أخرى", nights: 3 }] }),
    })!;
    expect(odd.hotels[0].hotel_name).toBe("فندق سيزونز");
  });

  it("carries the lists the document prints", () => {
    expect(preview.includes).toEqual(["الفنادق"]);
    expect(preview.excludes).toEqual(["الطيران الدولي"]);
    expect(preview.visas).toEqual(["تأشيرة ماليزيا"]);
    expect(preview.transport).toEqual(["الاستقبال من المطار"]);
    expect(preview.terms).toEqual(["بند تجريبي"]);
  });

  it("prints a placeholder serial until the offer is produced", () => {
    expect(preview.serial).toBe("—");
    expect(repackageToPreviewOffer({ ...data, produced_serial: "AD-1-1000-20260801" })!.serial).toBe(
      "AD-1-1000-20260801",
    );
  });
});

describe("draftToPreviewOffer", () => {
  it("derives the stay dates from the arrival date and the nights chain", () => {
    const draft = emptyDraftData();
    draft.trip = { ...draft.trip, country: "ماليزيا", arrival_date: "2026-08-01", nights: 5, days: 6 };
    draft.cities = [
      { city_name: "كوالالمبور", nights: 3, check_in: null, check_out: null },
      { city_name: "بينانج", nights: 2, check_in: null, check_out: null },
    ];
    draft.hotels = [
      { city_name: "كوالالمبور", hotel_id: null, hotel_name: "أ", room_type_id: null, room_type_name: "", board_type: "BB", rooms_count: 1 },
      { city_name: "بينانج", hotel_id: null, hotel_name: "ب", room_type_id: null, room_type_name: "", board_type: "BB", rooms_count: 1 },
    ];
    const preview = draftToPreviewOffer(draft);
    expect(preview.hotels[0].check_in).toBe("2026-08-01");
    expect(preview.hotels[0].check_out).toBe("2026-08-04");
    expect(preview.hotels[1].check_in).toBe("2026-08-04");
    expect(preview.hotels[1].check_out).toBe("2026-08-06");
    expect(preview.duration).toBe("5 ليالي - 6 أيام");
  });

  it("prefers the fixed final total over the line sum", () => {
    const draft = emptyDraftData();
    draft.pricing = {
      items: [
        { item_type: "hotel", description: "x", quantity: 1, buy_price: 10, buy_currency: "SAR", sell_price: 100, sell_currency: "SAR" },
      ],
      display_currency: "SAR",
      final_total: 4599,
    };
    expect(draftToPreviewOffer(draft).total).toBe(4599);
    expect(draftToPreviewOffer({ ...draft, pricing: { ...draft.pricing, final_total: null } }).total).toBe(100);
  });

  it("never carries a buy price into the preview", () => {
    const draft = emptyDraftData();
    draft.pricing = {
      items: [
        { item_type: "hotel", description: "x", quantity: 1, buy_price: 777, buy_currency: "SAR", sell_price: 100, sell_currency: "SAR" },
      ],
      display_currency: "SAR",
      final_total: null,
    };
    expect(JSON.stringify(draftToPreviewOffer(draft))).not.toContain("777");
  });

  it("omits days that carry no written text", () => {
    const draft = emptyDraftData();
    draft.days = [
      { day_number: 1, date: null, city_name: "كوالالمبور", title: "", activities: [], weather: null, ai_generated: false },
      { day_number: 2, date: null, city_name: "كوالالمبور", title: "جولة", activities: [], weather: null, ai_generated: false },
    ];
    expect(draftToPreviewOffer(draft).days).toHaveLength(1);
  });
});
