import { placeMention } from "./place-match";

type Place = { name: string; country: string };
type Message = { id: number; at: number; text: string; fromClient: boolean; isPrivate: boolean };
const normalize = (s: string) => s.normalize("NFKC").replace(/[أإآ]/g, "ا").replace(/[ى]/g, "ي").replace(/[\u064b-\u065f\u0670ـ]/g, "").toLowerCase();
const originQuestion = /(?:مدين[ةه]|مكان|دول[ةه])\s*(?:ال)?(?:اقلاع|مغادر[ةه]|انطلاق)|(?:من وين|من اين|مدينتك|الجنسي[ةه]|مكان التبصيم)|departure|departing from/i;
const destinationQuestion = /(?:حدد|ما|ايش|وين|اي|ماهي|ما هي).{0,16}(?:وجه|دول|سفر)|(?:وين|اين).{0,12}(?:تسافر|تروح)|destination|where to/i;

/**
 * Read the visit chronologically. Staff text may identify a question, never
 * supply a place. A later departure answer cannot replace a requested trip.
 * Ambiguous alternatives stay empty instead of choosing a dictionary entry.
 */
export function inferConversationDestination(messages: Message[], places: Place[]): { destination: string | null; evidenceId: number | null; ambiguous: boolean } {
  let destination: string | null = null;
  let evidenceId: number | null = null;
  let ambiguous = false;
  let question: "origin" | "destination" | null = null;
  const aliases: [RegExp, string[]][] = [
    [/امري|متحده الامري|متحدة الامري/, ["امريكا", "أمريكا", "الولايات المتحدة"]],
    [/اندون/, ["اندنوسيا", "اندونسيا", "إندونيسيا"]],
    [/اذربيجان/, ["اذربيجان", "اذربيحان"]],
    [/بريطانيا|المملكه المتحده|المملكة المتحدة/, ["انجلترا", "إنجلترا", "بريطانيا"]],
  ];
  const expanded = [...places];
  for (const [pattern, names] of aliases) {
    const canonical = places.find((p) => p.name === p.country && pattern.test(normalize(p.name)));
    if (canonical) for (const name of names) if (!expanded.some((p) => normalize(p.name) === normalize(name))) expanded.push({ name, country: canonical.country });
  }
  const sorted = expanded.sort((a, b) => b.name.length - a.name.length);
  for (const message of [...messages].sort((a, b) => a.at - b.at || a.id - b.id)) {
    if (message.isPrivate) continue;
    const text = normalize(message.text);
    if (!message.fromClient) {
      if (originQuestion.test(text)) question = "origin";
      else if (destinationQuestion.test(text)) question = "destination";
      continue;
    }
    const candidates: { place: Place; explicit: boolean }[] = [];
    for (const place of sorted) {
      const mention = placeMention(text, place.name);
      if (!mention) continue;
      const name = normalize(place.name);
      const index = mention.index;
      const before = text.slice(Math.max(0, index - 55), index);
      const clause = before.split(/[،,؛;!?\n]/).at(-1) ?? "";
      const after = text.slice(index + mention.length, index + mention.length + 24);
      const excluded = /(?:ما ابي|ماابي|لا اريد|مو|مش|ليس|بدون|الغاء|بدل)\s*(?:الذهاب\s*)?(?:الى\s*)?$/.test(clause);
      const origin = /(?:من|مقيم|ساكن|اقلاع من|مغادرة من|انطلاق من|from)\s*(?:(?:هنا\s*)?في\s*)?$/.test(clause)
        || /(?:مقيم|ساكن)\s*(?:هنا\s*)?(?:ب|في)?\s*$/.test(clause)
        || /(?:مدين[ةه]|دول[ةه])?\s*(?:الاقلاع|المغادر[ةه]|الانطلاق)\s*[:：]?\s*$/.test(clause)
        || /^\s*(?:هي\s*)?(?:مدين[ةه]\s*)?(?:الاقلاع|المغادر[ةه])/.test(after);
      const explicit = mention.directed || /(?:الى|ل|وجهتي|الوجه[ةه]|ابي|ابغى|اريد|نبي|رحل[ةه]|بكج|برنامج|زيارة|تاشيرة|تاشيره|فيزا|اسافر|نسافر|to|destination)\s*[:：]?\s*$/.test(clause);
      if (excluded) {
        if (destination === place.name) { destination = null; evidenceId = message.id; ambiguous = true; }
        continue;
      }
      if (origin || (question === "origin" && !explicit)) continue;
      // A bare later place is not proof the client changed their destination.
      if (destination && !explicit && question !== "destination") continue;
      if (!candidates.some((c) => normalize(c.place.name).includes(name))) candidates.push({ place, explicit });
    }
    if (!candidates.length) continue;
    const countries = new Set(candidates.map((c) => c.place.country || c.place.name));
    if (countries.size > 1) {
      destination = null;
      evidenceId = message.id;
      ambiguous = true;
    } else {
      const chosen = candidates[0].place;
      destination = places.some((p) => p.name === chosen.name) ? chosen.name : chosen.country;
      evidenceId = message.id;
      ambiguous = false;
    }
    question = null;
  }
  return { destination, evidenceId, ambiguous };
}
