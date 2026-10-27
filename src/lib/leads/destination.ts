import { placeMention } from "./place-match";
import { requestText } from "./request-text";
import { withCountryNames } from "./country-names";

type Place = { name: string; country: string; aliases?: string[] };
type Message = { id: number; at: number; text: string; fromClient: boolean; isPrivate: boolean };
const normalize = (s: string) => s.normalize("NFKC").replace(/[أإآ]/g, "ا").replace(/[\u064b-\u065f\u0670ـ]/g, "").toLowerCase();
const originQuestion = /(?:مدين[ةه]|مكان|دول[ةه])\s*(?:ال)?(?:اقلاع|مغادر[ةه]|انطلاق|اقام[ةه])|(?:من وين|من اين|مدينتك|الجنسي[ةه]|تبصيم|بصم[ةه]|مكان الموعد|مكان المقابل[ةه])|departure|departing from/i;
const destinationQuestion = /(?:^|[^\p{L}])(?:حدد|اختر|اي|ماهي|ما هي|ما|ايش)\s+(?:هي\s+)?(?:ال)?(?:وجه[ةهتك]|دول[ةه])|(?:دول[ةه]|وجه[ةه]).{0,12}(?:تريد|تبي|تسافر|السفر)|(?:^|[^\p{L}])(?:وين|اين)\s+.{0,12}(?:تسافر|تروح)|\b(?:destination|where to)\b/iu;

/**
 * Read the visit chronologically. Staff text may identify a question, never
 * supply a place. A later departure answer cannot replace a requested trip.
 * Ambiguous alternatives stay empty instead of choosing a dictionary entry.
 */
export function inferConversationDestination(messages: Message[], places: Place[], since = 0): { destination: string | null; evidenceId: number | null; ambiguous: boolean } {
  places = withCountryNames(places);
  let destination: string | null = null;
  let evidenceId: number | null = null;
  let ambiguous = false;
  let question: "origin" | "destination" | null = null;
  let evidenceAt = 0;
  let visaDestination = false;
  let lastClientText = "";
  const aliases: [RegExp, string[]][] = [
    [/^الولايات المتحد[ةه](?: الامريكي[ةه])?$|^امريكا$/, ["امريكا", "أمريكا", "الامريكية", "الولايات المتحدة", "الولايات المتحدة الأمريكية", "USA", "United States", "America"]],
    [/اندون/, ["اندنوسيا", "اندونسيا", "إندونيسيا"]],
    [/اذربيجان/, ["اذربيجان", "اذربيحان", "ازربيجان"]],
    [/قيرغيزستان|قرغيزستان/, ["قركزستان", "قيرغيزستان", "قرغيزستان"]],
    [/الدنمارك/, ["الدانمرك"]],
    [/بريطانيا|المملكه المتحده|المملكة المتحدة/, ["انجلترا", "إنجلترا", "بريطانيا"]],
    [/اسبانيا/, ["الاسبانية", "Spain"]],
    [/اندون/, ["اندونيسيا", "اندنيسيا", "Indonesia"]],
    [/تايلاند/, ["تايلند", "تايلاند", "Thailand"]],
    [/مالديف/, ["المالديف", "مالديف", "Maldives"]],
    [/فيتنام/, ["فيتنام", "فيت نام", "Vietnam"]],
    [/جورجيا/, ["جورجيا", "Georgia"]],
    [/تركيا/, ["تركيا", "تركية", "Turkey", "Türkiye"]],
  ];
  const expanded = [...places];
  const canonicalNames = new Map<string, string>();
  const jakarta = places.find(p => normalize(p.name) === "جاكرتا");
  if (jakarta) for (const name of ["جاكرتاء", "جاكارتا"]) {
    expanded.push({ name, country: jakarta.country });
    canonicalNames.set(name, jakarta.name);
  }
  for (const place of places) for (const name of place.aliases ?? []) {
    expanded.push({ name, country: place.country });
    canonicalNames.set(normalize(name), place.name);
  }
  for (const [pattern, names] of aliases) {
    const canonical = places.find((p) => p.name === p.country && pattern.test(normalize(p.name)));
    if (canonical) for (const name of names) if (!expanded.some((p) => normalize(p.name) === normalize(name))) expanded.push({ name, country: canonical.country });
  }
  const sorted = expanded.sort((a, b) => b.name.length - a.name.length);
  for (const message of [...messages].sort((a, b) => a.at - b.at || a.id - b.id)) {
    if (message.isPrivate) continue;
    const text = normalize(requestText(message.text));
    if (!message.fromClient) {
      // A flight timetable or an explanation about nationality is not a question.
      const asking = /[؟?]|(?:حدد|اذكر|ارسل|زود|احتاج|نحتاج|من وين|من اين)/.test(text)
        || (text.length < 120 && !/لان|بسبب|نسب[ةه]|سعر|\d\s*[:：]\s*\d/.test(text));
      if (asking && originQuestion.test(text)) question = "origin";
      else if (destination && /مدين[ةه]/.test(text) && text.length < 80 && /طيران|اقلاع|مطار|تذاكر/.test(lastClientText)) question = "origin";
      else if (destinationQuestion.test(text)) question = "destination";
      continue;
    }
    lastClientText = text;
    const candidates: { place: Place; explicit: boolean; index: number }[] = [];
    for (const place of sorted) {
      const mention = placeMention(text, place.name);
      if (!mention) continue;
      const name = normalize(place.name);
      const index = mention.index;
      const before = text.slice(Math.max(0, index - 55), index);
      const clause = before.split(/[،,؛;!?\n]/).at(-1) ?? "";
      const after = text.slice(index + mention.length, index + mention.length + 24);
      const attachedIn = text[index] === "ب" && !name.startsWith("ب");
      // A business address in an advert/contact greeting is not a trip request.
      const businessLocation = /(?:مكتب|شرك[ةه]|فرع|مقر|عنوان).{0,40}(?:في\s*|ب)$/.test(clause)
        || (attachedIn && /(?:مكتب|شرك[ةه]|فرع|مقر|عنوان).{0,40}$/.test(clause));
      const excluded = /(?:ما ابي|ماابي|لا اريد|مو|مش|ليس|بدون|الغاء|بدل)\s*(?:الذهاب\s*)?(?:الى\s*)?$/.test(clause);
      const appointmentLocation = /(?:موعد|مواعيد|ميعاد|معاد|تبصيم|بصم[ةه]|مقابل[ةه]|سفار[ةه]|قنصلي[ةه]).{0,35}(?:في\s*|ب)$/.test(clause)
        || (attachedIn && /(?:موعد|مواعيد|ميعاد|معاد|تبصيم|بصم[ةه]|مقابل[ةه]|سفار[ةه]|قنصلي[ةه]).{0,35}$/.test(clause));
      const origin = /(?:من|مقيم|ساكن|اقلاع من|مغادرة من|انطلاق من|from)\s*(?:(?:هنا\s*)?في\s*)?(?:مطار\s*)?$/.test(clause)
        || /(?:مقيم|ساكن)\s*(?:هنا\s*)?(?:ب|في)?\s*$/.test(clause)
        || /(?:مدين[ةه]|دول[ةه])?\s*(?:الاقلاع|المغادر[ةه]|الانطلاق)\s*[:：]?\s*$/.test(clause)
        || /(?:اقيم|سكني|اقامتي|مكاني|جنسيتي|الجنسية|انا موجود)\s*(?:في|ب)?\s*[:：]?\s*$/.test(clause)
        || /^\s*(?:هي\s*)?(?:مدين[ةه]\s*)?(?:الاقلاع|المغادر[ةه])/.test(after);
      const explicit = mention.directed || /(?:الى|ل|وجهتي|الوجه[ةه]|ابي|ابغى|اريد|نبي|رحل[ةه]|بكج|برنامج|فندق|فنادق|زيارة|تاشيرة|تاشيره|فيزا|لفيزا|اسافر|نسافر|ناوي|to|destination)\s*[:：]?\s*$/.test(clause);
      if (name === "مالي" && !explicit && text.trim() !== name && question !== "destination") continue;
      const changeRequested = /(?:ابي|ابغى|اريد|نبي|نبغى|عايز|عاوز|محتاج|احتاج|بدي|ودي|حاب|شوف|بدل|غيرت|خلها|غيرها|وجهتي|الوجه[ةه]).{0,45}$/.test(clause);
      if (excluded) {
        if (destination === place.name) { destination = null; evidenceId = message.id; ambiguous = true; }
        continue;
      }
      const destinationOverride = mention.directed || /(?:الى|وجهتي|الوجه[ةه]|رحل[ةه]|بكج|تاشير[ةه]|فيز[اةه]|اسافر|نسافر|الوصول)\s*[:：]?\s*$/.test(clause);
      const incidental = /(?:لان|بسبب|عشان)\s*$/.test(clause) || /^\s*(?:حظرت|منعت|قررت)/.test(after)
        || (/(?:خطوط|الخطوط).{0,30}$/.test(clause) && !destinationOverride);
      if (businessLocation || appointmentLocation || incidental || origin || (question === "origin" && !destinationOverride)) continue;
      // Onward travel explains a visa request; it does not change its country.
      if (visaDestination && /(?:لان|عشان|ترانزيت|عبور|من المطار|دراس[ةه])/.test(text)
        && !/(?:بدل|غيرت|خلها|غيرها)/.test(text)
        && !/(?:تاشير|فيزا)\s*\S*\s*$/.test(clause)) continue;
      // A bare later place is not proof the client changed their destination.
      if (destination && !changeRequested && !/^او\s/.test(text) && question !== "destination" && !(message.at >= since && evidenceAt < since)) continue;
      if (!candidates.some((c) => normalize(c.place.name).includes(name))) candidates.push({ place, explicit, index });
    }
    if (!candidates.length) continue;
    // “أو تايلاند” continues an alternative from the preceding message.
    if (destination && /^(?:او|كمان)\s/.test(text) && candidates.some(c => c.place.country !== (places.find(p => p.name === destination)?.country ?? destination))) {
      destination = null; evidenceId = message.id; evidenceAt = message.at; ambiguous = true; question = null; continue;
    }
    const countries = new Set(candidates.map((c) => c.place.country || c.place.name));
    if (countries.size > 1) {
      destination = null;
      evidenceId = message.id;
      evidenceAt = message.at;
      ambiguous = true;
    } else {
      const chosen = candidates.sort((a,b) => Number(b.explicit)-Number(a.explicit) || a.index-b.index)[0].place;
      destination = canonicalNames.get(normalize(chosen.name)) ?? (places.some((p) => p.name === chosen.name) ? chosen.name : chosen.country);
      evidenceId = message.id;
      evidenceAt = message.at;
      ambiguous = false;
      visaDestination = /تاشير|تئشير|فيزا|فيزه|شنغن|\b(?:visa|bls|vfs|tls)\b/.test(text);
    }
    question = null;
  }
  return { destination, evidenceId, ambiguous };
}
