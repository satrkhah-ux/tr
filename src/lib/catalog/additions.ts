/**
 * «إضافات الموظفين» (the owner, 2026-10-29): a salesperson adds a missing
 * hotel, room name, view, country or city in the middle of a programme, on
 * their own responsibility, and carries on. What they add is theirs at once,
 * goes to the data team to correct and approve, and only then shows for every
 * employee. Catalogue data is never an error that stops the agent
 * (hotel-data-request.ts).
 *
 * Pure: the spelling suggestion and who sees what. No database.
 */
import { closestName, normAr } from "./norm";

export const ADDITION_KINDS = ["country", "city", "hotel", "room", "view"] as const;
export type AdditionKind = (typeof ADDITION_KINDS)[number];
export type AdditionStatus = "pending" | "approved" | "rejected";

export type CatalogAddition = {
  id: string;
  kind: AdditionKind;
  /** what is used — the employee's confirmed text, later the data team's correction */
  name: string;
  status: AdditionStatus;
  created_by: string | null;
};

/** The longest added name kept — a name, not a note. */
export const ADDITION_NAME_MAX = 80;

export const cleanAdditionName = (value: string): string => value.replace(/\s+/g, " ").trim().slice(0, ADDITION_NAME_MAX).trim();

/**
 * A view reduced to what it looks at: «اطلاله بحر», «إطلالة على البحر» and
 * «منظر البحر» are all «بحر» — the words around it are how people type it,
 * not what it is.
 */
export function viewKey(value: string): string {
  return normAr(value)
    .split(" ")
    .filter((w) => !["اطلاله", "اطلالات", "منظر", "فيو", "view", "علي", "على", "مع"].includes(w))
    .map((w) => (w.length > 3 && w.startsWith("ال") ? w.slice(2) : w))
    .join(" ")
    .trim();
}

export type NameSuggestion =
  /** the typed text IS a known name (after folding): use it, nothing to ask */
  | { kind: "exact"; name: string }
  /** a known name close to the typed text: «هل تقصد …؟» */
  | { kind: "close"; name: string }
  /** nothing like it: add it as typed */
  | { kind: "new" };

/**
 * The spelling check the agent sees as they type: the known name the text
 * means, if any. Views compare what they look at (viewKey).
 */
export function suggestName(kind: AdditionKind, typed: string, known: string[]): NameSuggestion {
  const text = cleanAdditionName(typed);
  if (!text) return { kind: "new" };
  const key = kind === "view" ? viewKey : (s: string) => s;
  const hit = closestName(key(text), known, key, kind === "view" ? 0.65 : 0.75);
  if (!hit) return { kind: "new" };
  return { kind: hit.exact ? "exact" : "close", name: hit.row };
}

/**
 * Who sees an addition in their lists: the approved ones everyone, a pending
 * one only the employee who added it — every time, until the data team
 * decides. A rejected one nobody (the file that used it keeps its text).
 */
export function visibleAdditions(rows: CatalogAddition[], employeeId: string | null): CatalogAddition[] {
  return rows.filter((r) => r.status === "approved" || (r.status === "pending" && employeeId !== null && r.created_by === employeeId));
}

/** One name once, case- and spelling-folded — two employees adding «ستاندرد» is one entry. */
export function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.filter((n) => {
    const k = normAr(n);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
