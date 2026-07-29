import { describe, expect, it } from "vitest";
import {
  emptyDraftData,
  normalizeDraftData,
  resizeAges,
  visibleStagesFor,
  type DraftData,
} from "./draft-types";
import { validateDraft } from "./draft-validation";

/**
 * Service scope + traveler ages.
 *
 * The scope switches exist because not every sale includes every service — a
 * Gulf trip needs no visa, a client may buy flights only. The dangerous failure
 * is not a stray menu item: it is a BLOCKING validation issue attributed to a
 * stage that is no longer in the rail, which the agent then cannot open to fix.
 * These tests pin that the two move together.
 */

function draftWithCitiesButNoHotels(): DraftData {
  const data = emptyDraftData();
  data.trip = { ...data.trip, country: "الإمارات", arrival_date: "2026-09-10", days: 4, nights: 3 };
  data.cities = [{ city_name: "دبي", nights: 3, check_in: "2026-09-10", check_out: "2026-09-13" }];
  return data;
}

describe("resizeAges", () => {
  it("grows to the count and keeps what was already typed", () => {
    expect(resizeAges([7], 3)).toEqual([7, 0, 0]);
  });

  it("shrinks without disturbing the surviving entries", () => {
    expect(resizeAges([7, 9, 11], 2)).toEqual([7, 9]);
  });

  it("repairs a list that disagrees with the count", () => {
    // a hand-edited jsonb, or a draft saved before the ages existed
    expect(resizeAges(undefined as unknown as number[], 2)).toEqual([0, 0]);
    expect(resizeAges([-4, Number.NaN], 2)).toEqual([0, 0]);
  });
});

describe("visibleStagesFor", () => {
  it("drops the stage a switch turns off", () => {
    const scope = { flights: true, hotels: true, visas: false, transport: false };
    const keys = visibleStagesFor(scope, true).map((s) => s.key);

    expect(keys).toContain("flights");
    expect(keys).not.toContain("visas");
    expect(keys).not.toContain("transport");
  });

  it("still hides pricing from a role without the permission", () => {
    const scope = { flights: true, hotels: true, visas: true, transport: true };
    expect(visibleStagesFor(scope, false).map((s) => s.key)).not.toContain("pricing");
  });
});

describe("validateDraft with an out-of-scope service", () => {
  it("blocks on missing hotels while hotels are in scope", () => {
    const result = validateDraft(draftWithCitiesButNoHotels());
    expect(result.blocking.some((i) => i.stage === "hotels")).toBe(true);
    expect(result.ok).toBe(false);
  });

  it("raises NO hotel issue once hotels are switched off", () => {
    const data = draftWithCitiesButNoHotels();
    data.scope = { ...data.scope, hotels: false };

    const result = validateDraft(data);

    // the whole point: nothing points at a stage the agent can no longer open
    expect(result.blocking.some((i) => i.stage === "hotels")).toBe(false);
    expect(result.warnings.some((i) => i.stage === "hotels")).toBe(false);
    expect(result.ok).toBe(true);
  });

  it("stops nagging about missing flights when flights are not sold", () => {
    const data = draftWithCitiesButNoHotels();
    data.scope = { ...data.scope, flights: false };
    expect(validateDraft(data).warnings.some((i) => i.stage === "flights")).toBe(false);
  });
});

describe("normalizeDraftData", () => {
  it("treats a draft saved before scope existed as covering everything", () => {
    // the alternative — defaulting to false — would silently drop the flights
    // and hotels an existing draft already carries from its document.
    const { scope } = normalizeDraftData({ trip: { country: "تركيا" } });
    expect(scope).toEqual({ flights: true, hotels: true, visas: true, transport: true });
  });

  it("re-fits stale ages to the traveler counts", () => {
    const { trip } = normalizeDraftData({ trip: { children: 2, children_ages: [6] } });
    expect(trip.children_ages).toEqual([6, 0]);
  });
});
