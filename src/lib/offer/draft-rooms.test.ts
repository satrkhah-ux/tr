import { describe, expect, it } from "vitest";
import {
  deriveCityDates,
  emptyDraftData,
  normalizeDraftHotel,
  resizeRooms,
  withRooms,
  type DraftData,
} from "./draft-types";
import { validateDraft } from "./draft-validation";

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
      rooms.map((r) => ({ room_type_id: null, ...r })),
    ),
  ];
  return data;
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
      { room_type_id: "rt1", room_type_name: "غرفة مزدوجة", board_type: "BB" },
      { room_type_id: null, room_type_name: "غرفة مفردة", board_type: "HB" },
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
      { room_type_id: "rt1", room_type_name: "غرفة مزدوجة", board_type: "BB" },
    ]);

    const grown = resizeRooms(line, 3);

    expect(grown.rooms).toHaveLength(3);
    expect(grown.rooms[2]).toEqual({ room_type_id: "rt1", room_type_name: "غرفة مزدوجة", board_type: "BB" });
    expect(grown.rooms_count).toBe(3);
  });

  it("shrinks without disturbing the rooms that survive", () => {
    const line = withRooms(normalizeDraftHotel({ city_name: "باكو" }), [
      { room_type_id: null, room_type_name: "مزدوجة", board_type: "BB" },
      { room_type_id: null, room_type_name: "مفردة", board_type: "HB" },
      { room_type_id: null, room_type_name: "ثلاثية", board_type: "BB" },
    ]);

    const shrunk = resizeRooms(line, 2);

    expect(shrunk.rooms.map((r) => r.room_type_name)).toEqual(["مزدوجة", "مفردة"]);
  });

  it("refuses to go below one room", () => {
    const line = normalizeDraftHotel({ city_name: "باكو" });
    expect(resizeRooms(line, 0).rooms).toHaveLength(1);
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
