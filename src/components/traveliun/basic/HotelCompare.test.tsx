import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { normalizeDraftHotel } from "@/lib/offer/draft-types";
import { HotelCompare } from "./HotelCompare";

/** «قارن» on a Basic hotel row: closed it is one small button, and it writes nothing by being shown. */
describe("HotelCompare", () => {
  it("renders a «قارن» button on the row, nothing else until opened", () => {
    const line = normalizeDraftHotel({ city_name: "تبليسي", hotel_name: "Old Wall", rooms: [{ room_type_id: null, room_type_name: "مزدوجة", board_type: "BB", price: 600 }] });
    let applied = 0;
    const html = renderToStaticMarkup(
      <HotelCompare line={line} cityName="تبليسي" hotelNameEn="Old Wall" checkIn="2026-12-01" checkOut="2026-12-03" nights={2} adults={2} sarPer={{}} onApply={() => { applied += 1; }} />,
    );
    expect(html).toContain("قارن");
    expect(html).not.toContain("استخدم هذا السعر");
    expect(applied).toBe(0);
  });
});
