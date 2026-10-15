import { describe, expect, it } from "vitest";
import { classifyRoomName, exportLocale, hotelNameFor, roomIssues, roomName, ROOM_TYPES, type RoomSpec } from "./room-catalog";

describe("the owner's room catalogue", () => {
  it("has the file's twelve room types, in Arabic and English", () => {
    expect(ROOM_TYPES).toHaveLength(12);
    expect(ROOM_TYPES.find((t) => t.id === "twin")?.label).toEqual({ ar: "غرفة بسريرين منفصلين", en: "Twin Room" });
  });

  // the file's acceptance examples
  it("georgia_auto: a Batumi hotel exports in English with its verified custom room name", () => {
    expect(exportLocale({ document: "auto", stay: "auto", countryCode: "GE" })).toBe("en");
    const room: RoomSpec = {
      room_type_id: "double",
      room_category_id: "deluxe",
      custom_room_name: { ar: "غرفة ديلوكس بسرير كينغ وإطلالة على البحر", en: "Deluxe King Room with Sea View" },
      custom_name_status: { ar: "verified", en: "verified" },
    };
    expect(roomName(room, "en").name).toBe("Deluxe King Room with Sea View");
    expect(hotelNameFor({ ar: "فندق المثال باتومي", en: "Example Batumi Hotel" }, "en").name).toBe("Example Batumi Hotel");
  });

  it("oman_auto: an Omani hotel exports in Arabic, the name built from type and category", () => {
    expect(exportLocale({ document: "auto", stay: "auto", countryCode: "OM" })).toBe("ar");
    expect(roomName({ room_type_id: "twin", room_category_id: "superior", view_ids: [], feature_ids: [] }, "ar").name).toBe(
      "غرفة بسريرين منفصلين | الفئة: سوبيريور",
    );
  });

  it("the document's choice wins, then the stay's; the hotel's country decides, not the arrival airport", () => {
    expect(exportLocale({ document: "en", stay: "auto", countryCode: "OM" })).toBe("en");
    expect(exportLocale({ document: "ar", stay: "en", countryCode: "GE" })).toBe("ar");
    expect(exportLocale({ document: "auto", stay: "auto", countryCode: "GE" })).toBe("en"); // lands in Trabzon, sleeps in Batumi
    expect(exportLocale({ countryCode: "JP" })).toBe("en"); // unlisted destination
    expect(["OM", "GE", "TR"].map((c) => exportLocale({ document: "auto", countryCode: c }))).toEqual(["ar", "en", "en"]);
  });

  it("missing translations stop the final export instead of falling back", () => {
    expect(hotelNameFor({ ar: "اسم فندق جديد", en: null }, "en").error).toBe("HOTEL_NAME_TRANSLATION_REQUIRED");
    expect(hotelNameFor({ ar: "فندق", en: "فندق" }, "en").error).toBe("HOTEL_NAME_TRANSLATION_REQUIRED");
    expect(
      roomName({ room_type_id: "double", custom_room_name: { ar: "غرفة خاصة", en: null }, custom_name_status: { ar: "verified", en: "missing" } }, "en")
        .error,
    ).toBe("ROOM_NAME_TRANSLATION_REQUIRED");
  });

  it("prints the details operations add after confirmation, labelled, in the stay's language", () => {
    const room: RoomSpec = {
      room_type_id: "double",
      room_category_id: "deluxe",
      bed_groups: [{ id: "k", beds: [{ bed_type_id: "king", quantity: 1 }] }],
      selected_bed_group_id: "k",
      bed_configuration_status: "guaranteed",
      view_ids: ["sea"],
      feature_ids: ["non_smoking", "balcony"],
    };
    expect(roomName(room, "en").name).toBe(
      "Double Room | Category: Deluxe | Beds: 1 × King Bed (Guaranteed) | View: Sea View | Features: Non-Smoking, Balcony",
    );
    expect(roomName(room, "ar").name).toBe(
      "غرفة مزدوجة | الفئة: ديلوكس | الأسرّة: 1 × سرير كينغ (مضمون) | الإطلالة: إطلالة على البحر | المميزات: لغير المدخنين، شرفة",
    );
    // alternatives that are not guaranteed are shown as alternatives
    expect(
      roomName({ room_type_id: "double_or_twin", bed_groups: [{ id: "a", beds: [{ bed_type_id: "double", quantity: 1 }] }, { id: "b", beds: [{ bed_type_id: "single", quantity: 2 }] }], bed_configuration_status: "on_request" }, "en").name,
    ).toBe("Double or Twin Room | Beds: 1 × Double Bed OR 2 × Single Bed (On Request, Not Guaranteed)");
  });

  it("enforces the file's validation rules", () => {
    expect(roomIssues({ room_type_id: "double", feature_ids: ["smoking", "non_smoking"] })).toContain("smoking_both");
    expect(roomIssues({ room_type_id: "double", view_ids: ["no_view", "sea"] })).toContain("view_conflict");
    expect(roomIssues({ room_type_id: "double", view_ids: ["sea", "partial_sea"] })).toContain("view_conflict");
    expect(roomIssues({ room_type_id: "double", suite_subtype_id: "junior" })).toContain("suite_subtype");
    expect(roomIssues({ room_type_id: "double", max_guests: 3, max_adults: 1, max_children: 1 })).toContain("occupancy");
    expect(roomIssues({ room_type_id: "unknown" })).toContain("unknown_id");
    expect(
      roomIssues({ room_type_id: "twin", bed_groups: [{ id: "k", beds: [{ bed_type_id: "king", quantity: 1 }] }], selected_bed_group_id: "k", bed_configuration_status: "guaranteed" }),
    ).toContain("double_twin");
    expect(roomIssues({ room_type_id: "suite", suite_subtype_id: "junior", bedroom_count: 1, max_guests: 3, max_adults: 2, max_children: 1 })).toEqual([]);
  });

  it("reads an old free-text name into a type and a category, guessing nothing else", () => {
    expect(classifyRoomName("Deluxe King Room")).toEqual({ room_type_id: "double", room_category_id: "deluxe" });
    expect(classifyRoomName("غرفة ثلاثية سوبيريور")).toEqual({ room_type_id: "triple", room_category_id: "superior" });
    expect(classifyRoomName("Superior Twin")).toEqual({ room_type_id: "twin", room_category_id: "superior" });
    expect(classifyRoomName("Junior Suite")).toEqual({ room_type_id: "suite", room_category_id: null });
    expect(classifyRoomName("Garden Villa")).toEqual({ room_type_id: null, room_category_id: null });
  });
});
