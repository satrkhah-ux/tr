/**
 * The owner's room catalogue (src/lib/catalog/hotel-room-catalog.json, 2026-10-15):
 * one list of room types and categories for every hotel, entered in Arabic and
 * exported in the language of the stay's destination — the client programme in
 * Arabic, the voucher in the hotel country's language (English unless an Arab
 * country). The details the hotel confirms (view, beds, smoking, …) are added
 * by operations after confirmation and only then printed.
 *
 * Pure: no database. Ids are the file's stable ids; labels never become ids.
 */
import catalog from "./hotel-room-catalog.json";

export type RoomLocale = "ar" | "en";
export type LocaleChoice = RoomLocale | "auto";
export type CatalogItem = { id: string; label: Record<RoomLocale, string> };
export type CatalogKey = keyof typeof catalog.catalogs;

const list = (key: CatalogKey) => catalog.catalogs[key] as CatalogItem[];
export const ROOM_TYPES = list("room_types");
export const ROOM_CATEGORIES = list("room_categories");
export const SUITE_SUBTYPES = list("suite_subtypes");
export const BED_TYPES = list("bed_types");
export const ROOM_VIEWS = list("views");
export const ROOM_FEATURES = list("features");

const byId = (key: CatalogKey) => new Map(list(key).map((i) => [i.id, i]));
const INDEX = {
  room_types: byId("room_types"),
  room_categories: byId("room_categories"),
  suite_subtypes: byId("suite_subtypes"),
  bed_types: byId("bed_types"),
  views: byId("views"),
  features: byId("features"),
} as const;

export function catalogLabel(key: CatalogKey, id: string | null | undefined, locale: RoomLocale): string | null {
  return id ? (INDEX[key].get(id)?.label[locale] ?? null) : null;
}

export type BedStatus = "guaranteed" | "on_request" | "unspecified";
export type BedGroup = { id: string; beds: { bed_type_id: string; quantity: number }[] };
export type NameStatus = "missing" | "draft" | "verified";

/** A room as the catalogue describes it — the offer fills type/category, operations the rest. */
export type RoomSpec = {
  room_type_id: string | null;
  room_category_id?: string | null;
  suite_subtype_id?: string | null;
  bedroom_count?: number | null;
  bed_groups?: BedGroup[];
  selected_bed_group_id?: string | null;
  bed_configuration_status?: BedStatus;
  view_ids?: string[];
  feature_ids?: string[];
  max_guests?: number | null;
  max_adults?: number | null;
  max_children?: number | null;
  custom_room_name?: { ar: string | null; en: string | null };
  custom_name_status?: { ar: NameStatus; en: NameStatus };
};

const rules = catalog.room_name_export;
const SEP = rules.separator;

/** The bed segment: the chosen arrangement, else every alternative joined by «أو» / «OR», with its status. */
export function bedsText(spec: RoomSpec, locale: RoomLocale): string | null {
  const groups = (spec.bed_groups ?? []).filter((g) => g.beds.some((b) => b.quantity > 0));
  if (groups.length === 0) return null;
  const chosen = spec.selected_bed_group_id ? groups.filter((g) => g.id === spec.selected_bed_group_id) : groups;
  const shown = chosen.length ? chosen : groups;
  const group = (g: BedGroup) =>
    g.beds
      .filter((b) => b.quantity > 0)
      .map((b) => `${b.quantity} × ${catalogLabel("bed_types", b.bed_type_id, locale) ?? b.bed_type_id}`)
      .join(rules.list_separator[locale]);
  const status = rules.bed_status_suffix[spec.bed_configuration_status ?? "unspecified"][locale];
  return `${shown.map(group).join(rules.alternative_bed_group_separator[locale])} (${status})`;
}

/**
 * The room's name in `locale`. A hotel's own (custom) name wins when it is
 * verified in that language; a custom name missing in that language stops the
 * export (ROOM_NAME_TRANSLATION_REQUIRED) rather than falling back silently.
 * Otherwise: the type's label, then «الفئة: …», suite type, bedrooms, beds,
 * views, features — each only when filled.
 */
export function roomName(spec: RoomSpec, locale: RoomLocale): { name: string | null; error?: "ROOM_NAME_TRANSLATION_REQUIRED" } {
  const custom = spec.custom_room_name;
  if (custom && (custom.ar?.trim() || custom.en?.trim())) {
    const text = custom[locale]?.trim();
    if (!text || spec.custom_name_status?.[locale] !== "verified") return { name: null, error: "ROOM_NAME_TRANSLATION_REQUIRED" };
    return { name: text };
  }
  const base = catalogLabel("room_types", spec.room_type_id, locale);
  if (!base) return { name: null };
  const L = rules.field_labels[locale];
  const join = (key: CatalogKey, ids: string[] | undefined) =>
    (ids ?? []).map((id) => catalogLabel(key, id, locale)).filter(Boolean).join(rules.list_separator[locale]) || null;
  const segments: [string, string | null][] = [
    [L.category, catalogLabel("room_categories", spec.room_category_id, locale)],
    [L.suite_subtype, spec.room_type_id === "suite" ? catalogLabel("suite_subtypes", spec.suite_subtype_id, locale) : null],
    [L.bedroom_count, spec.bedroom_count && spec.bedroom_count > 0 ? String(spec.bedroom_count) : null],
    [L.beds, bedsText(spec, locale)],
    [L.views, join("views", spec.view_ids)],
    [L.features, join("features", spec.feature_ids)],
  ];
  return { name: [base, ...segments.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`)].join(SEP) };
}

// ---------- which language a stay is exported in ----------

const POLICY = catalog.destination_language_policy;
export const DESTINATION_LOCALES = POLICY.destination_country_overrides as Record<string, RoomLocale>;

/**
 * The file's precedence: the document's choice, then the stay's, then the
 * hotel's override, then the hotel COUNTRY's rule, then English. «auto», null
 * and blank are skipped. The country is the hotel's (Batumi = GE even when the
 * group lands in Trabzon), never the arrival airport's or the client's.
 */
export function exportLocale(input: {
  document?: LocaleChoice | null;
  stay?: LocaleChoice | null;
  hotelOverride?: LocaleChoice | null;
  countryCode?: string | null;
  overrides?: Record<string, RoomLocale>;
}): RoomLocale {
  for (const choice of [input.document, input.stay, input.hotelOverride]) if (choice === "ar" || choice === "en") return choice;
  const country = input.countryCode?.trim().toUpperCase();
  const rule = country ? (input.overrides ?? DESTINATION_LOCALES)[country] : undefined;
  return rule ?? (POLICY.default_export_locale as RoomLocale);
}

/** The hotel's name in `locale`, or the error that stops a final export when it has none. */
export function hotelNameFor(
  hotel: { ar: string | null; en: string | null },
  locale: RoomLocale,
): { name: string | null; error?: "HOTEL_NAME_TRANSLATION_REQUIRED" } {
  const text = hotel[locale]?.trim();
  // an «English» name with no Latin letter is an Arabic name typed in the wrong box
  if (!text || (locale === "en" && !/[A-Za-z]/.test(text))) return { name: null, error: "HOTEL_NAME_TRANSLATION_REQUIRED" };
  return { name: text };
}

// ---------- the file's validation rules ----------

export type RoomIssue =
  | "unknown_id"
  | "occupancy"
  | "bed_groups"
  | "smoking_both"
  | "view_conflict"
  | "suite_subtype"
  | "bedroom_count"
  | "double_twin";

export function roomIssues(spec: RoomSpec): RoomIssue[] {
  const out = new Set<RoomIssue>();
  const known = (key: CatalogKey, id: string | null | undefined) => !id || INDEX[key].has(id);
  if (
    !known("room_types", spec.room_type_id) ||
    !known("room_categories", spec.room_category_id) ||
    !known("suite_subtypes", spec.suite_subtype_id) ||
    (spec.view_ids ?? []).some((id) => !known("views", id)) ||
    (spec.feature_ids ?? []).some((id) => !known("features", id)) ||
    (spec.bed_groups ?? []).some((g) => g.beds.some((b) => !known("bed_types", b.bed_type_id)))
  ) {
    out.add("unknown_id");
  }
  const { max_guests: g, max_adults: a, max_children: c } = spec;
  if (g != null || a != null || c != null) {
    const ints = [g, a, c].every((n) => n == null || Number.isInteger(n));
    if (!ints || (g != null && g < 1) || (a != null && a < 0) || (c != null && c < 0)) out.add("occupancy");
    else if (g != null && ((a != null && a > g) || (c != null && c > g) || (a != null && c != null && g > a + c))) out.add("occupancy");
  }
  for (const group of spec.bed_groups ?? []) if (group.beds.some((b) => !Number.isInteger(b.quantity) || b.quantity < 1)) out.add("bed_groups");
  if (spec.selected_bed_group_id && !(spec.bed_groups ?? []).some((gr) => gr.id === spec.selected_bed_group_id)) out.add("bed_groups");
  const features = new Set(spec.feature_ids ?? []);
  if (features.has("smoking") && features.has("non_smoking")) out.add("smoking_both");
  const views = new Set(spec.view_ids ?? []);
  if ((views.has("no_view") && views.size > 1) || (views.has("sea") && views.has("partial_sea"))) out.add("view_conflict");
  if (spec.suite_subtype_id && spec.room_type_id !== "suite") out.add("suite_subtype");
  if (spec.bedroom_count != null && (!Number.isInteger(spec.bedroom_count) || spec.bedroom_count < 1)) out.add("bedroom_count");
  if (spec.bed_configuration_status === "guaranteed" && spec.selected_bed_group_id) {
    const beds = spec.bed_groups?.find((gr) => gr.id === spec.selected_bed_group_id)?.beds ?? [];
    const singles = beds.filter((b) => b.bed_type_id === "single").reduce((s, b) => s + b.quantity, 0);
    const bigs = beds.filter((b) => ["double", "queen", "king", "super_king"].includes(b.bed_type_id)).reduce((s, b) => s + b.quantity, 0);
    if ((spec.room_type_id === "twin" && singles < 2) || (spec.room_type_id === "double" && bigs < 1)) out.add("double_twin");
  }
  return [...out];
}

// ---------- old free-text names → the catalogue ----------

const TYPE_WORDS: [string, RegExp][] = [
  ["bed_in_dormitory", /bed in dorm|سرير في غرفة/i],
  ["dormitory", /dorm|جماعي/i],
  ["double_or_twin", /double\s*(or|\/)\s*twin|مزدوج[ةه]? أو/i],
  ["twin", /twin|سريرين|توين/i],
  ["quadruple", /quad|رباع/i],
  ["triple", /triple|ثلاث/i],
  ["single", /single|مفرد|سنجل/i],
  ["family", /family|عائل/i],
  ["suite", /suite|جناح|سويت/i],
  ["studio", /studio|استوديو|ستوديو/i],
  ["apartment", /apartment|شقة|شقه/i],
  ["double", /double|king|queen|مزدوج|دبل|كينج|كوين/i],
];
const CATEGORY_WORDS: [string, RegExp][] = [
  ["signature", /signature|سيغنتشر|سيجنتشر/i],
  ["club", /club|كلوب/i],
  ["executive", /executive|تنفيذ|اكزكتيف/i],
  ["premier", /premier\b|بريمير/i],
  ["premium", /premium|بريميوم/i],
  ["deluxe", /deluxe|ديلوكس|دلوكس/i],
  ["superior", /superior|سوبيري|سوبيرير/i],
  ["classic", /classic|كلاسيك/i],
  ["economy", /economy|اقتصاد/i],
  ["standard", /standard|ستاندر|عادي[ةه]?/i],
];

/**
 * A name typed before the catalogue («Deluxe King Room», «غرفة مزدوجة ديلوكس»)
 * read into a type and a category — so old drafts and offers still print and
 * price. Unread parts stay null; nothing is guessed beyond the words.
 */
export function classifyRoomName(name: string): { room_type_id: string | null; room_category_id: string | null } {
  const text = name.trim();
  const type = TYPE_WORDS.find(([, re]) => re.test(text))?.[0] ?? null;
  const category = CATEGORY_WORDS.find(([, re]) => re.test(text))?.[0] ?? null;
  return { room_type_id: type, room_category_id: category };
}
