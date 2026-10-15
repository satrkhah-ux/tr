import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OfferDocument } from "@/components/offer-doc/OfferDocument";
import { catalogOptions } from "@/components/traveliun/generator/hotels/RoomTypePicker";
import { ROOM_TYPES } from "@/lib/catalog/room-catalog";
import {
  codesFromName,
  deriveCityDates,
  emptyDraftData,
  inheritRoomType,
  normalizeDraftData,
  normalizeDraftHotel,
  pickRoom,
  roomCodes,
  roomTypeNames,
  roomTypesText,
  stayTotal,
  withRooms,
  type DraftData,
} from "./draft-types";
import { hotelForCity, renameRooms, roomSuggestions } from "./basic";
import { draftToPreviewOffer } from "./preview-dto";
import { validateDraft } from "./draft-validation";
import { withRequiredAnswers } from "./draft-test-helpers";

/**
 * The owner's room catalogue on the offer side (2026-10-15): the employee picks
 * a type (and optionally a category / suite type) in Arabic, the room keeps the
 * codes for operations, and its name — what prints, prices and is remembered —
 * is the Arabic composed name. Old files keep the names they were saved with.
 */

const DOUBLE_DELUXE = "غرفة مزدوجة | الفئة: ديلوكس";

function draftWith(rooms: Parameters<typeof withRooms>[1]): DraftData {
  const data = emptyDraftData();
  data.trip = { ...data.trip, country: "ماليزيا", destination: "ماليزيا", arrival_date: "2026-10-20", days: 4, nights: 3, adults: 2 };
  data.cities = deriveCityDates("2026-10-20", [{ city_name: "كوالالمبور", nights: 3, check_in: null, check_out: null }]);
  data.hotels = [withRooms(normalizeDraftHotel({ city_name: "كوالالمبور", hotel_name: "فندق أ" }), rooms)];
  return data;
}

describe("picking a room from the catalogue", () => {
  it("sets the codes and the Arabic composed name; the old table's id is left empty", () => {
    expect(pickRoom({ room_type_code: "double", room_category_code: "deluxe" })).toEqual({
      room_type_id: null,
      room_type_name: DOUBLE_DELUXE,
      room_type_code: "double",
      room_category_code: "deluxe",
      suite_subtype_code: null,
    });
  });

  it("asks the suite type only of a suite, and a category only with a type", () => {
    expect(pickRoom({ room_type_code: "suite", suite_subtype_code: "junior" }).room_type_name).toBe("جناح | نوع الجناح: جونيور");
    expect(pickRoom({ room_type_code: "double", suite_subtype_code: "junior" }).suite_subtype_code).toBeNull();
    expect(pickRoom({ room_type_code: null, room_category_code: "deluxe" })).toMatchObject({ room_type_name: "", room_category_code: null });
  });

  it("reads a picked name back exactly — the suite type included", () => {
    const suite = pickRoom({ room_type_code: "suite", room_category_code: "executive", suite_subtype_code: "executive" });
    expect(codesFromName(suite.room_type_name)).toEqual({ room_type_code: "suite", room_category_code: "executive", suite_subtype_code: "executive" });
  });

  it("offers the 12 types in Arabic, the same list for every hotel", () => {
    const options = catalogOptions(ROOM_TYPES, "ar");
    expect(options).toHaveLength(12);
    expect(options.every((o) => /[؀-ۿ]/.test(o.label))).toBe(true);
    expect(options[1]).toEqual({ value: "double", label: "غرفة مزدوجة" });
  });

  it("a trip default named after a type reaches every room with its codes", () => {
    const line = normalizeDraftHotel({ city_name: "كوالالمبور", room_type_name: "" });
    const next = inheritRoomType(line, "", "جناح");
    expect(next.rooms[0]).toMatchObject({ room_type_name: "جناح", room_type_code: "suite" });
    const basic = hotelForCity({ trip: { ...emptyDraftData().trip, rooms: 2, default_room_type_name: "غرفة ثلاثية" } }, "كوالالمبور", "SAR");
    expect(basic.rooms.map((r) => r.room_type_code)).toEqual(["triple", "triple"]);
    expect(renameRooms(basic, DOUBLE_DELUXE).rooms[1]).toMatchObject({ room_type_code: "double", room_category_code: "deluxe" });
  });
});

describe("an old draft", () => {
  const raw = {
    hotels: [
      {
        city_name: "كوالالمبور",
        hotel_name: "فندق أ",
        rooms: [
          { room_type_id: "11111111-1111-1111-1111-111111111111", room_type_name: "Deluxe King Room", board_type: "BB", price: 900 },
          { room_type_id: null, room_type_name: "غرفة VIP", board_type: "BB", price: 400 },
        ],
      },
    ],
  };

  it("opens with the same names and totals; codes are read from the names that read as something", () => {
    const [line] = normalizeDraftData(raw).hotels;
    expect(line.rooms.map((r) => r.room_type_name)).toEqual(["Deluxe King Room", "غرفة VIP"]);
    expect(stayTotal(line)).toBe(1300);
    expect(roomTypesText(line.rooms)).toBe("Deluxe King Room + غرفة VIP");
    expect(line.rooms[0]).toMatchObject({ room_type_code: "double", room_category_code: "deluxe" });
    expect(line.rooms[1].room_type_code).toBeUndefined();
    expect(roomCodes(line.rooms[1]).room_type_code).toBeNull();
  });

  it("drops the deleted table's id, so issuing it never names a missing room_types row", () => {
    const [line] = normalizeDraftData(raw).hotels;
    expect(line.room_type_id).toBeNull();
    expect(line.rooms.every((r) => r.room_type_id === null)).toBe(true);
    // a named room is still a stated room
    const data = withRequiredAnswers(draftWith(line.rooms));
    expect(validateDraft(data).blocking.some((i) => i.invariant?.code === "hotel_missing_room_or_board")).toBe(false);
  });

  it("keeps a picked room's codes on reopening", () => {
    const [line] = normalizeDraftData({ hotels: [{ city_name: "كوالالمبور", rooms: [{ ...pickRoom({ room_type_code: "family", room_category_code: "superior" }), board_type: "HB", price: 1 }] }] }).hotels;
    expect(line.rooms[0]).toMatchObject({ room_type_name: "غرفة عائلية | الفئة: سوبيريور", room_type_code: "family", room_category_code: "superior" });
  });
});

describe("the programme", () => {
  it("prints the room in Arabic — «النوع | الفئة: …»", () => {
    const data = draftWith([{ ...pickRoom({ room_type_code: "double", room_category_code: "deluxe" }), board_type: "BB", price: 500 }]);
    const preview = draftToPreviewOffer(data);
    expect(preview.hotels[0].room_type).toBe(DOUBLE_DELUXE);
    const html = renderToStaticMarkup(createElement(OfferDocument, { variant: "client", offer: preview }));
    expect(html).toContain(DOUBLE_DELUXE);
  });
});

describe("an empty room_types table", () => {
  it("leaves the readers working: no names, the clear list still offered", () => {
    expect(roomTypeNames([])).toEqual([]);
    expect(roomSuggestions([], "h1").length).toBeGreaterThan(0);
    expect(normalizeDraftData({ hotels: [{ city_name: "x" }] }).hotels[0].rooms).toHaveLength(1);
  });
});
