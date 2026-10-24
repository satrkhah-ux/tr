import { describe, expect, it } from "vitest";
import {
  addStay,
  deriveCityDates,
  emptyDraftData,
  HOTEL_ROOM_NAME_MAX,
  hotelRoomName,
  normalizeDraftHotel,
  resizeRooms,
  roomTypesText,
  withRooms,
  type DraftData,
  type DraftRoomSpec,
} from "./draft-types";
import { renameRooms } from "./basic";
import { validateDraft } from "./draft-validation";
import { withRequiredAnswers } from "./draft-test-helpers";

/**
 * Multi-room hotel lines.
 *
 * A city often needs more than one room and they are not alike — a double for
 * the family plus a single that is really the driver's, booked but never
 * labelled as such on the client document. rooms[] is the truth; rooms_count and
 * the room-1 scalars only mirror it, and everything here exists to prove those
 * two can never disagree.
 */

function draftWithHotel(rooms: { room_type_name: string; board_type: "BB" | "HB" | null }[]): DraftData {
  const data = emptyDraftData();
  data.trip = { ...data.trip, country: "أذربيجان", arrival_date: "2026-08-01", days: 4, nights: 3, adults: 2 };
  data.cities = deriveCityDates("2026-08-01", [{ city_name: "باكو", nights: 3, check_in: null, check_out: null }]);
  data.hotels = [
    withRooms(
      normalizeDraftHotel({ city_name: "باكو", hotel_name: "فندق باكو سنتر" }),
      rooms.map((r) => ({ room_type_id: null, price: null, ...r })),
    ),
  ];
  return withRequiredAnswers(data);
}

describe("normalizeDraftHotel", () => {
  it("turns an old one-room-and-a-count line into that many identical rooms", () => {
    const line = normalizeDraftHotel({
      city_name: "باكو",
      room_type_id: "rt1",
      room_type_name: "غرفة مزدوجة",
      board_type: "BB",
      rooms_count: 3,
    });

    expect(line.rooms).toHaveLength(3);
    expect(line.rooms.every((r) => r.room_type_name === "غرفة مزدوجة" && r.board_type === "BB")).toBe(true);
  });

  it("never carries a supplier key onto a seeded line", () => {
    // a null one still reads as "priced from a supplier" to anything checking
    // for the property, which would make an expired rate look attached
    expect(normalizeDraftHotel({ city_name: "باكو" })).not.toHaveProperty("sourcing");
  });

  it("defaults a line saved before the English name and manual price existed", () => {
    const line = normalizeDraftHotel({ city_name: "باكو", hotel_name: "فندق" });
    expect(line.hotel_name_en).toBe("");
    expect(line.manual_price).toBeNull();
    expect(line.manual_currency).toBe("SAR");
  });
});

describe("withRooms", () => {
  it("keeps rooms_count and the room-1 scalars in step with the array", () => {
    const line = withRooms(normalizeDraftHotel({ city_name: "باكو" }), [
      { room_type_id: "rt1", room_type_name: "غرفة مزدوجة", board_type: "BB" , price: null},
      { room_type_id: null, room_type_name: "غرفة مفردة", board_type: "HB" , price: null},
    ]);

    expect(line.rooms_count).toBe(2);
    expect(line.room_type_name).toBe("غرفة مزدوجة");
    expect(line.room_type_id).toBe("rt1");
    expect(line.board_type).toBe("BB");
  });

  it("never leaves a line with zero rooms", () => {
    expect(withRooms(normalizeDraftHotel({ city_name: "باكو" }), []).rooms).toHaveLength(1);
  });
});

describe("resizeRooms", () => {
  it("clones room 1 into every new slot — the common case is the same room", () => {
    const line = withRooms(normalizeDraftHotel({ city_name: "باكو" }), [
      { room_type_id: "rt1", room_type_name: "غرفة مزدوجة", board_type: "BB" , price: null},
    ]);

    const grown = resizeRooms(line, 3);

    expect(grown.rooms).toHaveLength(3);
    expect(grown.rooms[2]).toEqual({ room_type_id: "rt1", room_type_name: "غرفة مزدوجة", board_type: "BB" , price: null});
    expect(grown.rooms_count).toBe(3);
  });

  it("shrinks without disturbing the rooms that survive", () => {
    const line = withRooms(normalizeDraftHotel({ city_name: "باكو" }), [
      { room_type_id: null, room_type_name: "مزدوجة", board_type: "BB" , price: null},
      { room_type_id: null, room_type_name: "مفردة", board_type: "HB" , price: null},
      { room_type_id: null, room_type_name: "ثلاثية", board_type: "BB" , price: null},
    ]);

    const shrunk = resizeRooms(line, 2);

    expect(shrunk.rooms.map((r) => r.room_type_name)).toEqual(["مزدوجة", "مفردة"]);
  });

  it("refuses to go below one room", () => {
    const line = normalizeDraftHotel({ city_name: "باكو" });
    expect(resizeRooms(line, 0).rooms).toHaveLength(1);
  });
});

describe("«اسم الغرفة عند الفندق» — the hotel's own name beside the catalogue's", () => {
  const room = (over: Partial<DraftRoomSpec> = {}): DraftRoomSpec => ({ room_type_id: null, room_type_name: "غرفة مزدوجة", board_type: "BB", price: null, ...over });

  it("prints beside the catalogue's name, trimmed and capped", () => {
    expect(roomTypesText([room({ hotel_room_name: "  Deluxe Sea View " })])).toBe("غرفة مزدوجة — Deluxe Sea View");
    expect(roomTypesText([room({ hotel_room_name: "Deluxe" }), room({ hotel_room_name: "Deluxe" }), room()])).toBe("غرفة مزدوجة — Deluxe × 2 + غرفة مزدوجة");
    expect(hotelRoomName({ hotel_room_name: "x".repeat(200) })).toHaveLength(HOTEL_ROOM_NAME_MAX);
    expect(hotelRoomName({ hotel_room_name: 42 })).toBe("");
  });

  it("an older file without it reads exactly as before", () => {
    const old = normalizeDraftHotel({ city_name: "باكو", rooms: [{ room_type_id: null, room_type_name: "غرفة مزدوجة | الفئة: ديلوكس", board_type: "BB", price: 300 }] });
    expect("hotel_room_name" in old.rooms[0]).toBe(false);
    expect(roomTypesText(old.rooms)).toBe("غرفة مزدوجة | الفئة: ديلوكس");
    expect(roomTypesText([room({ hotel_room_name: "   " })])).toBe("غرفة مزدوجة");
  });

  it("survives a save, and does not follow the room to another hotel or another type", () => {
    const line = normalizeDraftHotel({ city_name: "باكو", hotel_name: "فندق باكو سنتر", rooms: [room({ hotel_room_name: "Deluxe Sea View" })] });
    expect(line.rooms[0].hotel_room_name).toBe("Deluxe Sea View");
    const cities = deriveCityDates("2026-08-01", [{ city_name: "باكو", nights: 3, check_in: null, check_out: null }]);
    expect(hotelRoomName(addStay(cities, [line], 0, "same").hotels[1].rooms[0])).toBe("");
    expect(hotelRoomName(renameRooms(line, "جناح").rooms[0])).toBe("");
  });
});

describe("validateDraft across all rooms", () => {
  it("passes when every room states a type and a board", () => {
    const result = validateDraft(
      draftWithHotel([
        { room_type_name: "غرفة مزدوجة", board_type: "BB" },
        { room_type_name: "غرفة مفردة", board_type: "HB" },
      ]),
    );
    expect(result.blocking.filter((i) => i.stage === "hotels")).toEqual([]);
  });

  it("BLOCKS when the SECOND room has no board — not just the first", () => {
    // the driver's room, added and left blank, would otherwise print as an
    // unnamed room on a document the client signs
    const result = validateDraft(
      draftWithHotel([
        { room_type_name: "غرفة مزدوجة", board_type: "BB" },
        { room_type_name: "غرفة مفردة", board_type: null },
      ]),
    );

    expect(result.blocking.some((i) => i.invariant?.code === "hotel_missing_room_or_board")).toBe(true);
    expect(result.ok).toBe(false);
  });

  it("BLOCKS when the second room has no type", () => {
    const result = validateDraft(
      draftWithHotel([
        { room_type_name: "غرفة مزدوجة", board_type: "BB" },
        { room_type_name: "", board_type: "BB" },
      ]),
    );
    expect(result.ok).toBe(false);
  });
});
