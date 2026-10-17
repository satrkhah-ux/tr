import { PLACE_KINDS, ROOM_CATEGORIES } from "@/lib/catalog/model";
import { FILTER_NOT_NULL, FILTER_NULL, type AllowedTable, type FilterDef, type FilterOption, type TableConfig } from "./types";

const COUNTRY_FILTER: FilterDef = { key: "country_id", labelKey: "filter.country", kind: "select", source: "countries" };
const CITY_FILTER: FilterDef = { key: "city_id", labelKey: "filter.city", kind: "select", source: "cities" };
const EMPLOYEE_FILTER: FilterDef = { key: "employee_id", labelKey: "filter.employee", kind: "select", source: "employees" };

// ---- the data model's options (0072) ----
const ROOM_CATEGORY_OPTIONS: FilterOption[] = ROOM_CATEGORIES.map((c) => ({ value: c, label: c, labelKey: `data.model.roomCat.${c}` as const }));
const PLACE_KIND_OPTIONS: FilterOption[] = PLACE_KINDS.map((k) => ({ value: k, label: k, labelKey: `data.model.kind.${k}` as const }));
const POINT_KIND_OPTIONS: FilterOption[] = (["airport", "station", "port", "city"] as const).map((k) => ({ value: k, label: k, labelKey: `data.model.point.${k}` as const }));

/** Every DB-backed route. The generic engine turns each entry into a real,
 *  persistent table (list + CRUD + pagination + filters). Labels are i18n keys
 *  resolved through the translator at render time. */
const CONFIGS: TableConfig[] = [
  {
    route: "/countries", table: "countries", titleKey: "nav.countries",
    columns: [
      { key: "arabic_name", labelKey: "col.arabicName" },
      { key: "english_name", labelKey: "col.englishName" },
      { key: "iso2", labelKey: "col.iso2", type: "serial" },
      { key: "default_currency", labelKey: "col.defaultCurrency" },
      { key: "timezone", labelKey: "col.timezone", type: "serial", minWidth: "170px" },
      { key: "visa_required", labelKey: "col.visaRequired" },
      { key: "weekend", labelKey: "col.weekend" },
      { key: "status", labelKey: "col.status", type: "status" },
    ],
    searchable: ["arabic_name", "english_name", "code", "iso2"],
    defaultSort: { column: "arabic_name", ascending: true },
  },
  {
    route: "/cities", table: "cities", titleKey: "nav.cities",
    columns: [
      { key: "arabic_name", labelKey: "col.arabicName" },
      { key: "english_name", labelKey: "col.englishName" },
      { key: "country_id", labelKey: "filter.country", source: "countries" },
      { key: "default_hotel", labelKey: "col.defaultHotel", minWidth: "220px" },
      // lower first in the generator's city list (ماليزيا: كوالالمبور 1 …); empty = alphabetical after
      { key: "sort_order", labelKey: "col.sortOrder", type: "number" },
    ],
    searchable: ["arabic_name", "english_name", "default_hotel"],
    filters: [COUNTRY_FILTER],
    defaultSort: { column: "arabic_name", ascending: true },
  },
  {
    route: "/customers", table: "customers", titleKey: "nav.customers",
    columns: [
      { key: "company", labelKey: "col.company", minWidth: "180px" },
      { key: "arabic_name", labelKey: "col.name" },
      { key: "english_name", labelKey: "col.englishName" },
      { key: "mobile", labelKey: "col.mobile", type: "phone" },
      { key: "email", labelKey: "col.email" },
      { key: "passport_number", labelKey: "col.passportNumber", type: "serial" },
    ],
    searchable: ["company", "arabic_name", "english_name", "mobile", "email"],
    defaultSort: { column: "created_at", ascending: false },
  },
  {
    route: "/employees", table: "employees", titleKey: "nav.employees",
    columns: [
      { key: "arabic_name", labelKey: "col.arabicName" },
      { key: "english_name", labelKey: "col.englishName" },
      { key: "email", labelKey: "col.email" },
      { key: "mobile", labelKey: "col.mobile", type: "phone" },
      { key: "type", labelKey: "col.type" },
      { key: "status", labelKey: "col.status", type: "status" },
    ],
    searchable: ["arabic_name", "english_name", "email"],
    defaultSort: { column: "arabic_name", ascending: true },
  },
  {
    route: "/employees/roles", table: "roles", titleKey: "nav.roles",
    columns: [
      { key: "arabic_name", labelKey: "col.arabicName" },
      { key: "english_name", labelKey: "col.englishName" },
    ],
    searchable: ["arabic_name", "english_name"],
    defaultSort: { column: "arabic_name", ascending: true },
  },
  {
    // A hotel is found in the generator through its city, so the city is required
    // and the country is the city's (actions.ts derives it on every write).
    // Merge, usage-checked delete and «إيقاف» live in HotelTools.tsx; 0070.
    route: "/hotels", table: "hotels", titleKey: "nav.hotels",
    columns: [
      { key: "arabic_name", labelKey: "col.arabicName" },
      { key: "english_name", labelKey: "col.englishName" },
      { key: "city_id", labelKey: "filter.city", ref: "cities" },
      { key: "country_id", labelKey: "filter.country", ref: "countries", editable: false },
      { key: "stars", labelKey: "col.stars", type: "number" },
      { key: "address", labelKey: "col.address", minWidth: "200px" },
      { key: "contact_number", labelKey: "col.contactNumber", type: "phone" },
      { key: "website", labelKey: "col.website", type: "url", minWidth: "180px" },
      // the hotel voucher's «Open in Google Maps», and the driver's
      { key: "google_maps", labelKey: "col.googleMaps", type: "url", minWidth: "180px" },
      { key: "status", labelKey: "col.status", type: "status" },
    ],
    searchable: ["arabic_name", "english_name", "address"],
    filters: [{ ...COUNTRY_FILTER, viaCity: true }, CITY_FILTER],
    defaultSort: { column: "arabic_name", ascending: true },
  },
  {
    // The catalogue «أنواع الخدمات» was a ten-row static scrape until the
    // legacy import filled it; the prices per country live in /services.
    route: "/services-types", table: "service_types", titleKey: "nav.serviceTypes",
    columns: [
      { key: "arabic_name", labelKey: "col.arabicName", minWidth: "260px" },
      { key: "english_name", labelKey: "col.englishName", minWidth: "260px" },
      { key: "needs_quote", labelKey: "col.needsQuote" },
      { key: "sort", labelKey: "col.sort", type: "number" },
      { key: "status", labelKey: "col.status", type: "status" },
    ],
    searchable: ["arabic_name", "english_name"],
    defaultSort: { column: "sort", ascending: true },
  },
  {
    route: "/services", table: "services", titleKey: "nav.services",
    columns: [
      { key: "arabic_name", labelKey: "col.arabicName" },
      { key: "english_name", labelKey: "col.englishName" },
      { key: "service_type", labelKey: "col.serviceType" },
      { key: "buy_price", labelKey: "col.buyPrice", type: "currency" },
      { key: "sell_price", labelKey: "col.sellPrice", type: "currency" },
      { key: "sell_currency", labelKey: "col.currency" },
    ],
    searchable: ["arabic_name", "english_name", "service_type"],
    filters: [COUNTRY_FILTER],
    defaultSort: { column: "created_at", ascending: false },
  },
  {
    route: "/rooms-types", table: "room_types", titleKey: "nav.roomTypes",
    // the hotel a room belongs to, and its city — a room with none is offered everywhere
    select: "hotels(arabic_name, cities(arabic_name))",
    columns: [
      { key: "arabic_name", labelKey: "col.arabicName" },
      { key: "english_name", labelKey: "col.englishName" },
      { key: "category", labelKey: "data.model.col.roomCategory", options: ROOM_CATEGORY_OPTIONS },
      { key: "hotels.arabic_name", labelKey: "data.model.col.hotel", editable: false, minWidth: "220px" },
      { key: "hotels.cities.arabic_name", labelKey: "filter.city", editable: false },
    ],
    searchable: ["arabic_name", "english_name"],
    filters: [
      {
        key: "room_scope", column: "hotel_id", labelKey: "data.model.filter.roomScope", kind: "select",
        options: [
          { value: FILTER_NULL, label: "general", labelKey: "data.model.scope.general" },
          { value: FILTER_NOT_NULL, label: "hotel", labelKey: "data.model.scope.hotel" },
        ],
      },
      { key: "category", labelKey: "data.model.col.roomCategory", kind: "select", options: ROOM_CATEGORY_OPTIONS },
    ],
    defaultSort: { column: "arabic_name", ascending: true },
  },
  // terms — three routes, one table, filtered by kind. A row added while a
  // country is filtered belongs to that country; with none it is global.
  {
    route: "/offers/offer-includes", table: "terms", titleKey: "nav.offerIncludes",
    columns: [
      { key: "arabic_text", labelKey: "col.arabicText", minWidth: "280px" },
      { key: "english_text", labelKey: "col.englishText", minWidth: "280px" },
      { key: "checked", labelKey: "col.checked" },
    ],
    searchable: ["arabic_text", "english_text"],
    fixedValues: { kind: "include" },
    filters: [COUNTRY_FILTER],
    defaultSort: { column: "sort", ascending: true },
  },
  {
    route: "/offers/offer-not-includes", table: "terms", titleKey: "nav.offerExcludes",
    columns: [
      { key: "arabic_text", labelKey: "col.arabicText", minWidth: "280px" },
      { key: "english_text", labelKey: "col.englishText", minWidth: "280px" },
      { key: "checked", labelKey: "col.checked" },
    ],
    searchable: ["arabic_text", "english_text"],
    fixedValues: { kind: "exclude" },
    filters: [COUNTRY_FILTER],
    defaultSort: { column: "sort", ascending: true },
  },
  {
    route: "/offers/terms-and-conditions", table: "terms", titleKey: "nav.terms",
    columns: [
      { key: "arabic_text", labelKey: "col.arabicText", minWidth: "300px" },
      { key: "english_text", labelKey: "col.englishText", minWidth: "300px" },
      { key: "checked", labelKey: "col.checked" },
    ],
    searchable: ["arabic_text", "english_text"],
    fixedValues: { kind: "term" },
    filters: [COUNTRY_FILTER],
    defaultSort: { column: "sort", ascending: true },
  },
  // offers (with confirmed/unconfirmed toggle)
  {
    route: "/offers", table: "offers", titleKey: "nav.packages",
    columns: [
      { key: "serial", labelKey: "col.serial", type: "serial", minWidth: "170px" },
      { key: "destination", labelKey: "col.destination" },
      { key: "duration", labelKey: "col.duration" },
      { key: "offer_date", labelKey: "col.date", type: "date" },
      { key: "adults", labelKey: "col.adults", type: "number" },
      { key: "total", labelKey: "col.total", type: "currency" },
      { key: "status", labelKey: "col.status", type: "status" },
    ],
    searchable: ["serial", "destination"],
    filters: [EMPLOYEE_FILTER],
    isOffers: true,
    defaultSort: { column: "offer_date", ascending: false },
  },
  // «شركات الطيران» — the carriers and their marks (migration 0031). The logos are
  // fetched once by scripts/fetch-airline-logos.mjs, keyed by IATA designator.
  {
    route: "/airlines", table: "airlines", titleKey: "nav.airlines",
    columns: [
      { key: "logo_path", labelKey: "col.logo", type: "logo", editable: false, minWidth: "90px" },
      { key: "arabic_name", labelKey: "col.arabicName" },
      { key: "english_name", labelKey: "col.englishName" },
      { key: "iata", labelKey: "col.iata", type: "serial" },
      { key: "icao", labelKey: "col.icao", type: "serial" },
      { key: "status", labelKey: "col.status", type: "status" },
    ],
    searchable: ["arabic_name", "english_name", "iata", "icao"],
    defaultSort: { column: "arabic_name", ascending: true },
  },
  // ---- lookup tables (migration 0003) ----
  {
    route: "/airports", table: "airports", titleKey: "nav.airports",
    columns: [
      { key: "arabic_name", labelKey: "col.arabicName" },
      { key: "english_name", labelKey: "col.englishName" },
      // a station or a port has no IATA code; an airport's is three capital letters (0072 checks it)
      { key: "kind", labelKey: "data.model.col.kind", options: PLACE_KIND_OPTIONS },
      { key: "code", labelKey: "col.iata", type: "serial" },
      { key: "icao", labelKey: "col.icao", type: "serial" },
      { key: "iana_timezone", labelKey: "col.timezone", type: "serial", minWidth: "180px" },
      { key: "status", labelKey: "col.status", type: "status" },
    ],
    searchable: ["arabic_name", "english_name", "code", "icao"],
    filters: [COUNTRY_FILTER, CITY_FILTER, { key: "kind", labelKey: "data.model.col.kind", kind: "select", options: PLACE_KIND_OPTIONS }],
    defaultSort: { column: "code", ascending: true },
  },
  {
    route: "/cars-types", table: "transportation_types", titleKey: "nav.carTypes",
    columns: [
      { key: "arabic_name", labelKey: "col.arabicName", minWidth: "220px" },
      { key: "english_name", labelKey: "col.englishName", minWidth: "220px" },
      {
        // «fleet» is load-bearing: it is what puts a row in the generator's
        // vehicle dropdown. A free-text box here meant a new car was added and
        // never appeared.
        key: "category",
        labelKey: "col.category",
        options: [
          { value: "fleet", label: "fleet — مركبة تُختار في البكج" },
          { value: "transfer", label: "transfer — توصيل" },
          { value: "disposal", label: "disposal — تأجير بالساعة" },
          { value: "tour", label: "tour — جولة" },
          { value: "rental", label: "rental — تأجير" },
          { value: "ticket", label: "ticket — تذكرة" },
          { value: "special", label: "special — خاص" },
        ],
      },
      { key: "vehicle_class", labelKey: "col.vehicleClass" },
      { key: "pax_capacity", labelKey: "col.paxCapacity", type: "number" },
      { key: "luggage_capacity", labelKey: "col.luggageCapacity", type: "number" },
      { key: "with_driver", labelKey: "col.withDriver" },
      { key: "duration_unit", labelKey: "col.durationUnit" },
      { key: "buy_price", labelKey: "col.buyPrice", type: "currency" },
      { key: "sell_price", labelKey: "col.sellPrice", type: "currency" },
      { key: "sell_currency", labelKey: "col.currency" },
      { key: "status", labelKey: "col.status", type: "status" },
    ],
    searchable: ["arabic_name", "english_name", "category", "vehicle_class"],
    defaultSort: { column: "arabic_name", ascending: true },
  },
  {
    route: "/markup-rules", table: "markup_rules", titleKey: "nav.markupRules",
    columns: [
      { key: "arabic_name", labelKey: "col.arabicName", minWidth: "200px" },
      { key: "english_name", labelKey: "col.englishName" },
      { key: "scope", labelKey: "col.scope" },
      { key: "markup_type", labelKey: "col.markupType" },
      { key: "markup_value", labelKey: "col.markupValue", type: "number" },
      { key: "country", labelKey: "col.ruleCountry" },
      { key: "city", labelKey: "col.ruleCity" },
      { key: "supplier_id", labelKey: "col.supplierId" },
      { key: "star_rating", labelKey: "col.starRating", type: "number" },
      { key: "season_start", labelKey: "col.seasonStart" },
      { key: "season_end", labelKey: "col.seasonEnd" },
      { key: "customer_type", labelKey: "col.customerType" },
      { key: "is_default", labelKey: "col.isDefault" },
      { key: "min_margin_pct", labelKey: "col.minMargin", type: "number" },
      { key: "rounding_mode", labelKey: "col.roundingMode" },
      { key: "rounding_step", labelKey: "col.roundingStep", type: "number" },
      { key: "priority", labelKey: "col.priority", type: "number" },
      { key: "status", labelKey: "col.status", type: "status" },
    ],
    searchable: ["arabic_name", "english_name", "country", "city", "supplier_id"],
    defaultSort: { column: "priority", ascending: false },
  },
  {
    route: "/ports", table: "ports", titleKey: "nav.ports",
    columns: [
      { key: "arabic_name", labelKey: "col.arabicName" },
      { key: "english_name", labelKey: "col.englishName" },
    ],
    searchable: ["arabic_name", "english_name"],
    filters: [COUNTRY_FILTER],
    defaultSort: { column: "arabic_name", ascending: true },
  },
  {
    route: "/drivers", table: "drivers", titleKey: "nav.drivers",
    columns: [
      { key: "arabic_name", labelKey: "col.arabicName" },
      { key: "english_name", labelKey: "col.englishName" },
      { key: "mobile", labelKey: "col.mobile", type: "phone" },
      { key: "car_type", labelKey: "col.carType" },
      { key: "country_id", labelKey: "filter.country", source: "countries" },
      { key: "city_id", labelKey: "filter.city", source: "cities" },
      { key: "supplier_id", labelKey: "col.supplier", source: "suppliers" },
      { key: "status", labelKey: "col.status", type: "status" },
    ],
    searchable: ["arabic_name", "english_name", "mobile"],
    filters: [COUNTRY_FILTER],
    defaultSort: { column: "arabic_name", ascending: true },
  },
  {
    // The old system's day programmes (0052), offered on each day of the
    // «البرنامج اليومي» card for the day's city, in this order.
    route: "/tour-programs", table: "tour_programs", titleKey: "nav.tourPrograms",
    columns: [
      { key: "title", labelKey: "col.title" },
      { key: "description_ar", labelKey: "col.description", minWidth: "360px" },
      { key: "sort_order", labelKey: "col.sortOrder", type: "number" },
      { key: "status", labelKey: "col.status", type: "status" },
    ],
    searchable: ["title", "description_ar"],
    filters: [CITY_FILTER],
    defaultSort: { column: "sort_order", ascending: true },
  },
  {
    // Who the agency books through — offered beside every typed flight and
    // hotel price. «categories» is words the generator matches: فنادق، طيران، تنقلات، خدمات.
    route: "/company-suppliers", table: "company_suppliers", titleKey: "nav.companySuppliers",
    columns: [
      { key: "arabic_name", labelKey: "col.arabicName" },
      { key: "english_name", labelKey: "col.englishName" },
      { key: "categories", labelKey: "col.categories", minWidth: "200px" },
      { key: "contact_name", labelKey: "col.contactName" },
      { key: "mobile", labelKey: "col.mobile", type: "phone" },
      // where operations sends a booking request, and the language it is written in (0063)
      { key: "whatsapp", labelKey: "ops.sup.col.whatsapp", type: "phone" },
      { key: "email", labelKey: "col.email" },
      {
        key: "request_lang",
        labelKey: "ops.sup.col.requestLang",
        options: [
          { value: "ar", label: "ar — عربي" },
          { value: "en", label: "en — English" },
        ],
      },
      { key: "status", labelKey: "col.status", type: "status" },
    ],
    searchable: ["arabic_name", "english_name", "categories", "contact_name"],
    defaultSort: { column: "arabic_name", ascending: true },
  },
  {
    route: "/cars/tours", table: "tours", titleKey: "nav.tours",
    columns: [
      { key: "arabic_name", labelKey: "col.arabicName" },
      { key: "english_name", labelKey: "col.englishName" },
      // one tour, its city and length; its price per car is on /cars/transfers/quick (tour_prices, 0072)
      { key: "city_id", labelKey: "filter.city", source: "cities" },
      { key: "duration_hours", labelKey: "data.model.col.durationHours", type: "number" },
      { key: "price", labelKey: "col.price", type: "currency" },
      { key: "currency", labelKey: "col.currency" },
    ],
    searchable: ["arabic_name", "english_name"],
    filters: [COUNTRY_FILTER],
    defaultSort: { column: "arabic_name", ascending: true },
  },
  {
    route: "/cars/transfers", table: "transfers", titleKey: "nav.transfers",
    columns: [
      { key: "from_city", labelKey: "col.fromCity" },
      { key: "to_city", labelKey: "col.toCity" },
      // what each end IS (0072) — set by the quick price grid and data-transfers, never typed
      { key: "from_kind", labelKey: "data.model.col.fromKind", options: POINT_KIND_OPTIONS, editable: false },
      { key: "to_kind", labelKey: "data.model.col.toKind", options: POINT_KIND_OPTIONS, editable: false },
      { key: "car_type", labelKey: "col.carType" },
      { key: "price", labelKey: "col.price", type: "currency" },
      { key: "currency", labelKey: "col.currency" },
    ],
    searchable: ["from_city", "to_city", "car_type"],
    filters: [COUNTRY_FILTER],
    defaultSort: { column: "created_at", ascending: false },
  },
  {
    // the old static page's rows, moved by data-texts (0072); src/app/visas/page.tsx switches once they are in
    route: "/visas", table: "visas", titleKey: "nav.visas",
    columns: [
      { key: "country_id", labelKey: "filter.country", source: "countries" },
      { key: "country", labelKey: "data.model.col.countryText" },
      { key: "visa_type", labelKey: "col.visaType" },
      { key: "buy_price", labelKey: "col.buyPrice", type: "currency" },
      { key: "buy_currency", labelKey: "col.buyCurrency" },
      { key: "sell_price", labelKey: "col.sellPrice", type: "currency" },
      { key: "sell_currency", labelKey: "col.sellCurrency" },
      { key: "arabic_requirements", labelKey: "col.arabicRequirements", minWidth: "300px" },
      { key: "english_requirements", labelKey: "col.englishRequirements", minWidth: "300px" },
      { key: "status", labelKey: "col.status", type: "status" },
    ],
    searchable: ["country", "visa_type", "arabic_requirements"],
    filters: [COUNTRY_FILTER],
    defaultSort: { column: "country", ascending: true },
  },
  {
    route: "/setting/statuses", table: "statuses", titleKey: "nav.statuses",
    columns: [
      { key: "arabic_name", labelKey: "col.arabicName" },
      { key: "english_name", labelKey: "col.englishName" },
      { key: "group_name", labelKey: "col.groupName" },
      { key: "color", labelKey: "col.color" },
    ],
    searchable: ["arabic_name", "english_name", "group_name"],
    defaultSort: { column: "arabic_name", ascending: true },
  },
  {
    route: "/setting/supervisors", table: "supervisors", titleKey: "nav.supervisors",
    columns: [
      { key: "arabic_name", labelKey: "col.arabicName" },
      { key: "english_name", labelKey: "col.englishName" },
      { key: "email", labelKey: "col.email" },
    ],
    searchable: ["arabic_name", "english_name", "email"],
    defaultSort: { column: "arabic_name", ascending: true },
  },
  {
    route: "/setting/profits", table: "profits", titleKey: "nav.profits",
    columns: [
      { key: "arabic_name", labelKey: "col.name" },
      { key: "percent", labelKey: "col.percent", type: "number" },
    ],
    searchable: ["arabic_name"],
    filters: [COUNTRY_FILTER],
    defaultSort: { column: "arabic_name", ascending: true },
  },
  {
    route: "/guide/informations", table: "guide_informations", titleKey: "nav.guideInfo",
    columns: [
      { key: "category", labelKey: "col.category" },
      { key: "title", labelKey: "col.title", minWidth: "220px" },
      { key: "body", labelKey: "col.body", minWidth: "300px" },
    ],
    searchable: ["category", "title", "body"],
    defaultSort: { column: "created_at", ascending: false },
  },
  // /ready-offers is NOT a generic grid: src/app/ready-offers/page.tsx renders
  // the seasonal-package catalog (sync + "start an offer"), and the sheet is the
  // source of truth for its content. See lib/ready-offers.
  {
    route: "/customers_care", table: "care_tickets", titleKey: "nav.customerCare",
    columns: [
      { key: "customer", labelKey: "col.customer" },
      { key: "subject", labelKey: "col.subject", minWidth: "220px" },
      { key: "status", labelKey: "col.status", type: "status" },
      { key: "note", labelKey: "col.note", minWidth: "260px" },
    ],
    searchable: ["customer", "subject", "note"],
    defaultSort: { column: "created_at", ascending: false },
  },
];

const BY_ROUTE = new Map<string, TableConfig>(CONFIGS.map((c) => [c.route, c]));
// aliases: real dirs that render another route's table
BY_ROUTE.set("/packages", { ...(BY_ROUTE.get("/offers") as TableConfig), route: "/packages" });

export function resolveTableConfig(route: string): TableConfig | null {
  const normalized = route.startsWith("/") ? route : `/${route}`;
  return BY_ROUTE.get(normalized) ?? null;
}

export function allTableConfigs(): TableConfig[] {
  return CONFIGS;
}

/**
 * Cost columns, withheld from `authenticated` by 0047, read AND write — this is
 * the mirror of its column grants (table-config.test.ts holds the two together). On these
 * tables `select *` fails for every session, so without pricing.internal the
 * engine names the granted columns, the screen drops the rest and a write never
 * carries them; with it, the engine goes through the service role.
 */
export const GRANTED_COLUMNS: Partial<Record<AllowedTable, readonly string[]>> = {
  services: [
    "id", "country_id", "arabic_name", "english_name", "service_type", "service_type_id",
    "sell_price", "sell_currency", "created_at",
  ],
  transportation_types: [
    "id", "arabic_name", "english_name", "category", "vehicle_class", "pax_capacity", "luggage_capacity",
    "with_driver", "duration_unit", "sell_price", "sell_currency", "status", "created_at",
  ],
  // 0072
  visas: [
    "id", "country", "country_id", "visa_type", "sell_price", "sell_currency", "arabic_requirements",
    "english_requirements", "status", "created_at",
  ],
};

/**
 * Tables 0070 gives a `search_key` computed field (every text column folded by
 * catalog_norm, plus its catalog_skel skeleton): the search box matches on it,
 * so «فندق» finds «فندقة» and «ملينيوم» finds «ميلينيوم». Any other table — or
 * a database 0070 has not reached — keeps the plain ilike on `searchable`.
 * Not services / transportation_types: their cost columns are column-granted
 * and a whole-row reference needs them all. table-config.test.ts holds this to 0070.
 */
export const SEARCH_KEY_TABLES: readonly AllowedTable[] = [
  "countries", "cities", "hotels", "room_types", "service_types", "terms", "airlines", "airports",
  "markup_rules", "ports", "drivers", "tour_programs", "company_suppliers", "tours", "transfers",
];

/** «قسم البيانات»: the reference tables «تصدير / استيراد Excel» is offered on — not people, offers or settings. */
export const DATA_TABLES: readonly AllowedTable[] = [...SEARCH_KEY_TABLES, "services", "transportation_types"];

/** The margin policy itself — served to pricing.internal only, through the service role. */
export const INTERNAL_TABLES: readonly AllowedTable[] = ["markup_rules", "profits"];

/** A column a session without pricing.internal may neither see nor write. */
export function isCostColumn(table: AllowedTable, column: string): boolean {
  const granted = GRANTED_COLUMNS[table];
  return granted !== undefined && !granted.includes(column);
}
