import { describe, expect, it } from "vitest";
import { roomLabel, roomTypesText } from "./draft-types";

describe("room view", () => {
  it("prints with the room's name and keeps two views apart", () => {
    const base = { room_type_name: "غرفة مزدوجة | الفئة: ستاندرد", board_type: null };
    expect(roomLabel({ ...base, room_view: " إطلالة على البحر " })).toBe("غرفة مزدوجة | الفئة: ستاندرد — إطلالة على البحر");
    expect(roomTypesText([{ ...base, room_view: "إطلالة على البحر" }, { ...base, room_view: "إطلالة على البحر" }, { ...base }])).toBe(
      "غرفة مزدوجة | الفئة: ستاندرد — إطلالة على البحر × 2 + غرفة مزدوجة | الفئة: ستاندرد",
    );
  });
});
