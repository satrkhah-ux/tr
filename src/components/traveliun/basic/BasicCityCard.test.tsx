import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { deriveCityDates, emptyDraftData, type DraftData, type GeneratorLookups } from "@/lib/offer/draft-types";
import { basicDays, withHotelLines, type BasicCity } from "@/lib/offer/basic";
import { ownerExample } from "@/lib/offer/draft-test-helpers";

let pricing = true;
vi.mock("@/lib/roles/RoleContext", () => ({ useRole: () => ({ can: (p: string) => p === "pricing.view" && pricing }) }));

const { BasicCityCard } = await import("./BasicCityCard");

/** One city: KL two nights (20–21 Oct), home on the 22nd — «جولة المدينة» on the 21st in two vans at 400 a van. */
function file(): DraftData {
  const data = emptyDraftData();
  data.trip = { ...data.trip, country: "ماليزيا", destination: "ماليزيا", arrival_date: "2026-10-20", nights: 2, days: 3, adults: 9 };
  data.cities = deriveCityDates("2026-10-20", [{ city_name: "كوالالمبور", nights: 2, check_in: null, check_out: null }]);
  data.cities[0] = { ...data.cities[0], tours: 1, tour_picks: [{ program_id: null, title: "جولة المدينة", text: "", price: 400, date: "2026-10-21", cars: 2 }] };
  data.transport_plan = { ...data.transport_plan, tours: { ...data.transport_plan.tours, car_type: "فان", cars: 2 } };
  data.days = basicDays(data);
  return data;
}

const render = (data = file(), index = 0, transportOn = false, part: "hotels" | "programme" = "programme") => {
  return renderToStaticMarkup(
    <BasicCityCard
      part={part}
      index={index}
      city={data.cities[index] as BasicCity}
      dayFrom={1}
      data={data}
      lookups={{ countries: [], carTypes: [{ name: "فان", pax: 7 }], sarPer: { SAR: 1 }, airports: [], airlines: [] } as unknown as GeneratorLookups}
      programs={[]}
      tourPrices={[]}
      hotelsOn={transportOn}
      toursOn
      transportOn={transportOn}
      isFirst={index === 0}
      isLast={index === data.cities.length - 1}
      onNights={() => {}}
      onPicks={() => {}}
      onLines={() => {}}
      onSlice={() => {}}
      onCar={() => {}}
      onRemove={() => {}}
      onMove={() => {}}
      dragFrom={null}
      onDragFrom={() => {}}
      onReplace={() => {}}
      collapsed={false}
      onDone={() => {}}
      onExpand={() => {}}
      onFold={() => {}}
      onClientHotel={() => {}}
      onClientBooked={() => {}}
    />,
  );
};

describe("Basic's tours tab", () => {
  it("shows the price per car and the total with pricing.view", () => {
    pricing = true;
    const html = render();
    expect(html).toContain('value="400"');
    expect(html).toContain("800 SAR");
    expect(html).toContain("الإجمالي: 800");
  });

  it("hides them without pricing.view — the tour, its car and how many stay", () => {
    pricing = false;
    const html = render();
    expect(html).toContain('value="جولة المدينة"');
    expect(html).toMatch(/<option value="2" selected="">2<\/option>/);
    expect(html).not.toContain("SAR");
    expect(html).not.toContain('value="400"');
    expect(html).not.toContain("الإجمالي");
    expect(html).toContain("عدد الجولات: 1");
  });

  it("offers a tour on the arrival day and, on the last city, on the day home", () => {
    pricing = true;
    const html = render();
    expect(html).toContain("جولة بعد الوصول");
    expect(html).toContain("جولة قبل المغادرة");
  });
});

describe("Basic's services table — the owner's example", () => {
  // the stays complete, so the card opens on the services
  const example = () => {
    const data = ownerExample();
    return { ...data, hotels: data.hotels.map((h) => ({ ...h, rooms: h.rooms.map((r) => ({ ...r, room_type_name: "غرفة مزدوجة", board_type: "BB" as const, price: 1000 })) })) };
  };
  // rows written as the row's words (the input's value), once each
  const count = (html: string, text: string) => html.split(`value="${text}"`).length - 1;

  it("Selangor: one reception from KUL, the tour that day, a free day, one farewell to KUL — and its hotel under the header", () => {
    pricing = true;
    const html = render(example(), 0, true);
    expect(count(html, "الاستقبال من مطار كوالالمبور الدولي والتوصيل إلى فندق صن واي بيراميد في سيلانجور")).toBe(1);
    expect(count(html, "التوصيل من فندق سيلانجور إلى مطار كوالالمبور الدولي")).toBe(1);
    expect(html).toContain('value="جولة في مدينة الأضواء"');
    expect(html).toContain("يوم حر");
    expect(html).toContain("الفندق: صن واي بيراميد");
    expect(html).toContain("الثلاثاء، 20 أكتوبر");
    // the columns, the type of each row, and a row to add
    expect(html).toContain("نوع الخدمة");
    expect(html).toMatch(/<option value="reception" selected="">استقبال<\/option>/);
    expect(html).toMatch(/<option value="farewell" selected="">توديع<\/option>/);
    expect(html).toMatch(/<option value="tour" selected="">جولة<\/option>/);
    expect(html).toContain("إضافة خدمة");
    // the old lines above the table are gone: the welcome text lives on the programme tab
    expect(html).not.toContain("نص الاستقبال");
  });

  it("Langkawi: met at its own airport, seen off from it", () => {
    pricing = true;
    const html = render(example(), 1, true);
    expect(count(html, "الاستقبال من مطار لنكاوي الدولي والتوصيل إلى الفندق")).toBe(1);
    expect(count(html, "التوصيل من فندق لنكاوي إلى مطار لنكاوي الدولي")).toBe(1);
    expect(html).toContain("الوصول 16:05");
  });
});

describe("the hotels part — the city with its stays, apart from its programme (the owner, 2026-10-25)", () => {
  /** Istanbul 3 nights then Trabzon 3, two people in one room. */
  const turkey = () => {
    const data = emptyDraftData();
    data.trip = { ...data.trip, country: "تركيا", destination: "تركيا", arrival_date: "2026-11-01", nights: 6, days: 7, adults: 2, rooms: 1 };
    data.cities = deriveCityDates("2026-11-01", [
      { city_name: "اسطنبول", nights: 3, check_in: null, check_out: null },
      { city_name: "طرابزون", nights: 3, check_in: null, check_out: null },
    ]);
    data.hotels = withHotelLines(data, "SAR");
    return data;
  };
  const hotels = (data: DraftData, index = 0) => {
    pricing = true;
    return render(data, index, true, "hotels");
  };

  it("shows the city from a date to a date, its stay's room, and a way to add a second hotel — no tours", () => {
    const html = hotels(turkey());
    expect(html).toContain("اسطنبول");
    expect(html).toContain("1 نوفمبر – 4 نوفمبر");
    expect(html).toContain("غرفة مزدوجة");
    expect(html).toContain("أضف فندقاً آخر في هذه المدينة");
    // the city's own controls at the card's end: edit, delete, fold (the owner, 2026-10-24)
    expect(html).toContain("تعديل المدينة");
    expect(html).toContain("حذف المدينة");
    expect(html).toContain("تصغير");
    // the nights are a field of the hotel row, after the hotel — not in the header beside the dates
    const header = html.slice(0, html.indexOf("</header>"));
    expect(header).not.toContain("الليالي");
    expect(html.slice(html.indexOf("</header>"))).toContain('aria-label="الليالي"');
    expect(html).not.toContain("عدد الجولات");
    expect(html).not.toContain("البرنامج السياحي");
  });

  it("shows a stay's price as the room's night — «× 3 ليالٍ = 900» — not its total (Order 5)", () => {
    const data = turkey();
    data.hotels = data.hotels.map((h, i) => (i === 0 ? { ...h, hotel_name: "فندق البسفور", rooms: h.rooms.map((r) => ({ ...r, board_type: "BB", price: 900 })) } : h));
    const html = hotels(data);
    expect(html).toContain("سعر الليلة للغرفة");
    expect(html).toContain('value="300"');
    expect(html).not.toContain('value="900"');
    expect(html).toContain("× 3 ليالٍ = 900 SAR");
  });

  it("says what the stay still lacks, and the nights no hotel covers", () => {
    const data = turkey();
    data.hotels = data.hotels.map((h, i) => (i === 0 ? { ...h, nights: 2 } : h));
    const html = hotels(data);
    expect(html).toContain("ينقص: الفندق");
    expect(html).toContain("ينقص 1 ليلة بلا فندق");
  });

  it("the programme part of the same city holds no hotel fields", () => {
    pricing = true;
    const html = render(turkey(), 0, true, "programme");
    expect(html).not.toContain("سعر الليلة للغرفة");
    expect(html).not.toContain("تعديل المدينة");
    expect(html).toContain("البرنامج السياحي");
  });
});

describe("«فندق العميل» — the client's own hotel (Order 7)", () => {
  /** the same city in a sale without hotels: «الفنادق» is off */
  const toursOnly = (hotel?: string) => {
    const data = file();
    data.scope = { ...data.scope, hotels: false };
    if (hotel) data.cities[0] = { ...data.cities[0], client_hotel: { name: hotel, source: "company" } };
    return data;
  };

  it("asks for it on the city, with no price anywhere, and says — softly — what it is for", () => {
    pricing = true;
    const html = render(toursOnly(), 0, false, "hotels");
    expect(html).toContain("فندق العميل (محجوز من خارجنا)");
    expect(html).toContain('aria-label="اسم الفندق — اكتبه أو اختره"');
    expect(html).toContain("الحجز من");
    expect(html).toContain("أدخل فندق العميل لعنوان الاستلام");
    expect(html).not.toContain("سعر الليلة للغرفة");
    // the soft hint never holds the city's «تمت»
    expect(html).not.toContain("ينقص:");
  });

  it("shows its dates as the city's until changed, and who it was booked through", () => {
    const html = render(toursOnly("هيلتون"), 0, false, "hotels");
    expect(html).toContain('value="2026-10-20"');
    expect(html).toContain('value="2026-10-22"');
    expect(html).toMatch(/<option value="company" selected="">شركة أخرى<\/option>/);
    expect(html).not.toContain("أدخل فندق العميل لعنوان الاستلام");
  });

  it("heads the city's programme as the client's — or asks for it there", () => {
    expect(render(toursOnly("هيلتون"), 0, false, "programme")).toContain("الفندق: هيلتون — حجز العميل");
    expect(render(toursOnly(), 0, false, "programme")).toContain("فندق العميل: لم يُدخل بعد — أدخل فندق العميل لعنوان الاستلام");
  });

  it("in a sale with hotels, each city may be the client's own (a mixed trip)", () => {
    pricing = true;
    const data = file();
    data.hotels = withHotelLines(data, "SAR");
    const ours = render(data, 0, true, "hotels");
    expect(ours).toContain("الفندق محجوز من العميل (من خارجنا)");
    expect(ours).toContain("سعر الليلة للغرفة");
    expect(ours).not.toContain("فندق العميل (محجوز من خارجنا)");
    data.cities[0] = { ...data.cities[0], client_hotel: { name: "هيلتون" } };
    const theirs = render(data, 0, true, "hotels");
    expect(theirs).toContain("فندق العميل (محجوز من خارجنا)");
    expect(theirs).not.toContain("سعر الليلة للغرفة");
    expect(theirs).not.toContain("بلا فندق");
  });
});
