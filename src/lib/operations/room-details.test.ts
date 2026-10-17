import { describe, expect, it } from "vitest";
import { emptyDraftData, normalizeDraftData } from "@/lib/offer/draft-types";
import { BOARD_AR } from "@/components/offer-doc/labels";
import { applyRoomDetails, readRooms, roomDetailIssues, roomDetailsOpen, roomsJson, roomSpecFor, seededSpec, voucherStay, type BookingRoomSpec } from "./room-details";
import { planBookingsFromDraft } from "./seed-plan";
import { ROOM_SPEC_KEY, shownDetail } from "./voucher-dto";

const deluxeKing: BookingRoomSpec = {
  room_type_id: "double",
  room_category_id: "deluxe",
  bed_groups: [{ id: "k", beds: [{ bed_type_id: "king", quantity: 1 }] }],
  selected_bed_group_id: "k",
  bed_configuration_status: "guaranteed",
  view_ids: ["sea"],
  feature_ids: ["non_smoking"],
};

const stay = (rooms: Record<string, BookingRoomSpec> = {}, extra: Record<string, string> = {}) => ({
  title: "بولمان سيتي سنتر",
  city_name: "كوالالمبور",
  detail: { المدينة: "كوالالمبور", الغرفة: `غرفة ديلوكس — ${BOARD_AR.BB}`, النزلاء: "2 بالغ + 1 طفل", ...extra, ...(Object.keys(rooms).length ? { [ROOM_SPEC_KEY]: roomsJson(rooms) } : {}) },
});
const pullman = (country: string, en: string | null = "Pullman Kuala Lumpur City Centre") => ({ ar: "بولمان سيتي سنتر", en, country });

describe("the hotel voucher is in English", () => {
  it("in every country — Saudi Arabia, the Emirates and Oman too (the owner, 2026-10-17: «إنجليزي دائماً»)", () => {
    const locale = (c: string) => {
      const s = voucherStay(stay(), pullman(c));
      return s.ok ? s.locale : s.error;
    };
    expect(["MY", "TR", "GE"].map(locale)).toEqual(["en", "en", "en"]);
    expect(["SA", "AE", "OM"].map(locale)).toEqual(["en", "en", "en"]);
  });

  it("prints the room's details in English on an English voucher, the board and the guests too", () => {
    const s = voucherStay(stay({ الغرفة: deluxeKing }), pullman("MY"), { كوالالمبور: "Kuala Lumpur" });
    expect(s.ok && s.title).toBe("Pullman Kuala Lumpur City Centre");
    expect(s.ok && s.alt_name).toBe("بولمان سيتي سنتر");
    expect(s.ok && s.detail["الغرفة"]).toBe(
      "Double Room | Category: Deluxe | Beds: 1 × King Bed (Guaranteed) | View: Sea View | Features: Non-Smoking — Bed & breakfast",
    );
    expect(s.ok && [s.detail["المدينة"], s.detail["النزلاء"], s.city_name]).toEqual(["Kuala Lumpur", "2 adults + 1 child", "Kuala Lumpur"]);
    expect(s.ok && ROOM_SPEC_KEY in s.detail).toBe(false);
  });

  it("a stay the booking set to «العربية» keeps the Arabic name, the English one below", () => {
    const rooms = { الغرفة: { room_type_id: "twin", room_category_id: "superior" } };
    const s = voucherStay({ ...stay(), detail: { ...stay().detail, [ROOM_SPEC_KEY]: roomsJson(rooms, "ar") } }, { ar: "فندق المثال مسقط", en: "Example Muscat Hotel", country: "OM" });
    expect(s.ok && [s.title, s.alt_name, s.detail["الغرفة"]]).toEqual(["فندق المثال مسقط", "Example Muscat Hotel", `غرفة بسريرين منفصلين | الفئة: سوبيريور — ${BOARD_AR.BB}`]);
  });

  it("refuses an English voucher when the hotel's English name is missing or Arabic — never falls back", () => {
    expect(voucherStay(stay(), pullman("GE", null))).toEqual({ ok: false, error: "hotelName", locale: "en" });
    expect(voucherStay(stay(), pullman("TR", "بولمان سيتي سنتر"))).toEqual({ ok: false, error: "hotelName", locale: "en" });
    // not in /hotels at all: no English name, no country
    expect(voucherStay(stay(), null)).toEqual({ ok: false, error: "hotelUnknown", locale: "en" });
    // the booking's own «العربية» issues it in Arabic
    const arabic = voucherStay({ ...stay(), detail: { ...stay().detail, [ROOM_SPEC_KEY]: roomsJson({}, "ar") } }, null);
    expect(arabic.ok && [arabic.locale, arabic.title]).toEqual(["ar", "بولمان سيتي سنتر"]);
  });

  it("refuses a custom room name not verified in the voucher's language", () => {
    const custom: BookingRoomSpec = { room_type_id: "double", custom_room_name: { ar: "غرفة خاصة", en: "Special Room" }, custom_name_status: { ar: "verified", en: "draft" } };
    expect(voucherStay(stay({ الغرفة: custom }), pullman("GE"))).toEqual({ ok: false, error: "roomName", locale: "en" });
  });

  it("notes the beds under a custom name, and whether connecting rooms are guaranteed", () => {
    const room: BookingRoomSpec = {
      ...deluxeKing,
      feature_ids: ["connecting"],
      connecting_status: "on_request",
      custom_room_name: { ar: "غرفة ديلوكس كينغ", en: "Deluxe King Room" },
      custom_name_status: { ar: "verified", en: "verified" },
    };
    const s = voucherStay(stay({ الغرفة: room }), pullman("MY"));
    expect(s.ok && s.detail["الغرفة"]).toBe("Deluxe King Room — Bed & breakfast");
    expect(s.ok && s.notes).toEqual(["Beds: 1 × King Bed (Guaranteed)", "Connecting Rooms: On Request, Not Guaranteed"]);
  });

  it("an older booking with no room details keeps its own room text", () => {
    const s = voucherStay(stay(), pullman("MY"));
    expect(s.ok && s.detail["الغرفة"]).toBe("غرفة ديلوكس — Bed & breakfast");
  });
});

describe("«تفاصيل الغرفة» — after the hotel is confirmed", () => {
  it("is shown for a confirmed hotel only", () => {
    expect(roomDetailsOpen({ kind: "hotel", status: "pending" })).toBe(false);
    expect(roomDetailsOpen({ kind: "hotel", status: "in_flight" })).toBe(false);
    expect(roomDetailsOpen({ kind: "flight", status: "confirmed" })).toBe(false);
    expect(roomDetailsOpen({ kind: "hotel", status: "confirmed" })).toBe(true);
  });

  it("blocks a room both smoking and non-smoking, and connecting rooms with no state", () => {
    expect(roomDetailIssues({ room_type_id: "double", feature_ids: ["smoking", "non_smoking"] })).toContain("smoking_both");
    expect(roomDetailIssues({ room_type_id: "double", feature_ids: ["connecting"] })).toContain("connecting");
    expect(roomDetailIssues({ room_type_id: null })).toContain("room_type");
    expect(applyRoomDetails(stay().detail, { الغرفة: { room_type_id: "double", feature_ids: ["smoking", "non_smoking"] } }, "auto")).toBeNull();
  });

  it("saves the spec under one key and rewrites the line in the catalogue's Arabic, keeping the board", () => {
    const detail = applyRoomDetails(stay().detail, { الغرفة: deluxeKing }, "en")!;
    expect(detail["الغرفة"]).toBe(
      `غرفة مزدوجة | الفئة: ديلوكس | الأسرّة: 1 × سرير كينغ (مضمون) | الإطلالة: إطلالة على البحر | المميزات: لغير المدخنين — ${BOARD_AR.BB}`,
    );
    expect(readRooms(detail).locale).toBe("en");
    expect(readRooms(detail).rooms["الغرفة"].room_type_id).toBe("double");
    expect(Object.keys(shownDetail(detail))).not.toContain(ROOM_SPEC_KEY);
    // a line the booking does not have is refused
    expect(applyRoomDetails(stay().detail, { "الغرفة 7": deluxeKing }, "auto")).toBeNull();
  });

  it("opens on what the line's text says when nothing was saved", () => {
    expect(roomSpecFor({ الغرفة: `Deluxe King Room — ${BOARD_AR.BB}` }, "الغرفة")).toEqual({ room_type_id: "double", room_category_id: "deluxe" });
  });
});

describe("the pull carries the room's codes", () => {
  it("the offer's codes first, else the room read from its name", () => {
    expect(seededSpec({ room_type_name: "جناح", room_type_code: "suite", room_category_code: "executive", suite_subtype_code: "junior" })).toEqual({
      room_type_id: "suite",
      room_category_id: "executive",
      suite_subtype_id: "junior",
    });
    expect(seededSpec({ room_type_name: "Deluxe Twin Room" })).toEqual({ room_type_id: "twin", room_category_id: "deluxe" });
    expect(seededSpec({ room_type_name: "أجنحة رويال أوشن" })).toBeNull();

    const data = normalizeDraftData({
      ...emptyDraftData(),
      trip: { ...emptyDraftData().trip, adults: 2, nights: 3, arrival_date: "2026-11-20" },
      scope: { ...emptyDraftData().scope, hotels: true },
      cities: [{ key: "كوالالمبور#1", nights: 3, check_in: "2026-11-20", check_out: "2026-11-23", city_name: "كوالالمبور" }],
      hotels: [
        {
          id: "s1",
          city_name: "كوالالمبور",
          hotel_name: "بولمان سيتي سنتر",
          hotel_id: null,
          nights: 0,
          rooms_count: 2,
          manual_currency: "SAR",
          rooms: [
            { room_type_id: null, room_type_name: "غرفة مزدوجة ديلوكس", board_type: "BB", price: null, room_type_code: "double", room_category_code: "deluxe", suite_subtype_code: null },
            { room_type_id: null, room_type_name: "Superior Twin", board_type: "BB", price: null },
          ],
        },
      ],
    } as unknown as Record<string, unknown>);
    const hotel = planBookingsFromDraft(data, "شروط").find((r) => r.kind === "hotel")!;
    expect(readRooms(hotel.detail).rooms).toEqual({
      "الغرفة 1": { room_type_id: "double", room_category_id: "deluxe", suite_subtype_id: null },
      // the draft read «Superior Twin» into codes when it loaded (the offer side's normalizeDraftData)
      "الغرفة 2": { room_type_id: "twin", room_category_id: "superior", suite_subtype_id: null },
    });
  });
});
