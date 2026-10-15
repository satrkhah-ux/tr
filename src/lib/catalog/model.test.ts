import { describe, expect, it } from "vitest";
import { classifyRoom, guessPlaceKind, iataProblem, nonRoomReason, roomRank, seatsFromName, splitTourName } from "./model";

describe("classifyRoom", () => {
  it("reads the unit, then the occupancy, then the grade", () => {
    expect(classifyRoom("غرفة مفردة")).toBe("single");
    expect(classifyRoom("غرفة مزدوجة")).toBe("double");
    expect(classifyRoom("غرفة مزدوجة بسريرين منفصلين")).toBe("twin");
    expect(classifyRoom("غرفه ثلاثيه")).toBe("triple");
    expect(classifyRoom("غرفة رباعية")).toBe("quad");
    expect(classifyRoom("غرفة عائليه")).toBe("family");
    expect(classifyRoom("غرفتان متصلتان")).toBe("connecting");
    expect(classifyRoom("جناح عائلي")).toBe("suite");
    expect(classifyRoom("فيلا بمسبح خاص")).toBe("villa");
    expect(classifyRoom("شاليه")).toBe("chalet");
    expect(classifyRoom("Deluxe Twin Room")).toBe("twin");
    expect(classifyRoom("Superior King")).toBe("double");
    expect(classifyRoom("غرفة ديلوكس مطلة على البحر")).toBe("deluxe");
    expect(classifyRoom("سوبيريور")).toBe("superior");
    expect(classifyRoom("غرفة قياسية")).toBe("standard");
    expect(classifyRoom("Two Bedroom Apartment")).toBe("apartment");
    expect(classifyRoom("One Bedroom Suite")).toBe("suite");
    expect(classifyRoom("ستوديو")).toBe("studio");
  });

  it("uses the English name when the Arabic says nothing, and admits it does not know", () => {
    expect(classifyRoom("بانوراما", "Family Room")).toBe("family");
    expect(classifyRoom("بانوراما")).toBeNull();
  });

  it("ranks by category, the unknown last", () => {
    const names = ["جناح", "بانوراما", "غرفة مزدوجة", "غرفة مفردة"];
    expect([...names].sort((a, b) => roomRank(a) - roomRank(b))).toEqual(["غرفة مفردة", "غرفة مزدوجة", "جناح", "بانوراما"]);
  });
});

describe("nonRoomReason", () => {
  it("flags unit codes and joined rooms, not an extra bed", () => {
    expect(nonRoomReason("A-1 (3 غرف نوم)")).toBe("code");
    expect(nonRoomReason("B12")).toBe("code");
    expect(nonRoomReason("غرفة مزدوجة + غرفة مفردة")).toBe("combo");
    expect(nonRoomReason("غرفة مزدوجة + سرير إضافي")).toBeNull();
    expect(nonRoomReason("جناح ديلوكس")).toBeNull();
  });
});

describe("places", () => {
  it("tells an airport from a station and a port", () => {
    expect(guessPlaceKind("مطار كوالالمبور الدولي")).toBe("airport");
    expect(guessPlaceKind("محطة قطار KL Sentral")).toBe("train_station");
    expect(guessPlaceKind("محطة الحافلات", "Bus Terminal")).toBe("bus_station");
    expect(guessPlaceKind("ميناء جيتي بوينت", "Jetty Point")).toBe("port");
    expect(guessPlaceKind("كوالالمبور")).toBe("airport");
  });

  it("allows three capital letters, on an airport only", () => {
    expect(iataProblem("KUL", "airport")).toBeNull();
    expect(iataProblem(null, "train_station")).toBeNull();
    expect(iataProblem("12go", "airport")).toBe("format");
    expect(iataProblem("AA", "airport")).toBe("format");
    expect(iataProblem("XKL", "train_station")).toBe("not_airport");
  });
});

describe("cars and tours", () => {
  it("reads the seats a car's name states", () => {
    expect(seatsFromName("باص 40 راكب")).toBe(40);
    expect(seatsFromName("ميني باص 16 مقعد")).toBe(16);
    expect(seatsFromName("Hiace 10 seats")).toBe(10);
    expect(seatsFromName("7-seater")).toBe(7);
    expect(seatsFromName("سيارة صغيرة")).toBeNull();
  });

  it("splits the vehicle off an old per-car tour name", () => {
    expect(splitTourName("جولة كوالالمبور (فان)")).toEqual({ base: "جولة كوالالمبور", car: "فان" });
    expect(splitTourName("جولة كوالالمبور")).toBeNull();
  });
});
