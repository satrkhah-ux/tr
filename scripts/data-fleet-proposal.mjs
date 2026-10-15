/**
 * Order 8 — drivers, services, car types. READ ONLY → data-import/data-fleet-proposal.json.
 *
 *   node scripts/data-fleet-proposal.mjs
 *
 * Sections, each item with `ok` (true = the apply does it):
 *   test_drivers       a made-up number (0555777888, one digit repeated) or a test
 *                      name — deleted after a person confirms               ok: false
 *   incomplete_drivers drivers without a city or supplier (0072) — listed for /drivers, no action
 *   service_dupes      one service filed twice in a country at the SAME prices:
 *                      the newest row stays, the rest go                     ok: true
 *   car_seats          pax_capacity empty, the name states the seats («باص 40 راكب»)  ok: true
 *   non_cars           «التلفريك», «استقبال ومساعدة + مسار سريع» … are services, not
 *                      cars: a services row is created (set `country_id`, or it
 *                      is never offered by «اقتراح التسعير») and the car type disabled  ok: true
 *   car_spellings      «باص 40 راكب» and «باص 40 مقعد» are one car: one name kept,
 *                      the others disabled, transfers / tour prices renamed  ok: false (a person picks `keep_name`)
 */
import { hasColumn, propose } from "./data-model-lib.mjs";
import { seatsFromName } from "../src/lib/catalog/model.ts";
import { normAr } from "../src/lib/catalog/norm.ts";

const NOT_A_CAR = /تي?لي?فريك|cable ?car|استقبال ومساعد|مسار سريع|fast ?track|meet ?(and|&) ?assist/i;
const TEST_NAME = /تجرب|تجريب|تست|test|demo|dummy/i;
const fakeNumber = (mobile) => {
  const d = String(mobile ?? "").replace(/\D/g, "");
  return d === "0555777888" || d === "555777888" || /(\d)\1{5,}/.test(d) || /^0?5?0{6,}/.test(d);
};
/** «راكب / ركاب / مقعد / مقاعد» are one word for this purpose. */
const seatWordless = (name) => normAr(name).replace(/\s*(راكب|ركاب|مقعد|مقاعد|seats?|seater)\s*/g, " ").replace(/\s+/g, " ").trim();

await propose("fleet", async (q) => {
  // ---- drivers ----
  const linked = await hasColumn(q, "drivers", "city_id");
  const drivers = await q(`select id, arabic_name, english_name, mobile, country_id, car_type${linked ? ", city_id, supplier_id" : ", null as city_id, null as supplier_id"} from public.drivers`);
  const test_drivers = drivers
    .filter((d) => fakeNumber(d.mobile) || TEST_NAME.test(`${d.arabic_name} ${d.english_name ?? ""}`))
    .map((d) => ({ id: d.id, name: d.arabic_name, mobile: d.mobile, ok: false }));
  const incomplete_drivers = drivers
    .filter((d) => !test_drivers.some((t) => t.id === d.id) && (!d.city_id || !d.supplier_id))
    .map((d) => ({ id: d.id, name: d.arabic_name, missing: [!d.city_id && "city", !d.supplier_id && "supplier"].filter(Boolean) }));

  // ---- services filed twice at the same prices ----
  const services = await q(
    `select s.id, s.country_id, s.arabic_name, s.service_type, s.buy_price, s.buy_currency, s.sell_price, s.sell_currency, s.created_at, m.legacy_id
       from public.services s
       left join public.legacy_id_map m on m.entity = 'service' and m.source = 'app' and m.new_id = s.id`,
  );
  const groups = new Map();
  for (const s of services) {
    const key = [s.country_id, normAr(s.arabic_name || s.service_type), s.buy_price, s.buy_currency, s.sell_price, s.sell_currency].join("|");
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const service_dupes = [...groups.values()]
    .filter((rows) => rows.length > 1)
    .map((rows) => {
      const time = (r) => Date.parse(r.created_at) || 0;
      const sorted = [...rows].sort((a, b) => time(b) - time(a) || Number(b.legacy_id ?? -1) - Number(a.legacy_id ?? -1));
      return { name: sorted[0].arabic_name || sorted[0].service_type, keep_id: sorted[0].id, drop_ids: sorted.slice(1).map((r) => r.id), sell_price: sorted[0].sell_price, ok: true };
    });

  // ---- car types ----
  const cars = await q(
    "select id, arabic_name, english_name, category, vehicle_class, pax_capacity, status, buy_price, buy_currency, sell_price, sell_currency from public.transportation_types",
  );
  const car_seats = cars
    .filter((c) => c.pax_capacity == null && seatsFromName(c.arabic_name ?? c.english_name) && !NOT_A_CAR.test(c.arabic_name ?? ""))
    .map((c) => ({ id: c.id, name: c.arabic_name, pax: seatsFromName(c.arabic_name ?? c.english_name), ok: true }));
  const non_cars = cars
    .filter((c) => c.status !== "Disabled" && NOT_A_CAR.test(`${c.arabic_name ?? ""} ${c.english_name ?? ""}`))
    .map((c) => ({
      id: c.id,
      name: c.arabic_name,
      category: c.category,
      service: {
        arabic_name: c.arabic_name,
        english_name: c.english_name,
        service_type: c.arabic_name,
        buy_price: c.buy_price,
        buy_currency: c.buy_currency,
        sell_price: c.sell_price,
        sell_currency: c.sell_currency,
      },
      country_id: null,
      ok: true,
    }));
  const spellingGroups = new Map();
  for (const c of cars.filter((c) => c.status !== "Disabled" && seatsFromName(c.arabic_name) && !NOT_A_CAR.test(c.arabic_name ?? ""))) {
    const key = seatWordless(c.arabic_name);
    spellingGroups.set(key, [...(spellingGroups.get(key) ?? []), c]);
  }
  const car_spellings = [...spellingGroups.values()]
    .filter((rows) => rows.length > 1)
    .map((rows) => {
      const keep = rows.find((r) => r.category === "fleet") ?? rows[0];
      return {
        names: rows.map((r) => ({ id: r.id, name: r.arabic_name, category: r.category })),
        keep_id: keep.id,
        keep_name: keep.arabic_name.replace(/راكب|ركاب|مقاعد/g, "مقعد"),
        ok: false,
      };
    });

  console.log(
    `test drivers ${test_drivers.length}, incomplete drivers ${incomplete_drivers.length}, service duplicates ${service_dupes.length} (${service_dupes.reduce((n, d) => n + d.drop_ids.length, 0)} rows), car seats ${car_seats.length}, non-cars ${non_cars.length}, car spellings ${car_spellings.length}`,
  );
  return { notes: linked ? [] : ["0072 is not applied: drivers.city_id / supplier_id do not exist yet"], test_drivers, incomplete_drivers, service_dupes, car_seats, non_cars, car_spellings };
});
