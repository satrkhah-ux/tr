import { describe, expect, it } from "vitest";
import { tourGist, tourKey } from "./tour-gist";

describe("a tour as the picker shows it (2026-10-22)", () => {
  it("shows a long itinerary as its title and three of its places — a short name as itself", () => {
    expect(tourGist("جولة البسفور")).toEqual({});
    const long = "جولة مرتفعات آيدر، زيارة شلالات بالا، بحيرة أوزنجول - سوق الهدايا ثم العودة إلى الفندق في طرابزون";
    const gist = tourGist(long);
    expect(gist.label).toBe("جولة مرتفعات آيدر");
    expect(gist.sub).toBe("شلالات بالا · بحيرة أوزنجول · سوق الهدايا");
  });

  it("keeps a time whole", () => {
    expect(tourGist("جولة المدينة الساعة 09:00 صباحاً، برج غلاطة، جامع السلطان أحمد، قصر توبكابي، البازار الكبير").sub).toBe("برج غلاطة · جامع السلطان أحمد · قصر توبكابي");
  });

  it("reads the same tour with or without «ثم التوصيل الى …» and its dashes as one", () => {
    expect(tourKey("مرتفعات آيدر - شلالات بالا ثم التوصيل الى طرابزون")).toBe(tourKey("مرتفعات آيدر شلالات بالا"));
    expect(tourKey("جولة اوزنجول")).not.toBe(tourKey("جولة آيدر"));
  });
});
