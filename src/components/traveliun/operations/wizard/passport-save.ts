import type { TranslationKey } from "@/lib/i18n";
import { upsertTraveler, uploadPassportScan } from "@/lib/data/operation-travelers";
import { trustedFields, type MrzPassport } from "@/lib/operations/mrz";
import { ageOn, kindForAge, sameName, takesPassportName } from "@/lib/operations/travelers";
import type { MatchRow } from "@/lib/operations/wizard/passports";

/**
 * `keep`: a typed name stayed — the passport's is offered, never forced (savedName).
 * `page`: the name as printed on the page and the Arabic one, when they differ from the MRZ's.
 */
export type PassportOutcome = {
  state: "saved" | "review" | "unread";
  error?: TranslationKey;
  keep?: { id: string; name: string; passport: string };
  page?: { id: string; printed?: string; arabic?: string };
};

/**
 * One passport onto the case — «الجوازات»'s rule, shared with «ارفع كل
 * الملفات»: a read passport is saved on `row` (its traveller, matchPassport's;
 * null adds one) with only what passed its check digits; an unread one is kept
 * on a traveller still without a passport (a new one if none), to type from.
 * Either way the picture is kept as that traveller's scan. `rows` is the case
 * as this run knows it and is updated in place; `taken` the travellers given a
 * passport in this run.
 */
export async function savePassport(input: {
  operationId: string;
  rows: MatchRow[];
  taken: Set<string>;
  row: MatchRow | null;
  read: MrzPassport | null;
  /** the file, as `file` */
  fd: FormData;
  today: string;
  travelStart: string | null;
}): Promise<PassportOutcome> {
  const { operationId, rows, taken, row, read, fd, today } = input;
  let rowId: string | null = null;
  let state: PassportOutcome["state"] = "unread";
  let error: TranslationKey | undefined;
  let keep: PassportOutcome["keep"];
  let page: PassportOutcome["page"];
  if (read) {
    const { values, missing } = trustedFields(read, today);
    const age = ageOn(values.birth_date || null, input.travelStart ?? today);
    // the passport's name replaces a planned or unnamed one; a typed one stays and is asked about
    const takes = takesPassportName(row) && Boolean(values.full_name);
    const name = takes ? values.full_name : (row?.display_name.trim() ?? "");
    const saved = await upsertTraveler({
      id: row?.id,
      operation_id: operationId,
      sort: row ? undefined : rows.length,
      // the row's name as it is — the server decides by the same rule (savedName)
      display_name: row?.display_name ?? "",
      passport_name: values.full_name,
      traveler_kind: age != null ? kindForAge(age) : (row?.traveler_kind ?? "adult"),
      // only what the read vouched for — an empty field never overwrites what is on file
      ...(values.birth_date ? { birth_date: values.birth_date } : {}),
      ...(values.nationality ? { nationality: values.nationality } : {}),
      ...(values.expiry ? { passport_expiry: values.expiry } : {}),
      ...(values.number && values.full_name ? { passport: { full_name: values.full_name, number: values.number, nationality: values.nationality } } : {}),
    });
    if (saved.ok) {
      rowId = saved.id;
      state = missing.length || read.failed.length ? "review" : "saved";
      if (!takes && values.full_name && !sameName(name, values.full_name)) keep = { id: saved.id, name, passport: values.full_name };
      // the MRZ's name stops at 39 characters — the page's whole one, and the Arabic, one press away
      const { printed_name, arabic_name } = read;
      const printed = printed_name && !sameName(printed_name, values.full_name) ? printed_name : undefined;
      const arabic = arabic_name && !sameName(arabic_name, name) ? arabic_name : undefined;
      if (printed || arabic) page = { id: saved.id, printed, arabic };
      const next: MatchRow = {
        id: saved.id,
        display_name: name,
        name_source: takes ? "passport" : (row?.name_source ?? null),
        traveler_kind: age != null ? kindForAge(age) : (row?.traveler_kind ?? "adult"),
        age: row?.age ?? null,
        birth_date: values.birth_date || row?.birth_date || null,
        nationality: values.nationality || row?.nationality || null,
        has_passport: Boolean(row?.has_passport || values.number),
      };
      if (row) rows[rows.indexOf(row)] = next;
      else rows.push(next);
    } else error = saved.error;
  }

  if (!rowId) {
    // unread: kept on the traveller picked for it, else one still without a passport (a new one if none), to type from
    const free = (!read && row) || rows.find((r) => !taken.has(r.id) && !r.has_passport);
    if (free) rowId = free.id;
    else {
      const added = await upsertTraveler({ operation_id: operationId, display_name: "", traveler_kind: "adult", sort: rows.length });
      if (added.ok) {
        rowId = added.id;
        rows.push({ id: added.id, display_name: "", name_source: "seed", traveler_kind: "adult", age: null, birth_date: null, nationality: null, has_passport: false });
      } else error = added.error;
    }
  }
  if (rowId) {
    taken.add(rowId);
    const scan = await uploadPassportScan(rowId, fd);
    if (!scan.ok && state !== "unread") state = "review";
    if (!scan.ok) error = scan.error;
  }
  return { state, error, keep, page };
}
