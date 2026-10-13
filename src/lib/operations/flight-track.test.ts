import { describe, expect, it } from "vitest";
import { inWindow, pickObservation, trackDecision, trackTargets, trackedLanding, type FlightObservation } from "./flight-track";

const obs = (o: Partial<FlightObservation>): FlightObservation => ({
  flight_date: "2026-11-20",
  to: "KUL",
  scheduled: "2026-11-20T14:30",
  estimated: null,
  actual: null,
  ...o,
});

describe("trackDecision", () => {
  it("leaves a flight within 15 minutes alone", () => {
    expect(trackDecision({ planned: "2026-11-20T14:30", tracked: null, observed: obs({ estimated: "2026-11-20T14:45" }) })).toBeNull();
  });

  it("moves the reception to landing + 45 when the flight is late", () => {
    expect(trackDecision({ planned: "2026-11-20T14:30", tracked: null, observed: obs({ estimated: "2026-11-20T15:40" }) })).toEqual({
      landing: "2026-11-20T15:40",
      delay: 70,
      meet: { date: "2026-11-20", time: "16:25" },
      landed: false,
    });
  });

  it("moves it earlier too, across midnight, and says when it has landed", () => {
    const d = trackDecision({ planned: "2026-11-20T23:50", tracked: null, observed: obs({ scheduled: "2026-11-20T23:50", actual: "2026-11-20T23:20" }) });
    expect(d).toMatchObject({ delay: -30, meet: { date: "2026-11-21", time: "00:05" }, landed: true });
  });

  it("measures against the last move, so the same delay is not announced twice", () => {
    const observed = obs({ estimated: "2026-11-20T15:45" });
    expect(trackDecision({ planned: "2026-11-20T14:30", tracked: "2026-11-20T15:40", observed })).toBeNull();
    // and back on time is a move of its own
    expect(trackDecision({ planned: "2026-11-20T14:30", tracked: "2026-11-20T15:40", observed: obs({ estimated: "2026-11-20T14:35" }) })?.delay).toBe(5);
  });

  it("uses the provider's schedule when our line has no landing", () => {
    expect(trackDecision({ planned: null, tracked: null, observed: obs({ estimated: "2026-11-20T15:00" }) })?.delay).toBe(30);
  });

  it("does nothing without an estimate", () => {
    expect(trackDecision({ planned: "2026-11-20T14:30", tracked: null, observed: obs({}) })).toBeNull();
  });
});

describe("pickObservation", () => {
  const leg = { to: "KUL", departure: "2026-11-20T01:00", arrival: "2026-11-20T14:30" };

  it("takes the row of our day and our airport", () => {
    const rows = [obs({ flight_date: "2026-11-19", scheduled: "2026-11-19T14:30" }), obs({ to: "PEN" }), obs({ estimated: "2026-11-20T15:00" })];
    expect(pickObservation(rows, leg)?.estimated).toBe("2026-11-20T15:00");
  });

  it("matches on the departure day when the line has no landing", () => {
    expect(pickObservation([obs({ scheduled: "2026-11-21T00:30" })], { ...leg, arrival: null })).not.toBeNull();
    expect(pickObservation([obs({})], { to: "KUL", departure: null, arrival: null })).toBeNull();
  });
});

describe("trackTargets", () => {
  const flight = { operation_id: "op", detail: { الذهاب: "MH1430 · KUL → LGK · 2026-11-24 09:00 · الوصول 2026-11-24 10:05" } };
  const reception = {
    id: "r",
    operation_id: "op",
    kind: "transport",
    title: "المطار ← الفندق",
    start_date: "2026-11-24",
    detail: { الرحلة: "MH1430 KUL → LGK", الوقت: "10:50", "الهبوط المحدّث": "2026-11-24 10:40" },
  };

  it("finds the leg a reception meets, with its last tracked landing", () => {
    const [t] = trackTargets([reception], [flight]);
    expect(t).toMatchObject({ id: "r", flight_no: "MH1430", tracked: "2026-11-24T10:40" });
    expect(t.leg.arrival).toBe("2026-11-24T10:05");
  });

  it("skips drop-offs, other cases, unnumbered flights and guests already picked up", () => {
    expect(trackTargets([{ ...reception, title: "الفندق ← المطار" }], [flight])).toEqual([]);
    expect(trackTargets([{ ...reception, operation_id: "other" }], [flight])).toEqual([]);
    expect(trackTargets([{ ...reception, detail: { ...reception.detail, الرحلة: "— KUL → LGK" } }], [flight])).toEqual([]);
    expect(trackTargets([{ ...reception, detail: { ...reception.detail, "حالة السائق": "تم الاستقبال" } }], [flight])).toEqual([]);
  });
});

describe("inWindow / trackedLanding", () => {
  const landing = new Date("2026-11-24T02:05:00Z");
  it("asks from six hours before the landing to two after", () => {
    expect(inWindow(landing, new Date("2026-11-23T21:00:00Z"))).toBe(true);
    expect(inWindow(landing, new Date("2026-11-23T19:00:00Z"))).toBe(false);
    expect(inWindow(landing, new Date("2026-11-24T05:00:00Z"))).toBe(false);
    expect(inWindow(null, new Date())).toBe(true);
  });
  it("reads the stored landing", () => {
    expect(trackedLanding({ "الهبوط المحدّث": "2026-11-24 10:40" })).toBe("2026-11-24T10:40");
    expect(trackedLanding({})).toBeNull();
  });
});
