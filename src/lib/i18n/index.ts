import { en } from "./en";
import { ar } from "./ar";

/**
 * Traveliun i18n core.
 *
 * - `en` is the master key set; `TranslationKey = keyof typeof en`.
 * - `ar` (./ar.ts) is typed `Dictionary` = Record<TranslationKey, string>, so
 *   both dictionaries are guaranteed identical at TYPECHECK time: a missing key
 *   in `ar` OR an extra key not present in `en` is a type error.
 *   (ar.ts's import of `Dictionary` from here is type-only — erased at runtime,
 *   so there is no runtime circular dependency.)
 * - `translate()` never falls back across languages — a key always resolves in
 *   the requested language because completeness is enforced by the types.
 * - Values may contain `{param}` placeholders.
 */

export type Language = "ar" | "en";
export type TranslationKey = keyof typeof en;
export type Dictionary = Record<TranslationKey, string>;
export type TranslationParams = Record<string, string | number>;
export type Translator = (key: TranslationKey, params?: TranslationParams) => string;

export { en, ar };

const DICTIONARIES: Record<Language, Dictionary> = { en, ar };

export function translate(language: Language, key: TranslationKey, params?: TranslationParams): string {
  const raw = DICTIONARIES[language][key];
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}
