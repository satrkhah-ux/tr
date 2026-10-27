import type { Database } from "@/lib/types";
import type { TranslationKey } from "@/lib/i18n";

/** Any table the generic data engine is allowed to read/write. */
export type AllowedTable = keyof Database["public"]["Tables"];

/** A cell value we round-trip through the UI / Server Actions. */
export type DataValue = string | number | boolean | null;
export type DataRow = Record<string, DataValue>;

/** `logo` renders the value as an image path inside a public storage bucket. */
export type ColumnType = "text" | "number" | "currency" | "date" | "serial" | "status" | "phone" | "url" | "logo";

export type ColumnDef = {
  key: string;
  labelKey: TranslationKey;
  type?: ColumnType;
  minWidth?: string;
  /** editable in the add/edit form (default true). */
  editable?: boolean;
  /** fixed options for a select input in the form. */
  options?: FilterOption[];
  /**
   * An id column shown by its name and edited as a select of that list
   * (cities.country_id → «ماليزيا»), from the same options the filters use.
   */
  source?: Exclude<FilterSource, "static">;
  /** the value is a city's / country's id: shown by name, picked from a searchable list. */
  ref?: "cities" | "countries";
  /** long text kept line by line: a wide box in the form, shown with its line breaks. */
  multiline?: boolean;
};

export type FilterOp = "eq" | "gte" | "lte" | "in" | "ilike";

export type Filter = {
  column: string;
  op: FilterOp;
  value: DataValue | DataValue[];
};

export type FilterSource = "countries" | "cities" | "employees" | "suppliers" | "cars" | "places" | "static";

export type FilterDef = {
  key: string;
  labelKey: TranslationKey;
  kind: "select" | "date";
  /** where the select options come from. */
  source?: FilterSource;
  /** static options when source is "static". A value of FILTER_NULL / FILTER_NOT_NULL tests for an empty column. */
  options?: FilterOption[];
  /** column(s) the filter applies to; defaults to `key`. */
  column?: string;
  /** a country filter applied through the row's city (city_id in that country's cities). */
  viaCity?: boolean;
  /** only the values the table holds, each with its count (present-values.ts); a city's follow the chosen country */
  present?: boolean;
};

export type Sort = { column: string; ascending: boolean };

export type TableConfig = {
  route: string;
  table: AllowedTable;
  titleKey: TranslationKey;
  columns: ColumnDef[];
  /** text columns searched by the toolbar search box. */
  searchable: string[];
  filters?: FilterDef[];
  defaultSort?: Sort;
  /** renders the offers confirmed/unconfirmed toggle. */
  isOffers?: boolean;
  /** values forced on every list query + insert (e.g. terms.kind = "include"). */
  fixedValues?: DataRow;
  /**
   * Related rows embedded in the list query (PostgREST), read by dotted column
   * keys: `hotels(arabic_name)` → column `hotels.arabic_name`. Such columns are
   * display-only (`editable: false`).
   */
  select?: string;
};

export type ListInput = {
  table: AllowedTable;
  page: number;
  pageSize: number;
  search?: string;
  searchColumns?: string[];
  filters?: Filter[];
  sort?: Sort;
  /** TableConfig.select — embedded related rows. */
  select?: string;
  /** a data-quality issue (lib/data/quality.ts): list only the rows that have it, as 0071 ranks them */
  issue?: string;
};

/** Static filter values that test a column for empty / not empty (room types: «عامة» / «لفندق»). */
export const FILTER_NULL = "__null__";
export const FILTER_NOT_NULL = "__not_null__";

export type ListResult =
  | { ok: true; rows: DataRow[]; count: number }
  | { ok: false; error: TranslationKey };

export type MutateResult =
  | { ok: true; row: DataRow }
  | { ok: false; error: TranslationKey };

export type DeleteResult = { ok: true } | { ok: false; error: TranslationKey };

/** `labelKey`, when set, is translated in place of `label`; `parent`: a city's country id. */
export type FilterOption = { value: string; label: string; labelKey?: TranslationKey; parent?: string | null; currency?: string | null };
export type FilterOptions = Record<FilterSource, FilterOption[]>;
