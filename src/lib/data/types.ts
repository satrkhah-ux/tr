import type { Database } from "@/lib/types";
import type { TranslationKey } from "@/lib/i18n";

/** Any table the generic data engine is allowed to read/write. */
export type AllowedTable = keyof Database["public"]["Tables"];

/** A cell value we round-trip through the UI / Server Actions. */
export type DataValue = string | number | boolean | null;
export type DataRow = Record<string, DataValue>;

export type ColumnType = "text" | "number" | "currency" | "date" | "serial" | "status" | "phone" | "url";

export type ColumnDef = {
  key: string;
  labelKey: TranslationKey;
  type?: ColumnType;
  minWidth?: string;
  /** editable in the add/edit form (default true). */
  editable?: boolean;
  /** fixed options for a select input in the form. */
  options?: { value: string; label: string }[];
};

export type FilterOp = "eq" | "gte" | "lte" | "in" | "ilike";

export type Filter = {
  column: string;
  op: FilterOp;
  value: DataValue | DataValue[];
};

export type FilterSource = "countries" | "cities" | "employees" | "static";

export type FilterDef = {
  key: string;
  labelKey: TranslationKey;
  kind: "select" | "date";
  /** where the select options come from. */
  source?: FilterSource;
  /** static options when source is "static". */
  options?: { value: string; label: string }[];
  /** column(s) the filter applies to; defaults to `key`. */
  column?: string;
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
};

export type ListInput = {
  table: AllowedTable;
  page: number;
  pageSize: number;
  search?: string;
  searchColumns?: string[];
  filters?: Filter[];
  sort?: Sort;
};

export type ListResult =
  | { ok: true; rows: DataRow[]; count: number }
  | { ok: false; error: TranslationKey };

export type MutateResult =
  | { ok: true; row: DataRow }
  | { ok: false; error: TranslationKey };

export type DeleteResult = { ok: true } | { ok: false; error: TranslationKey };

export type FilterOption = { value: string; label: string };
export type FilterOptions = Record<FilterSource, FilterOption[]>;
