import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyDraftData, emptyFlight, type DraftData, type GeneratorLookups } from "@/lib/offer/draft-types";

// the lookup is a server action: the render never reaches it
vi.mock("@/lib/data/itinerary-actions", () => ({ getAssistantAvailability: async () => ({ ai: false, flightLookup: true }), lookupFlightNumber: async () => ({ ok: false }) }));

const { BasicFlightPlan } = await import("./BasicFlightPlan");

function file(): DraftData {
  const data = emptyDraftData();
  data.trip = { ...data.trip, country: "تركيا", arrival_date: "2026-11-05", departure_date: "2026-11-12", nights: 7 };
  data.flights = [
    { ...emptyFlight("outbound"), flight_no: "TK101", from_airport: "MED", to_airport: "IST", departure_at: "2026-11-05T09:00" },
    { ...emptyFlight("internal"), flight_no: "TK2830", from_airport: "IST", to_airport: "TZX", departure_at: "2026-11-08T10:00", price: 900 },
    { ...emptyFlight("inbound"), from_airport: "TZX", to_airport: "MED", departure_at: "2026-11-12T00:00" },
  ];
  return data;
}

const render = (data: DraftData, part: "intl" | "dom") =>
  renderToStaticMarkup(
    <BasicFlightPlan
      data={data}
      lookups={{ airports: [], airlines: [], countries: [] } as unknown as GeneratorLookups}
      defaults={{ from: "", to: "", go: "", back: "", round: true }}
      part={part}
      onPart={() => {}}
      onChange={() => {}}
      current={() => data}
    />,
  );

describe("BasicFlightPlan", () => {
  it("asks the international legs by their number first, with no ticket or flight-card buttons", () => {
    const html = render(file(), "intl");
    expect(html).toContain("TK101");
    expect(html).toContain("أضف لاحقاً");
    expect(html).not.toContain("الرحلة النهائية");
    expect(html).not.toContain("بطاقة");
    // the number comes before the cabin
    expect(html.indexOf("TK101")).toBeLessThan(html.indexOf("aria-label=\"الدرجة\""));
    // one thing at a time: the domestic flights wait for «التالي»
    expect(html).not.toContain('value="TK2830"');
  });

  it("folds the international legs to a line and opens the domestic ones in their place", () => {
    const html = render(file(), "dom");
    expect(html).toContain('value="TK2830"');
    expect(html).toContain("الطيران الداخلي");
    expect(html).toContain("900");
    expect(html).not.toContain("value=\"TK101\"");
  });

  it("says a part left for later, with the way back", () => {
    const data = file();
    data.flight_booking = { ...data.flight_booking, later_intl: true };
    const html = render(data, "intl");
    expect(html).toContain("الطيران الدولي: يُضاف لاحقاً");
    expect(html).toContain('value="TK2830"');
  });
});
