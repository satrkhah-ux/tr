/**
 * Single source of truth for the Traveliun data model.
 *
 * These types mirror the SQL schema in `supabase/migrations/0001_init.sql`.
 * The Supabase clients are parameterised with `Database` so every query is
 * typed end-to-end. Domain aliases (Country, Offer, …) are re-exported for use
 * across the app.
 */

// ---------- shared ----------
export type Uuid = string;
export type IsoTimestamp = string;
export type IsoDate = string;

export type TermKind = "include" | "exclude" | "term";
export type OfferServiceKind = "include" | "exclude";
export type OfferStatus = "draft" | "sent" | "confirmed" | "cancelled";

// board basis (Room Only / Bed & Breakfast / Half / Full board / All Inclusive)
export type BoardType = "RO" | "BB" | "HB" | "FB" | "AI";
export type FlightLegOrder = "outbound" | "inbound" | "internal";
export type PricingItemType = "hotel" | "flight" | "visa" | "service" | "transport" | "other";
export type RenderVariant = "client" | "internal";
export type ClimateLevel = "low" | "medium" | "high";

// ---------- row types (one per table) ----------
export interface Country {
  id: Uuid;
  arabic_name: string;
  english_name: string | null;
  code: string | null;
  /** ISO 3166-1 alpha-2 — stable join key for airports (migration 0011). */
  iso2: string | null;
  /** primary IANA timezone. */
  timezone: string | null;
  visa_required: boolean | null;
  default_currency: string | null;
  weekend: string | null;
  status: string;
  created_at: IsoTimestamp;
}

export interface City {
  id: Uuid;
  country_id: Uuid | null;
  arabic_name: string;
  english_name: string | null;
  default_hotel: string | null;
  created_at: IsoTimestamp;
}

export interface Hotel {
  id: Uuid;
  city_id: Uuid | null;
  country_id: Uuid | null;
  arabic_name: string;
  english_name: string | null;
  stars: number | null;
  address: string | null;
  google_maps: string | null;
  contact_number: string | null;
  website: string | null;
  is_default: boolean;
  created_at: IsoTimestamp;
}

export interface RoomType {
  id: Uuid;
  arabic_name: string;
  english_name: string | null;
  /** null = a global room-type lookup; set = scoped to one hotel (migration 0008). */
  hotel_id: Uuid | null;
  capacity: number | null;
  default_board: BoardType | null;
  created_at: IsoTimestamp;
}

export interface Service {
  id: Uuid;
  country_id: Uuid | null;
  arabic_name: string | null;
  english_name: string | null;
  service_type: string | null;
  buy_price: number | null;
  buy_currency: string | null;
  sell_price: number | null;
  sell_currency: string | null;
  created_at: IsoTimestamp;
}

export interface Term {
  id: Uuid;
  kind: TermKind;
  arabic_text: string;
  english_text: string | null;
  checked: boolean;
  sort: number;
  created_at: IsoTimestamp;
}

export interface Flight {
  id: Uuid;
  carrier: string | null;
  from_airport: string | null;
  to_airport: string | null;
  flight_date: IsoDate | null;
  passengers: number | null;
  baggage: string | null;
  cabin: string | null;
  type: string | null;
  created_at: IsoTimestamp;
}

export interface Customer {
  id: Uuid;
  company: string | null;
  arabic_name: string;
  english_name: string | null;
  mobile: string | null;
  email: string | null;
  second_mobile: string | null;
  birth_date: IsoDate | null;
  passport_first_name: string | null;
  passport_last_name: string | null;
  passport_number: string | null;
  passport_issue_date: IsoDate | null;
  passport_expiry_date: IsoDate | null;
  created_at: IsoTimestamp;
}

export interface Role {
  id: Uuid;
  arabic_name: string;
  english_name: string | null;
  permissions: Record<string, unknown>;
  created_at: IsoTimestamp;
}

export interface Employee {
  id: Uuid;
  arabic_name: string;
  english_name: string | null;
  email: string | null;
  mobile: string | null;
  role_id: Uuid | null;
  type: string | null;
  status: string;
  auth_user_id: Uuid | null;
  created_at: IsoTimestamp;
}

export interface Offer {
  id: Uuid;
  serial: string;
  customer_id: Uuid | null;
  employee_id: Uuid | null;
  destination: string | null;
  duration: string | null;
  offer_date: IsoDate | null;
  adults: number;
  children: number;
  infants: number;
  total: number | null;
  currency: string | null;
  status: OfferStatus;
  pipeline_stage: string;
  pdf_url: string | null;
  created_at: IsoTimestamp;
}

export interface OfferCity {
  id: Uuid;
  offer_id: Uuid;
  city_name: string;
  hotel_name: string | null;
  room_type: string | null;
  check_in: IsoDate | null;
  check_out: IsoDate | null;
  nights: number | null;
  meals: string | null;
  stars: number | null;
  sort: number;
  created_at: IsoTimestamp;
}

export interface OfferFlight {
  id: Uuid;
  offer_id: Uuid;
  flight_date: IsoDate | null;
  passengers: number | null;
  carrier: string | null;
  from_airport: string | null;
  to_airport: string | null;
  baggage: string | null;
  cabin: string | null;
  type: string | null;
  // migration 0008 — richer legs & schedule (all client-safe; NO buy pricing here)
  airline: string | null;
  flight_no: string | null;
  departure_at: IsoTimestamp | null;
  arrival_at: IsoTimestamp | null;
  cabin_class: string | null;
  baggage_allowance: string | null;
  leg_order: FlightLegOrder | null;
  sort: number;
  created_at: IsoTimestamp;
}

/** Normalized hotel line with dual pricing (migration 0008). Authenticated-only. */
export interface OfferHotel {
  id: Uuid;
  offer_id: Uuid;
  offer_city_id: Uuid | null;
  hotel_id: Uuid | null;
  hotel_name: string | null;
  room_type_id: Uuid | null;
  rooms_count: number;
  board_type: BoardType | null;
  check_in: IsoDate | null;
  check_out: IsoDate | null;
  nights: number | null;
  buy_price: number | null;
  buy_currency: string | null;
  sell_price: number | null;
  sell_currency: string | null;
  sort: number;
  created_at: IsoTimestamp;
  // ----- supplier sourcing + client-safety (migration 0014) -----
  /** CLIENT-SAFE: shown to the client. */
  cancellation_policy: string | null;
  /** CLIENT-SAFE: surcharges the guest pays at the hotel. jsonb [{name,amount,currency}]. */
  excluded_surcharges: unknown;
  /** CLIENT-SAFE: rate validity. */
  valid_until: IsoDate | null;
  /** INTERNAL cost basis — stripped from the client DTO. */
  supplier_id: string | null;
  supplier_name: string | null;
  rate_key: string | null;
  net_base: number | null;
  net_source_currency: string | null;
  fx_rate: number | null;
  fx_date: IsoDate | null;
  ref_sell_base: number | null;
  markup_amount: number | null;
  markup_pct: number | null;
}

/** Unified per-item buy/sell rollup (migration 0008). Server-only (never anon). */
export interface OfferPricingItem {
  id: Uuid;
  offer_id: Uuid;
  item_type: PricingItemType;
  item_id: Uuid | null;
  description: string | null;
  quantity: number;
  buy_price: number | null;
  buy_currency: string | null;
  sell_price: number | null;
  sell_currency: string | null;
  total_buy: number | null;
  total_sell: number | null;
  sort: number;
  created_at: IsoTimestamp;
}

/** Immutable snapshot of what was actually rendered/sent (migration 0008). */
export interface OfferRender {
  id: Uuid;
  offer_id: Uuid;
  version: number;
  variant: RenderVariant;
  snapshot_json: Record<string, unknown>;
  file_path: string | null;
  rendered_by: Uuid | null;
  rendered_at: IsoTimestamp;
  created_at: IsoTimestamp;
}

/** Audit trail of offer status transitions (migration 0010). Authenticated-only. */
export interface OfferStatusHistory {
  id: Uuid;
  offer_id: Uuid;
  from_status: string | null;
  to_status: string;
  note: string | null;
  changed_by: Uuid | null;
  created_at: IsoTimestamp;
}

/** Package-generator draft: per-stage slices persisted as JSONB (migration 0009).
 *  Internal-only (may hold buy pricing) — never anon-readable. */
export interface OfferDraft {
  id: Uuid;
  title: string | null;
  data: Record<string, unknown>;
  created_by: Uuid | null;
  updated_at: IsoTimestamp;
  created_at: IsoTimestamp;
}

/** Editorially-maintained monthly climate advice per city (migration 0008). */
export interface CityClimateNote {
  id: Uuid;
  city_id: Uuid;
  month: number;
  avg_high_c: number | null;
  avg_low_c: number | null;
  rain_level: ClimateLevel | null;
  humidity_level: ClimateLevel | null;
  advice_ar: string | null;
  advice_en: string | null;
  updated_by: Uuid | null;
  updated_at: IsoTimestamp;
  created_at: IsoTimestamp;
}

export interface OfferService {
  id: Uuid;
  offer_id: Uuid;
  label: string;
  kind: OfferServiceKind;
  sort: number;
  created_at: IsoTimestamp;
}

export interface OfferTerm {
  id: Uuid;
  offer_id: Uuid;
  text: string;
  sort: number;
  created_at: IsoTimestamp;
}

export interface Pricing {
  id: Uuid;
  offer_id: Uuid;
  total: number | null;
  currency: string | null;
  buy_total: number | null;
  sell_total: number | null;
  profit: number | null;
  created_at: IsoTimestamp;
}

export interface OfferRevision {
  id: Uuid;
  offer_id: Uuid;
  revision: number;
  snapshot: Record<string, unknown>;
  note: string | null;
  created_at: IsoTimestamp;
}

// ---------- lookup tables (migration 0003; airport cols in 0011) ----------
export interface Airport {
  id: Uuid;
  arabic_name: string;
  english_name: string | null;
  /** IATA code. */
  code: string | null;
  icao: string | null;
  city_id: Uuid | null;
  country_id: Uuid | null;
  /** REQUIRED by the flight engine. */
  iana_timezone: string | null;
  lat: number | null;
  lng: number | null;
  status: string;
  created_at: IsoTimestamp;
}

/** Admin-editable transportation catalog with dual pricing (migration 0011). */
export interface TransportationType {
  id: Uuid;
  arabic_name: string;
  english_name: string | null;
  category: string | null;
  vehicle_class: string | null;
  pax_capacity: number | null;
  luggage_capacity: number | null;
  with_driver: boolean;
  duration_unit: string | null;
  buy_price: number | null;
  buy_currency: string | null;
  sell_price: number | null;
  sell_currency: string | null;
  status: string;
  created_at: IsoTimestamp;
}

/** Admin-editable markup rule (migration 0013). Drives src/lib/pricing/markup.ts. */
export interface MarkupRuleRow {
  id: Uuid;
  arabic_name: string;
  english_name: string | null;
  scope: string;
  markup_type: string;
  markup_value: number;
  country: string | null;
  city: string | null;
  supplier_id: string | null;
  star_rating: number | null;
  season_start: string | null;
  season_end: string | null;
  customer_type: string | null;
  is_default: boolean;
  min_margin_pct: number | null;
  rounding_mode: string | null;
  rounding_step: number | null;
  priority: number;
  status: string;
  created_at: IsoTimestamp;
}

/** Hotel supplier registry (migration 0015). credentials_encrypted is a vault blob. */
export interface HotelSupplierRow {
  id: Uuid;
  code: string;
  name_ar: string;
  name_en: string | null;
  enabled: boolean;
  environment: string;
  base_url: string | null;
  credentials_encrypted: string | null;
  priority: number;
  default_markup_rule_id: Uuid | null;
  last_sync_at: IsoTimestamp | null;
  last_sync_status: string | null;
  last_error: string | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/** Static hotel content cached once per supplier hotel (migration 0015). */
export interface HotelContentCacheRow {
  id: Uuid;
  supplier: string;
  supplier_hotel_id: string;
  internal_hotel_id: Uuid | null;
  name_ar: string | null;
  name_en: string | null;
  star_rating: number | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  description: string | null;
  images: unknown;
  facilities: unknown;
  room_type_catalogue: unknown;
  check_in_time: string | null;
  check_out_time: string | null;
  content_synced_at: IsoTimestamp;
  content_source: string | null;
  created_at: IsoTimestamp;
}

/** Audit trail — who changed what, when (never the secret value). */
export interface AuditLogRow {
  id: Uuid;
  actor_id: Uuid | null;
  actor_email: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  meta: unknown;
  created_at: IsoTimestamp;
}

export interface Port {
  id: Uuid;
  arabic_name: string;
  english_name: string | null;
  country_id: Uuid | null;
  created_at: IsoTimestamp;
}

export interface Driver {
  id: Uuid;
  arabic_name: string;
  english_name: string | null;
  mobile: string | null;
  country_id: Uuid | null;
  car_type: string | null;
  created_at: IsoTimestamp;
}

export interface Tour {
  id: Uuid;
  arabic_name: string;
  english_name: string | null;
  country_id: Uuid | null;
  price: number | null;
  currency: string | null;
  created_at: IsoTimestamp;
}

export interface Transfer {
  id: Uuid;
  from_city: string | null;
  to_city: string | null;
  car_type: string | null;
  price: number | null;
  currency: string | null;
  country_id: Uuid | null;
  created_at: IsoTimestamp;
}

export interface Status {
  id: Uuid;
  arabic_name: string;
  english_name: string | null;
  group_name: string | null;
  color: string | null;
  created_at: IsoTimestamp;
}

export interface Supervisor {
  id: Uuid;
  arabic_name: string;
  english_name: string | null;
  email: string | null;
  created_at: IsoTimestamp;
}

export interface GuideInformation {
  id: Uuid;
  category: string | null;
  title: string;
  body: string | null;
  created_at: IsoTimestamp;
}

export interface Profit {
  id: Uuid;
  arabic_name: string;
  percent: number | null;
  country_id: Uuid | null;
  created_at: IsoTimestamp;
}

export interface ReadyOffer {
  id: Uuid;
  title: string;
  country: string | null;
  days: number | null;
  price: number | null;
  currency: string | null;
  created_at: IsoTimestamp;
}

export interface CareTicket {
  id: Uuid;
  customer: string | null;
  subject: string | null;
  status: string | null;
  note: string | null;
  employee_id: Uuid | null;
  type: string | null;
  responded_at: IsoTimestamp | null;
  created_at: IsoTimestamp;
}

export interface Presence {
  employee_id: Uuid;
  user_id: Uuid | null;
  last_seen_at: IsoTimestamp;
}

// ---------- Supabase Database shape ----------
/** Generated columns (id, created_at) are optional on insert. */
type Insertable<T extends { id: Uuid; created_at: IsoTimestamp }> = Omit<T, "id" | "created_at"> & {
  id?: Uuid;
  created_at?: IsoTimestamp;
};

interface TableShape<Row extends { id: Uuid; created_at: IsoTimestamp }> {
  Row: Row;
  Insert: Insertable<Row>;
  Update: Partial<Insertable<Row>>;
  Relationships: [];
}

export interface Database {
  public: {
    Tables: {
      countries: TableShape<Country>;
      cities: TableShape<City>;
      hotels: TableShape<Hotel>;
      room_types: TableShape<RoomType>;
      services: TableShape<Service>;
      terms: TableShape<Term>;
      flights: TableShape<Flight>;
      customers: TableShape<Customer>;
      roles: TableShape<Role>;
      employees: TableShape<Employee>;
      offers: TableShape<Offer>;
      offer_cities: TableShape<OfferCity>;
      offer_flights: TableShape<OfferFlight>;
      offer_hotels: TableShape<OfferHotel>;
      offer_services: TableShape<OfferService>;
      offer_terms: TableShape<OfferTerm>;
      offer_pricing_items: TableShape<OfferPricingItem>;
      offer_renders: TableShape<OfferRender>;
      offer_status_history: TableShape<OfferStatusHistory>;
      pricings: TableShape<Pricing>;
      offer_revisions: TableShape<OfferRevision>;
      offer_drafts: TableShape<OfferDraft>;
      city_climate_notes: TableShape<CityClimateNote>;
      airports: TableShape<Airport>;
      transportation_types: TableShape<TransportationType>;
      markup_rules: TableShape<MarkupRuleRow>;
      hotel_suppliers: TableShape<HotelSupplierRow>;
      hotel_content_cache: TableShape<HotelContentCacheRow>;
      audit_logs: TableShape<AuditLogRow>;
      ports: TableShape<Port>;
      drivers: TableShape<Driver>;
      tours: TableShape<Tour>;
      transfers: TableShape<Transfer>;
      statuses: TableShape<Status>;
      supervisors: TableShape<Supervisor>;
      guide_informations: TableShape<GuideInformation>;
      profits: TableShape<Profit>;
      ready_offers: TableShape<ReadyOffer>;
      care_tickets: TableShape<CareTicket>;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      term_kind: TermKind;
      offer_service_kind: OfferServiceKind;
      offer_status: OfferStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}

export type TableName = keyof Database["public"]["Tables"];
export type TableRow<T extends TableName> = Database["public"]["Tables"][T]["Row"];
