import type { FilterDef, TableConfig } from "./types";

const COUNTRY_FILTER: FilterDef = { key: "country_id", labelKey: "filter.country", kind: "select", source: "countries" };
const CITY_FILTER: FilterDef = { key: "city_id", labelKey: "filter.city", kind: "select", source: "cities" };
const EMPLOYEE_FILTER: FilterDef = { key: "employee_id", labelKey: "filter.employee", kind: "select", source: "employees" };

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
      { key: "default_hotel", labelKey: "col.defaultHotel", minWidth: "220px" },
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
    route: "/hotels", table: "hotels", titleKey: "nav.hotels",
    columns: [
      { key: "arabic_name", labelKey: "col.arabicName" },
      { key: "english_name", labelKey: "col.englishName" },
      { key: "stars", labelKey: "col.stars", type: "number" },
      { key: "address", labelKey: "col.address", minWidth: "200px" },
      { key: "contact_number", labelKey: "col.contactNumber", type: "phone" },
      { key: "website", labelKey: "col.website", type: "url", minWidth: "180px" },
    ],
    searchable: ["arabic_name", "english_name", "address"],
    filters: [CITY_FILTER],
    defaultSort: { column: "arabic_name", ascending: true },
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
    columns: [
      { key: "arabic_name", labelKey: "col.arabicName" },
      { key: "english_name", labelKey: "col.englishName" },
    ],
    searchable: ["arabic_name", "english_name"],
    defaultSort: { column: "arabic_name", ascending: true },
  },
  // terms — three routes, one table, filtered by kind
  {
    route: "/offers/offer-includes", table: "terms", titleKey: "nav.offerIncludes",
    columns: [
      { key: "arabic_text", labelKey: "col.arabicText", minWidth: "280px" },
      { key: "english_text", labelKey: "col.englishText", minWidth: "280px" },
      { key: "checked", labelKey: "col.checked" },
    ],
    searchable: ["arabic_text", "english_text"],
    fixedValues: { kind: "include" },
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
  // ---- lookup tables (migration 0003) ----
  {
    route: "/airports", table: "airports", titleKey: "nav.airports",
    columns: [
      { key: "arabic_name", labelKey: "col.arabicName" },
      { key: "english_name", labelKey: "col.englishName" },
      { key: "code", labelKey: "col.iata", type: "serial" },
      { key: "icao", labelKey: "col.icao", type: "serial" },
      { key: "iana_timezone", labelKey: "col.timezone", type: "serial", minWidth: "180px" },
      { key: "status", labelKey: "col.status", type: "status" },
    ],
    searchable: ["arabic_name", "english_name", "code", "icao"],
    filters: [COUNTRY_FILTER, CITY_FILTER],
    defaultSort: { column: "code", ascending: true },
  },
  {
    route: "/cars-types", table: "transportation_types", titleKey: "nav.carTypes",
    columns: [
      { key: "arabic_name", labelKey: "col.arabicName", minWidth: "220px" },
      { key: "english_name", labelKey: "col.englishName", minWidth: "220px" },
      { key: "category", labelKey: "col.category" },
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
    ],
    searchable: ["arabic_name", "english_name", "mobile"],
    filters: [COUNTRY_FILTER],
    defaultSort: { column: "arabic_name", ascending: true },
  },
  {
    route: "/cars/tours", table: "tours", titleKey: "nav.tours",
    columns: [
      { key: "arabic_name", labelKey: "col.arabicName" },
      { key: "english_name", labelKey: "col.englishName" },
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
      { key: "car_type", labelKey: "col.carType" },
      { key: "price", labelKey: "col.price", type: "currency" },
      { key: "currency", labelKey: "col.currency" },
    ],
    searchable: ["from_city", "to_city", "car_type"],
    filters: [COUNTRY_FILTER],
    defaultSort: { column: "created_at", ascending: false },
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
  {
    route: "/ready-offers", table: "ready_offers", titleKey: "nav.readyOffers",
    columns: [
      { key: "title", labelKey: "col.title", minWidth: "200px" },
      { key: "country", labelKey: "filter.country" },
      { key: "days", labelKey: "col.days", type: "number" },
      { key: "price", labelKey: "col.price", type: "currency" },
      { key: "currency", labelKey: "col.currency" },
    ],
    searchable: ["title", "country"],
    defaultSort: { column: "created_at", ascending: false },
  },
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
