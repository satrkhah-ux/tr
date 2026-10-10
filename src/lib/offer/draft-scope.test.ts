import { describe, expect, it } from "vitest";
import {
  AGE_BANDS,
  emptyDraftData,
  emptyFlight,
  MEAL_PLAN_BOARD,
  normalizeDraftData,
  resizeAges,
  visibleStagesFor,
  type DraftData,
  type DraftScope,
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

const ALL_ON: DraftScope = {
  hotels: true,
  flights_intl: true,
  flights_domestic: true,
  transport: true,
  services: true,
  visas: true,
};

describe("visibleStagesFor", () => {
  it("drops the stage a switch turns off", () => {
    const keys = visibleStagesFor({ ...ALL_ON, visas: false }, true).map((s) => s.key);

    expect(keys).toContain("flights");
    expect(keys).not.toContain("visas");
    // transport never had a stage — three answers on the trip card instead
    expect(keys).not.toContain("transport");
  });

  it("keeps «الطيران» while EITHER half is sold", () => {
    // The map is inverted for exactly this: a file with no international leg
    // but a domestic hop must keep the stage that holds that hop, and the old
    // `find`-the-first-switch form silently lost it.
    expect(visibleStagesFor({ ...ALL_ON, flights_intl: false }, true).map((s) => s.key)).toContain("flights");
    expect(visibleStagesFor({ ...ALL_ON, flights_domestic: false }, true).map((s) => s.key)).toContain("flights");
    expect(
      visibleStagesFor({ ...ALL_ON, flights_intl: false, flights_domestic: false }, true).map((s) => s.key),
    ).not.toContain("flights");
  });

  it("keeps «يشمل / لا يشمل» even when no ground services are sold", () => {
    // It holds the «لا يشمل» list, which every document prints.
    expect(visibleStagesFor({ ...ALL_ON, services: false }, true).map((s) => s.key)).toContain("services");
  });

  it("has no «الفنادق» chip — the stays live inside their city", () => {
    expect(visibleStagesFor(ALL_ON, true).map((s) => s.key)).not.toContain("hotels");
    expect(visibleStagesFor(ALL_ON, true).map((s) => s.key)).toContain("cities");
  });

  it("still hides pricing from a role without the permission", () => {
    expect(visibleStagesFor(ALL_ON, false).map((s) => s.key)).not.toContain("pricing");
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
    data.scope = { ...data.scope, flights_intl: false, flights_domestic: false };
    expect(validateDraft(data).warnings.some((i) => i.stage === "flights")).toBe(false);
  });
});

describe("normalizeDraftData", () => {
  it("treats a draft saved before scope existed as covering everything", () => {
    // the alternative — defaulting to false — would silently drop the flights
    // and hotels an existing draft already carries from its document.
    const { scope } = normalizeDraftData({ trip: { country: "تركيا" } });
    expect(scope).toEqual(ALL_ON);
  });

  it("splits an old single flights answer across both halves", () => {
    // The draft answered ONE question. Defaulting the domestic half to false
    // would hide an `internal` leg the document still prints.
    expect(normalizeDraftData({ scope: { flights: false } }).scope).toMatchObject({
      flights_intl: false,
      flights_domestic: false,
    });
    expect(normalizeDraftData({ scope: { flights: true } }).scope).toMatchObject({
      flights_intl: true,
      flights_domestic: true,
    });
  });

  it("lets an explicit answer beat the inherited one", () => {
    expect(
      normalizeDraftData({ scope: { flights: true, flights_domestic: false } }).scope,
    ).toMatchObject({ flights_intl: true, flights_domestic: false });
  });

  it("re-fits stale ages to the traveler counts", () => {
    const { trip } = normalizeDraftData({ trip: { children: 2, children_ages: [6] } });
    // The added child seeds INSIDE the child band. This used to be 0, which is
    // an infant's age sitting in a child's row — see AGE_BANDS.
    expect(trip.children_ages).toEqual([6, AGE_BANDS.children.fallback]);
  });

  it("repairs an out-of-band age left by an older draft", () => {
    const { trip } = normalizeDraftData({
      trip: { children: 1, children_ages: [31], infants: 1, infant_ages: [74] },
    });
    expect(trip.children_ages).toEqual([AGE_BANDS.children.max]);
    expect(trip.infant_ages).toEqual([AGE_BANDS.infants.max]);
  });
});

describe("meal plan", () => {
  it("reads an old draft's board back as the meal it unambiguously was", () => {
    expect(normalizeDraftData({ trip: { default_board: "BB" } }).trip.meal_plan).toBe("breakfast");
    expect(normalizeDraftData({ trip: { default_board: "RO" } }).trip.meal_plan).toBe("none");
    expect(normalizeDraftData({ trip: { default_board: "FB" } }).trip.meal_plan).toBe("all");
  });

  it("leaves HB unanswered rather than guessing which meal", () => {
    // HB is breakfast plus lunch OR dinner. Guessing one would promise the
    // client a meal nobody bought, so the agent re-answers it.
    expect(normalizeDraftData({ trip: { default_board: "HB" } }).trip.meal_plan).toBeNull();
  });

  it("books lunch and dinner as the same board — the known loss", () => {
    // Pinned deliberately: the CHECK on offer_hotels.board_type admits five
    // codes and none of them can say WHICH meal, so the exact word travels in
    // the «يشمل» line instead. If this ever stops being true, say so here.
    expect(MEAL_PLAN_BOARD.lunch).toBe("HB");
    expect(MEAL_PLAN_BOARD.dinner).toBe("HB");
  });
});

describe("emptyFlight", () => {
  it("inherits the trip baggage for the leg's own half", () => {
    const trip = {
      ...emptyDraftData().trip,
      baggage_intl_kg: 30,
      baggage_intl_pieces: 2,
      baggage_dom_kg: 20,
      baggage_dom_pieces: 1,
    };
    expect(emptyFlight("outbound", trip)).toMatchObject({ baggage_kg: 30, baggage_pieces: 2 });
    expect(emptyFlight("inbound", trip)).toMatchObject({ baggage_kg: 30, baggage_pieces: 2 });
    // A 30 kg international ticket routinely allows 20 on the domestic hop.
    expect(emptyFlight("internal", trip)).toMatchObject({ baggage_kg: 20, baggage_pieces: 1 });
  });

  it("stays empty with no trip to inherit from", () => {
    expect(emptyFlight("outbound")).toMatchObject({
      baggage_kg: null,
      baggage_pieces: null,
      cabin_baggage_kg: null,
    });
  });
});
