/**
 * The traveler shapes, and the wall between them.
 *
 * The pricing DTO next door uses `OmitInternal` — a DENYLIST keyed on a union of
 * field names, carrying an explicit warning that a forgotten key ships to
 * clients silently. That is a defensible trade for money, where the unsafe set
 * is small and known.
 *
 * It is the wrong shape here and the risk is inverted: for identity data the
 * SAFE set is small and closed, and everything else — the ciphertext, the object
 * path, anything a future migration adds — is unsafe by default. So this is an
 * allowlist built with `Pick`, and the construction is field-by-field with no
 * spread, so a new column on the row cannot ride along into a list.
 *
 * Pure module: no crypto, no supabase, no server-only import. The decrypted
 * shape is produced ONLY by the server action, never here.
 */

export type TravelerKind = "adult" | "child" | "infant";

/** The DB row. SERVER ONLY — never returned from a server action. */
export type TravelerRow = {
  id: string;
  operation_id: string;
  traveler_kind: TravelerKind;
  sort: number;
  display_name: string;
  /** AES-256-GCM blob of {full_name, number, nationality}. */
  passport_encrypted: string | null;
  passport_expiry: string | null;
  /** object path in the private `passports` bucket. */
  passport_image_path: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * The ONLY traveler shape that may reach the browser in a list.
 *
 * `passport_expiry` is deliberately included: the «جواز على وشك الانتهاء» signal
 * is the reason ops staff open this screen, and a bare date carrying no name and
 * no number identifies nobody. The two booleans replace the sensitive fields
 * with the only fact the UI needs about them — whether they exist.
 */
export type TravelerListItem = Pick<
  TravelerRow,
  "id" | "traveler_kind" | "sort" | "display_name" | "passport_expiry"
> & {
  has_passport: boolean;
  has_scan: boolean;
};

/** The decrypted identity. Returned by ONE server action, never in a list. */
export type PassportView = {
  full_name: string;
  number: string;
  nationality: string;
};

/**
 * What the caller gets when asking for a passport.
 *
 * `decryptJson` returns null for a missing key AND for a tampered blob, which
 * makes a configuration error look exactly like "this traveler has no passport
 * on file". That distinction matters: one is a blank field, the other is an
 * incident. The three states keep them apart so the UI can say so.
 */
export type PassportRead =
  | { state: "none" }
  | { state: "ok"; passport: PassportView }
  | { state: "unavailable"; reason: "vault_unconfigured" | "undecryptable" };

/** Field-by-field on purpose — a spread would leak the next column added. */
export function toTravelerListItem(row: TravelerRow): TravelerListItem {
  return {
    id: row.id,
    traveler_kind: row.traveler_kind,
    sort: row.sort,
    display_name: row.display_name,
    passport_expiry: row.passport_expiry,
    has_passport: Boolean(row.passport_encrypted),
    has_scan: Boolean(row.passport_image_path),
  };
}

/**
 * Is this passport within `months` of expiring on `today`?
 *
 * Pure and clock-injected. String comparison only, matching the house rule used
 * by both existing rate-expiry gates. JS month overflow (31 Aug + 6 months →
 * 3 Mar) makes the check stricter by a day or two, which is the safe direction
 * for a document an airline can refuse at the gate.
 */
export function passportExpiringWithin(expiry: string | null, today: string, months = 6): boolean {
  if (!expiry) return false;
  const now = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(now.getTime())) return false;
  const threshold = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, now.getUTCDate()),
  )
    .toISOString()
    .slice(0, 10);
  return expiry <= threshold;
}

// ---------- compile-time proof (the build itself is the guarantee) ----------
type Has<T, K extends PropertyKey> = K extends keyof T ? true : false;
type ExpectFalse<T extends false> = T;
type ExpectTrue<T extends true> = T;

// If any of these keys existed on the list item, `Has<…>` would be `true` and
// `ExpectFalse<true>` would be a type error.
type _NoCipher = ExpectFalse<Has<TravelerListItem, "passport_encrypted">>;
type _NoScanPath = ExpectFalse<Has<TravelerListItem, "passport_image_path">>;
type _NoNumber = ExpectFalse<Has<TravelerListItem, "number">>;
type _NoFullName = ExpectFalse<Has<TravelerListItem, "full_name">>;
type _NoNationality = ExpectFalse<Has<TravelerListItem, "nationality">>;
// …and the expiry MUST stay, because the expiring-soon signal depends on it.
type _HasExpiry = ExpectTrue<Has<TravelerListItem, "passport_expiry">>;

/** Exported so the proofs are referenced and no unused-type lint fires. */
export type _TravelerLeakProof = [
  _NoCipher,
  _NoScanPath,
  _NoNumber,
  _NoFullName,
  _NoNationality,
  _HasExpiry,
];
