/**
 * A flight ticket's text → the legs, the passengers and the booking reference.
 *
 * PURE (no server-only): the read action runs it on the server, the tests run it
 * on fixtures, and the editor uses `enrichTicket`/`sanitizeTicket` in the browser.
 *
 * Two readers, tried in order:
 *   1. GDS — an Amadeus or Sabre itinerary pasted from the terminal: one segment
 *      per line, «SV1020 Y 15NOV 7 RUHJED HK2 0830 1015». Exact and cheap.
 *   2. LABELLED — an airline e-ticket or a confirmation e-mail (Saudia, flynas,
 *      flyadeal…, Arabic or English). Every flight number opens a block; the
 *      block's airports, dates and times are read in the order they appear —
 *      departure is written before arrival on every ticket we have seen.
 *
 * What this cannot read stays EMPTY, never guessed: the employee confirms every
 * field before a card is drawn, and an empty box is noticed where a wrong time
 * would be sent to the client.
 */

export type LegOrder = "outbound" | "inbound" | "internal";

export type TicketLeg = {
  /** the carrier's name as printed on the card (filled from the airlines table). */
  airline: string;
  /** IATA designator, e.g. "SV" — also the key to the carrier's logo. */
  airline_iata: string;
  /** "SV1020" */
  flight_no: string;
  from_iata: string;
  from_name: string;
  to_iata: string;
  to_name: string;
  /** local wall-clock date/time at each airport: "YYYY-MM-DD" and "HH:mm". */
  dep_date: string;
  dep_time: string;
  arr_date: string;
  arr_time: string;
  cabin: string;
  baggage: string;
  leg_order: LegOrder | null;
};

export type ParsedTicket = { pnr: string; passengers: string[]; legs: TicketLeg[] };

/** The upload limit, checked in the browser for the message and on the server for real. */
export const MAX_TICKET_BYTES = 10 * 1024 * 1024;

export function emptyLeg(): TicketLeg {
  return {
    airline: "", airline_iata: "", flight_no: "",
    from_iata: "", from_name: "", to_iata: "", to_name: "",
    dep_date: "", dep_time: "", arr_date: "", arr_time: "",
    cabin: "", baggage: "", leg_order: null,
  };
}

// ---------------------------------------------------------------- text basics

/** Arabic-Indic digits, bidi marks and odd spaces — PDFs and WhatsApp carry all three. */
export function normalizeTicketText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[‎‏‪-‮⁦-⁩؜]/g, "")
    .replace(/[ \t]/g, " ")
    .replace(/\r\n?/g, "\n");
}

const MONTHS: Record<string, number> = {
  JANUARY: 1, JAN: 1, FEBRUARY: 2, FEB: 2, MARCH: 3, MAR: 3, APRIL: 4, APR: 4, MAY: 5, JUNE: 6, JUN: 6,
  JULY: 7, JUL: 7, AUGUST: 8, AUG: 8, SEPTEMBER: 9, SEPT: 9, SEP: 9, OCTOBER: 10, OCT: 10,
  NOVEMBER: 11, NOV: 11, DECEMBER: 12, DEC: 12,
  "يناير": 1, "فبراير": 2, "مارس": 3, "أبريل": 4, "ابريل": 4, "إبريل": 4, "مايو": 5, "يونيو": 6, "يونيه": 6,
  "يوليو": 7, "يوليه": 7, "أغسطس": 8, "اغسطس": 8, "سبتمبر": 9, "أكتوبر": 10, "اكتوبر": 10, "نوفمبر": 11, "ديسمبر": 12,
  "كانون الثاني": 1, "شباط": 2, "آذار": 3, "اذار": 3, "نيسان": 4, "أيار": 5, "ايار": 5, "حزيران": 6, "تموز": 7,
  "آب": 8, "أيلول": 9, "ايلول": 9, "تشرين الأول": 10, "تشرين الاول": 10, "تشرين الثاني": 11,
  "كانون الأول": 12, "كانون الاول": 12,
};
const MONTH_ALT = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .join("|");
const monthOf = (word: string): number => MONTHS[word.toUpperCase().replace(/\s+/g, " ")] ?? 0;

/** Three uppercase letters that are words or units on a ticket, never an airport here. */
const NOT_AIRPORT = new Set(
  ("THE AND FOR YOU ARE OUR NOT ALL ANY PER VIA NON YES ONE TWO OUT NEW WAY AIR FLY BAG " +
    "PNR REF TKT ETK PAX ADT CHD INF MRS MSS SAR USD EUR AED GBP KWD QAR BHD OMR EGP TRY KGS PCS " +
    "VAT TAX FEE NET MAX MIN GMT UTC AST ETA ETD SUN MON TUE WED THU FRI SAT " +
    "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC").split(" "),
);
/** Two-character tokens followed by digits that are not airlines. */
const NOT_CARRIER = new Set("NO OF TO AT ON IN BY OR KG PC HK ID PO IS IT UP AS AN BE DO GO ME MY SO US WE TE RP".split(" "));

// ---------------------------------------------------------------- dates & times

type DateParts = { y: number | null; m: number; d: number };
type Hit<T> = { index: number; end: number; value: T };

const fullYear = (s: string): number => (s.length === 2 ? 2000 + Number(s) : Number(s));

function validDate(p: DateParts): DateParts | null {
  return p.m >= 1 && p.m <= 12 && p.d >= 1 && p.d <= 31 ? p : null;
}

const DATE_READERS: { re: RegExp; read: (m: RegExpExecArray) => DateParts | null }[] = [
  // 2026-11-15
  { re: /(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/g, read: (m) => validDate({ y: +m[1], m: +m[2], d: +m[3] }) },
  // 15/11/2026, 15.11.26 — day first, as printed in the Gulf; a US-order date with a day >12 is swapped
  {
    re: /(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?![\d:])/g,
    read: (m) => {
      const a = +m[1];
      const b = +m[2];
      return validDate(b > 12 && a <= 12 ? { y: fullYear(m[3]), m: a, d: b } : { y: fullYear(m[3]), m: b, d: a });
    },
  },
  // 15NOV, 15NOV26, 15 Nov 2026, 15-Nov-2026, ١٥ نوفمبر ٢٠٢٦
  {
    re: new RegExp(`(?<![\\p{L}\\d])(\\d{1,2})(?:st|nd|rd|th)?[\\s-]*(${MONTH_ALT})\\.?(?![\\p{L}])(?:[\\s,-]*(\\d{4}|\\d{2})(?![\\d:]))?`, "giu"),
    read: (m) => validDate({ y: m[3] ? fullYear(m[3]) : null, m: monthOf(m[2]), d: +m[1] }),
  },
  // November 15, 2026
  {
    re: new RegExp(`(?<![\\p{L}])(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})(?!\\d)`, "giu"),
    read: (m) => validDate({ y: +m[3], m: monthOf(m[1]), d: +m[2] }),
  },
];

function findDates(line: string): Hit<DateParts>[] {
  const hits: Hit<DateParts>[] = [];
  for (const { re, read } of DATE_READERS) {
    re.lastIndex = 0;
    for (let m = re.exec(line); m; m = re.exec(line)) {
      const value = read(m);
      if (value) hits.push({ index: m.index, end: m.index + m[0].length, value });
    }
  }
  // overlapping readings of one date: keep the earliest, then the longest
  hits.sort((a, b) => a.index - b.index || b.end - a.end);
  const kept: Hit<DateParts>[] = [];
  for (const h of hits) if (!kept.length || h.index >= kept[kept.length - 1].end) kept.push(h);
  return kept;
}

type TimeParts = { time: string; plus: number };
const TIME_RE =
  /(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?::\d{2})?(?!\d)\s*(صباحاً|صباحا|مساءً|مساء|A\.M\.|P\.M\.|AM|PM|ص|م)?(?![\p{L}])(?:\s*\(?\+(\d)\)?)?/giu;

function findTimes(line: string): Hit<TimeParts>[] {
  const hits: Hit<TimeParts>[] = [];
  TIME_RE.lastIndex = 0;
  for (let m = TIME_RE.exec(line); m; m = TIME_RE.exec(line)) {
    let h = +m[1];
    const suffix = (m[3] ?? "").toUpperCase();
    const pm = suffix.startsWith("P") || suffix.startsWith("م");
    const am = suffix.startsWith("A") || suffix.startsWith("ص");
    if (pm && h < 12) h += 12;
    if (am && h === 12) h = 0;
    hits.push({ index: m.index, end: m.index + m[0].length, value: { time: `${pad(h)}:${m[2]}`, plus: m[4] ? +m[4] : 0 } });
  }
  return hits;
}

/** GDS clock: "0830", "830A", "1015P", "1200N" (noon), "1200M" (midnight). */
function gdsTime(raw: string): string {
  const suffix = /[APNM]$/.test(raw) ? raw.slice(-1) : "";
  const n = Number(suffix ? raw.slice(0, -1) : raw);
  let h = Math.floor(n / 100);
  const min = n % 100;
  if (suffix === "P" && h < 12) h += 12;
  if ((suffix === "A" || suffix === "M") && h === 12) h = 0;
  if (h > 23 || min > 59) return "";
  return `${pad(h)}:${pad(min)}`;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const DAY_MS = 86_400_000;

/** A date printed without a year belongs to the next occurrence after the ticket was issued. */
function withYear(p: DateParts, ref: Date): { date: string; guessed: boolean } {
  if (p.y) return { date: iso(p.y, p.m, p.d), guessed: false };
  let y = ref.getUTCFullYear();
  if (Date.UTC(y, p.m - 1, p.d) < ref.getTime() - 30 * DAY_MS) y += 1;
  return { date: iso(y, p.m, p.d), guessed: true };
}

function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}
const addYear = (date: string) => `${Number(date.slice(0, 4)) + 1}${date.slice(4)}`;

// ---------------------------------------------------------------- line roles

/** Lines whose dates are not flight dates: issue, birth, expiry. */
const NOT_FLIGHT_DATE =
  /ISSUE|BOOKING DATE|BOOKED ON|PURCHASE|PRINTED|BIRTH|\bDOB\b|EXPIR|VALID|^\s*RP\/|^\s*TK\s|الإصدار|الاصدار|تاريخ الحجز|الميلاد|الانتهاء|صالح/iu;
/** …and of those, the ones that date the ticket — the reference for a yearless «15NOV». */
const ISSUE_DATE = /ISSUE|BOOKING DATE|BOOKED ON|^\s*RP\/|الإصدار|الاصدار|تاريخ الحجز/iu;
/** Lines whose clock times are not departure or arrival. */
const NOT_FLIGHT_TIME = /DURATION|FLYING TIME|TRAVEL TIME|BOARDING|CHECK-?IN|GATE CLOS|مدة|المدة|الصعود|إغلاق|اغلاق/iu;
const MONTH_AHEAD = new RegExp(`^[\\s-]*(?:${MONTH_ALT})(?![\\p{L}])`, "iu");

/** The first flight number on a line: "SV 1020", "XY213", "F3-141". */
function flightNoIn(line: string): { carrier: string; number: string } | null {
  const re = /(?<![A-Za-z0-9])([A-Z][A-Z0-9]|[0-9][A-Z])\s?-?\s?(\d{2,4})(?![\d:])/g;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (NOT_CARRIER.has(m[1])) continue;
    // «T1 20 Nov» is a terminal and a day, not a flight
    if (MONTH_AHEAD.test(line.slice(m.index + m[0].length))) continue;
    return { carrier: m[1], number: m[2].replace(/^0+(?=\d)/, "") };
  }
  return null;
}

// ---------------------------------------------------------------- cabin & baggage

const CABIN_LABEL = /(?:CABIN|CLASS|الدرجة|درجة السفر|درجة الحجز)\s*[:：-]\s*([^\n|]{2,40})/iu;

function cabinFromWords(text: string): string {
  if (/PREMIUM\s+ECONOMY|السياحية المميزة|الاقتصادية المميزة|اقتصادية مميزة/iu.test(text)) return "اقتصادية مميزة";
  if (/BUSINESS|رجال الأعمال|رجال الاعمال|درجة الأعمال|درجة الاعمال/iu.test(text)) return "رجال الأعمال";
  if (/ECONOMY|\bGUEST CLASS|السياحية|الاقتصادية|اقتصادية|سياحية|الضيافة/iu.test(text)) return "اقتصادية";
  if (/FIRST\s+CLASS|الدرجة الأولى|الدرجة الاولى|درجة أولى|درجة اولى/iu.test(text)) return "الأولى";
  return "";
}

function cabinIn(text: string): string {
  const labelled = text.match(CABIN_LABEL);
  if (labelled) {
    const value = labelled[1];
    if (/^\s*FIRST|^\s*الأولى|^\s*الاولى/iu.test(value)) return "الأولى";
    const found = cabinFromWords(value);
    if (found) return found;
  }
  return cabinFromWords(text);
}

/** A GDS booking class, read the common way — the employee corrects an airline that differs. */
function cabinFromClass(letter: string): string {
  if ("FAP".includes(letter)) return "الأولى";
  if ("JCDIZR".includes(letter)) return "رجال الأعمال";
  if (letter === "W") return "اقتصادية مميزة";
  return "اقتصادية";
}

function baggageIn(text: string): string {
  const kilos = [...text.matchAll(/(?<![A-Za-z0-9])(\d{1,2})\s?(?:KGS?|KILOS?|K|كجم|كغم|كغ|كيلو(?:غرام|جرام)?)(?![\p{L}])/giu)].map((m) => +m[1]);
  // the checked allowance is the larger figure: «23KG checked, 7KG cabin»
  if (kilos.length) {
    const max = Math.max(...kilos);
    return max === 0 ? "بدون أمتعة مسجّلة" : `${max} كجم`;
  }
  const pieces = text.match(/(?<![A-Za-z0-9])(\d)\s?(?:PCS?|PIECES?|قطعة|قطع|حقيبة|حقائب)(?![\p{L}])/iu);
  if (!pieces) return "";
  const n = +pieces[1];
  return n === 0 ? "بدون أمتعة مسجّلة" : n === 1 ? "قطعة واحدة" : n === 2 ? "قطعتان" : `${n} قطع`;
}

// ---------------------------------------------------------------- passengers & PNR

const TITLE = "MSTR|MISS|MRS|MR|MS|DR|CHD|INF|السيدة|السيد|الآنسة|الانسة|الطفلة|الطفل|الرضيع";
const TITLE_START = new RegExp(`^(?:${TITLE})\\.?(?![\\p{L}])\\s*\\/?\\s*`, "iu");
const TITLE_END = new RegExp(`\\s+(?:${TITLE})\\.?$`, "iu");

/** «TESTUSER/FAHAD MR» → «FAHAD TESTUSER»; «السيدة/ ريم» → «ريم». */
function cleanName(raw: string): string {
  let name = raw.trim().replace(/\s+/g, " ").replace(TITLE_START, "").replace(TITLE_END, "").trim();
  const slash = name.match(/^([^/]+)\/([^/]+)$/);
  if (slash) name = `${slash[2].trim().replace(TITLE_END, "")} ${slash[1].trim()}`;
  name = name.replace(/[.,:;|]+$/, "").trim();
  return /\p{L}{2}/u.test(name) && name.length <= 80 ? name : "";
}

const PASSENGER_LABEL =
  /(?:PASSENGER(?:\s+NAME)?|NAME OF PASSENGER|TRAVELL?ER(?:\s+NAME)?|GUEST(?:\s+NAME)?|اسم المسافر|اسم الراكب|المسافر|الراكب)\s*(?:\(\d+\))?(?:\s*[:：]|\s+-)\s*(.+)$/iu;
const PASSENGER_HEADER =
  /^\s*(?:PASSENGERS?|PASSENGER NAMES?|TRAVELL?ERS?|GUESTS?|المسافرون|المسافرين|الركاب|أسماء المسافرين|اسماء المسافرين)\s*[:：]?\s*$/iu;
const LISTED_NAME = new RegExp(`^\\s*(?:(\\d{1,2})\\s*[.)-]\\s*)?((?:${TITLE})\\.?(?![\\p{L}]))?\\s*\\/?\\s*(\\p{L}.*)$`, "iu");
/** GDS name element: «1.TESTOVA/LAYLA MRS», Sabre «1.2TESTER/NOURA MS». */
const GDS_NAME = /(?:^|\s)\d{1,2}\.(?:\d{1,2})?([A-Z][A-Z' -]*?)\/([A-Z][A-Z' -]*?)(?:\s+(?:MSTR|MISS|MRS|MR|MS|DR|CHD|INF))?(?=\s{2,}|\s+\d{1,2}\.|\s*$)/gm;

function findPassengers(lines: string[]): string[] {
  const out: string[] = [];
  const add = (raw: string) => {
    const name = cleanName(raw);
    if (name && !out.some((n) => n.toUpperCase() === name.toUpperCase())) out.push(name);
  };
  for (const line of lines) {
    for (const m of line.matchAll(GDS_NAME)) if (m[2].trim().length >= 2) add(`${m[1]}/${m[2]}`);
  }
  for (let i = 0; i < lines.length; i += 1) {
    const labelled = lines[i].match(PASSENGER_LABEL);
    if (labelled) add(labelled[1].split(/\s{2,}|\|/)[0]);
    if (!PASSENGER_HEADER.test(lines[i])) continue;
    // a heading, then one name per line — numbered or with a title
    for (let j = i + 1; j < lines.length && lines[j].trim(); j += 1) {
      const m = lines[j].match(LISTED_NAME);
      if (!m || (!m[1] && !m[2])) break;
      add(m[3].split(/\s{2,}|\|/)[0]);
    }
  }
  return out.slice(0, 12);
}

const PNR_LABEL =
  /BOOKING\s+REF(?:ERENCE)?|BOOKING\s+(?:CODE|NUMBER|NO\.?)|RESERVATION\s+(?:CODE|NUMBER|NO\.?)|CONFIRMATION\s+(?:CODE|NUMBER|NO\.?)|RECORD\s+LOCATOR|AIRLINE\s+(?:REF(?:ERENCE)?|PNR)|\bPNR\b|رقم الحجز|مرجع الحجز|رمز الحجز|كود الحجز/iu;
const NOT_PNR = new Set(["AMADEUS", "AIRLINE", "SABRE", "GALILEO", "NUMBER", "BOOKING", "LOCATOR", "RECORD", "CONFIRMED", "TICKET", "STATUS"]);

function pnrToken(text: string): string {
  for (const m of text.toUpperCase().matchAll(/(?<![A-Z0-9])([A-Z0-9]{5,8})(?![A-Z0-9])/g)) {
    const t = m[1];
    if (/[A-Z]/.test(t) && (/\d/.test(t) || t.length === 6) && !NOT_PNR.has(t)) return t;
  }
  return "";
}

function findPnr(lines: string[], carriers: string[]): string {
  const text = lines.join("\n");
  // 1. the airline's own locator — what the client types on the airline's site
  for (const c of carriers) {
    const m = text.match(new RegExp(`(?<![A-Z0-9])(?:DC)?${c}[/*]([A-Z0-9]{6})(?![A-Z0-9])`));
    if (m && /[A-Z]/.test(m[1])) return m[1];
  }
  // 2. a labelled reference, its value on the same line or the next
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(PNR_LABEL);
    if (!m || m.index === undefined) continue;
    const found = pnrToken(lines[i].slice(m.index + m[0].length));
    if (found) return found;
    const next = lines.slice(i + 1).find((l) => l.trim());
    const below = next ? pnrToken(next) : "";
    if (below && next && next.trim().length <= 12) return below;
  }
  // 3. Amadeus: the record locator closes the RP header line
  const rp = lines.find((l) => /^\s*RP\//.test(l))?.match(/\s([A-Z0-9]{6})\s*$/);
  return rp ? rp[1] : "";
}

// ---------------------------------------------------------------- legs

type RawLeg = TicketLeg & { depGuessed: boolean; arrGuessed: boolean };

const GDS_SEGMENT =
  /^\s*\d{1,2}\s+([A-Z0-9]{2})\s?(\d{1,4})\s?([A-Z])\s+(\d{1,2})([A-Z]{3})(\d{2})?\s+(?:[A-Z0-9]{1,2}[\s*]+)?([A-Z]{3})\s?([A-Z]{3})[\s*]+[A-Z]{2}\d{1,2}\s+(\d{3,4}[APNM]?)\s+(\d{3,4}[APNM]?)(?:\+(\d))?(?:\s+(\d{1,2})([A-Z]{3})(\d{2})?(?![A-Z]))?/;

function gdsLegs(lines: string[], ref: Date): RawLeg[] {
  const legs: RawLeg[] = [];
  for (const line of lines) {
    const m = line.match(GDS_SEGMENT);
    if (!m) continue;
    const month = monthOf(m[5]);
    if (!month) continue;
    const dep = withYear({ y: m[6] ? fullYear(m[6]) : null, m: month, d: +m[4] }, ref);
    let arr = { date: m[11] ? addDays(dep.date, +m[11]) : dep.date, guessed: dep.guessed };
    if (m[12] && monthOf(m[13])) arr = withYear({ y: m[14] ? fullYear(m[14]) : null, m: monthOf(m[13]), d: +m[12] }, ref);
    legs.push({
      ...emptyLeg(),
      airline_iata: m[1],
      flight_no: `${m[1]}${m[2].replace(/^0+(?=\d)/, "")}`,
      from_iata: m[7],
      to_iata: m[8],
      dep_date: dep.date,
      dep_time: gdsTime(m[9]),
      arr_date: arr.date,
      arr_time: gdsTime(m[10]),
      cabin: cabinFromClass(m[3]),
      depGuessed: dep.guessed,
      arrGuessed: arr.guessed,
    });
  }
  return legs;
}

/** «Riyadh (RUH)» → «Riyadh»: the last run of words before the code. */
function nameBefore(prefix: string): string {
  const pieces = prefix.split(/\s{2,}|[:：|،,\d()→>–—]|\s-\s/);
  const last = (pieces[pieces.length - 1] ?? "").trim();
  const name = last.replace(/^(?:FROM|TO|DEPARTURE|ARRIVAL|DEPART|ARRIVE|من|إلى|الى)\s+/iu, "").trim();
  return /\p{L}{2}/u.test(name) ? name.slice(0, 50) : "";
}

const FROM_LABEL = /^\s*(?:FROM|DEPART(?:URE|ING)?(?:\s+FROM)?|من|المغادرة من|مطار المغادرة)\s*[:：-]\s*(.+)$/iu;
const TO_LABEL = /^\s*(?:TO|ARRIV(?:AL|ING|E)(?:\s+(?:AT|TO))?|إلى|الى|الوصول إلى|الوصول الى|مطار الوصول)\s*[:：-]\s*(.+)$/iu;

/** «RIYADH, SA (KING KHALID INTL), TERMINAL 5 …» → «RIYADH» — only when no code was printed. */
function labelledPlace(value: string): string {
  const head = value.split(/[,(|]|\s{2,}|\d/)[0].trim();
  if (!/\p{L}{2}/u.test(head) || monthOf(head.split(" ").pop() ?? "")) return "";
  if (/^(?:SUN|MON|TUE|WED|THU|FRI|SAT)/i.test(head) || /^(?:الأحد|الاثنين|الإثنين|الثلاثاء|الأربعاء|الاربعاء|الخميس|الجمعة|السبت)/u.test(head)) return "";
  return head.slice(0, 50);
}

function airportsIn(block: string[]): { code: string; name: string }[] {
  const text = block.join("\n");
  const found: { code: string; name: string }[] = [];
  const push = (code: string, name: string) => {
    if (NOT_AIRPORT.has(code)) return;
    if (found.length && found[found.length - 1].code === code) return;
    found.push({ code, name });
  };
  for (const m of text.matchAll(/([^\n()]{0,80}?)\(\s*([A-Z]{3})\s*\)/g)) push(m[2], nameBefore(m[1]));
  if (found.length >= 2) return found;

  const pair = text.match(/(?<![A-Za-z])([A-Z]{3})\s*(?:-|–|—|→|←|>|\/|\bTO\b)\s*([A-Z]{3})(?![A-Za-z])/);
  if (pair && !NOT_AIRPORT.has(pair[1]) && !NOT_AIRPORT.has(pair[2])) return [{ code: pair[1], name: "" }, { code: pair[2], name: "" }];

  for (const m of text.matchAll(/(?<![A-Za-z])([A-Z]{3})(?![A-Za-z])/g)) push(m[1], "");
  return found;
}

function readBlock(block: string[], carrier: string, number: string, ref: Date): RawLeg {
  const dates: Hit<DateParts>[] = [];
  const times: Hit<TimeParts>[] = [];
  let offset = 0;
  for (const line of block) {
    if (!NOT_FLIGHT_DATE.test(line)) {
      const d = findDates(line);
      // dates are blanked before times are read: «15.11» is a day, not a clock
      let masked = line;
      for (const h of d) masked = masked.slice(0, h.index) + " ".repeat(h.end - h.index) + masked.slice(h.end);
      dates.push(...d.map((h) => ({ ...h, index: h.index + offset })));
      if (!NOT_FLIGHT_TIME.test(line)) times.push(...findTimes(masked).map((h) => ({ ...h, index: h.index + offset })));
    }
    offset += line.length + 1;
  }

  const airports = airportsIn(block);
  let fromName = airports[0]?.name ?? "";
  let toName = airports[1]?.name ?? "";
  if (airports.length < 2) {
    for (const line of block) {
      const f = line.match(FROM_LABEL);
      const t = line.match(TO_LABEL);
      if (f && !fromName && !airports[0]) fromName = labelledPlace(f[1]);
      if (t && !toName) toName = labelledPlace(t[1]);
    }
  }

  const text = block.join("\n");
  const dep = dates[0] ? withYear(dates[0].value, ref) : null;
  const arrTime = times[1]?.value;
  let arr = dates[1] ? withYear(dates[1].value, ref) : dep;
  if (!dates[1] && dep && arrTime?.plus) arr = { date: addDays(dep.date, arrTime.plus), guessed: dep.guessed };

  return {
    ...emptyLeg(),
    airline_iata: carrier,
    flight_no: `${carrier}${number}`,
    from_iata: airports[0]?.code ?? "",
    from_name: fromName,
    to_iata: airports[1]?.code ?? "",
    to_name: toName,
    dep_date: dep?.date ?? "",
    dep_time: times[0]?.value.time ?? "",
    arr_date: arrTime || dates[1] ? (arr?.date ?? "") : "",
    arr_time: arrTime?.time ?? "",
    cabin: cabinIn(text),
    baggage: baggageIn(text),
    depGuessed: dep?.guessed ?? false,
    arrGuessed: arr?.guessed ?? false,
  };
}

/** A line that only dates the leg below it: «Outbound · Fri 18 Dec 2026». */
function isDateHeader(line: string): boolean {
  return !NOT_FLIGHT_DATE.test(line) && findDates(line).length > 0 && findTimes(line).length === 0 && !flightNoIn(line);
}

function labelledLegs(lines: string[], ref: Date): RawLeg[] {
  const anchors: { line: number; carrier: string; number: string }[] = [];
  lines.forEach((line, i) => {
    const hit = flightNoIn(line);
    const prev = anchors[anchors.length - 1];
    // the same flight named twice in a row («Flight SV1020» over «SV1020 operated by…») is one leg
    if (hit && !(prev && prev.carrier === hit.carrier && prev.number === hit.number)) anchors.push({ line: i, ...hit });
  });
  if (anchors.length === 0) return [];
  // one flight: the whole ticket is its block (airports may be printed above the number)
  if (anchors.length === 1) return [readBlock(lines, anchors[0].carrier, anchors[0].number, ref)];

  // a date-only heading just above a flight number belongs to that flight
  const starts = anchors.map((a, k) => {
    let start = a.line;
    const floor = k === 0 ? 0 : anchors[k - 1].line + 1;
    for (let j = a.line - 1; j >= Math.max(floor, a.line - 2); j -= 1) {
      if (isDateHeader(lines[j])) start = j;
      else if (lines[j].trim()) break;
    }
    return start;
  });
  return anchors.map((a, k) => readBlock(lines.slice(starts[k], starts[k + 1] ?? lines.length), a.carrier, a.number, ref));
}

/** Year roll-over across a trip printed without years: 28DEC out, 04JAN home. */
function chronological(legs: RawLeg[]): TicketLeg[] {
  let prev = "";
  return legs.map(({ depGuessed, arrGuessed, ...leg }) => {
    if (depGuessed && prev && leg.dep_date && leg.dep_date < prev) leg.dep_date = addYear(leg.dep_date);
    if (arrGuessed && leg.arr_date && leg.dep_date && leg.arr_date < leg.dep_date) leg.arr_date = addYear(leg.arr_date);
    prev = leg.dep_date || prev;
    return leg;
  });
}

const stamp = (date: string, time: string) => (date ? Date.parse(`${date}T${time || "00:00"}:00Z`) : NaN);

/**
 * Out and home, from the gaps: a wait of more than a day is a stay, so what
 * comes before the first stay is the way out and what follows the last one is
 * the way home. A one-way ticket (no stay) gets no label at all.
 */
export function guessLegOrders(legs: TicketLeg[]): (LegOrder | null)[] {
  const stays: number[] = [];
  for (let i = 1; i < legs.length; i += 1) {
    const before = stamp(legs[i - 1].arr_date || legs[i - 1].dep_date, legs[i - 1].arr_time || legs[i - 1].dep_time);
    const after = stamp(legs[i].dep_date, legs[i].dep_time);
    if (Number.isFinite(before) && Number.isFinite(after) && after - before > DAY_MS) stays.push(i);
  }
  if (stays.length === 0) return legs.map(() => null);
  const first = stays[0];
  const last = stays[stays.length - 1];
  return legs.map((_, i) => (i < first ? "outbound" : i >= last ? "inbound" : null));
}

// ---------------------------------------------------------------- entry point

export function parseTicketText(input: string, now: Date = new Date()): ParsedTicket {
  const lines = normalizeTicketText(input).split("\n");

  // the ticket's own date anchors a yearless «15NOV»; without one, today does
  let ref = now;
  for (const line of lines) {
    if (!ISSUE_DATE.test(line)) continue;
    const hit = findDates(line).find((h) => h.value.y);
    if (hit?.value.y) {
      ref = new Date(Date.UTC(hit.value.y, hit.value.m - 1, hit.value.d));
      break;
    }
  }

  const raw = gdsLegs(lines, ref);
  const legs = chronological(raw.length ? raw : labelledLegs(lines, ref));

  // an allowance printed once, for the whole ticket, holds for every leg
  const shared = baggageIn(lines.join("\n"));
  for (const leg of legs) if (!leg.baggage && shared) leg.baggage = shared;
  guessLegOrders(legs).forEach((order, i) => (legs[i].leg_order = order));

  return {
    pnr: findPnr(lines, [...new Set(legs.map((l) => l.airline_iata).filter(Boolean))]),
    passengers: findPassengers(lines),
    legs,
  };
}

// ---------------------------------------------------------------- after the read

/** What a reader left empty — the fields the model may be asked to fill. */
export function ticketGaps(t: ParsedTicket): string[] {
  const gaps: string[] = [];
  if (!t.pnr) gaps.push("pnr");
  if (t.passengers.length === 0) gaps.push("passengers");
  if (t.legs.length === 0) gaps.push("legs");
  t.legs.forEach((leg, i) => {
    for (const key of ["flight_no", "from_iata", "to_iata", "dep_date", "dep_time", "arr_time"] as const) {
      if (!leg[key]) gaps.push(`legs.${i}.${key}`);
    }
  });
  return gaps;
}

const flightKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^([A-Z0-9]{2})0+/, "$1");

/** Fill only what `base` left empty. A field the parser read is never overwritten. */
export function mergeTicket(base: ParsedTicket, fill: ParsedTicket): ParsedTicket {
  const legs = base.legs.map((leg, i) => {
    const twin =
      fill.legs.find((f) => f.flight_no && flightKey(f.flight_no) === flightKey(leg.flight_no)) ??
      (fill.legs.length === base.legs.length ? fill.legs[i] : undefined);
    if (!twin) return leg;
    const out = { ...leg };
    for (const key of Object.keys(out) as (keyof TicketLeg)[]) {
      if (key !== "leg_order" && !out[key] && twin[key]) (out as Record<string, unknown>)[key] = twin[key];
    }
    return out;
  });
  const known = new Set(legs.map((l) => flightKey(l.flight_no)).filter(Boolean));
  const extra = fill.legs.filter((f) => f.flight_no && !known.has(flightKey(f.flight_no)) && base.legs.length > 0);
  const merged = base.legs.length ? [...legs, ...extra] : fill.legs;
  const orders = guessLegOrders(merged);
  return {
    pnr: base.pnr || fill.pnr,
    passengers: base.passengers.length ? base.passengers : fill.passengers,
    legs: merged.map((l, i) => ({ ...l, leg_order: l.leg_order ?? orders[i] })),
  };
}

const LIMITS = { legs: 12, passengers: 12 } as const;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const pattern = (v: unknown, re: RegExp, upper = false) => {
  const s = text(v, 16);
  const t = upper ? s.toUpperCase() : s;
  return re.test(t) ? t : "";
};

/**
 * Any outside shape — the model's JSON, the browser's POST — cut down to a
 * ParsedTicket: known keys only, strings trimmed and capped, codes and dates in
 * their one accepted form. What does not fit becomes empty.
 */
export function sanitizeTicket(raw: unknown): ParsedTicket {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const legs = (Array.isArray(r.legs) ? r.legs : []).slice(0, LIMITS.legs).map((item): TicketLeg => {
    const l = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const order = l.leg_order;
    return {
      airline: text(l.airline, 60),
      airline_iata: pattern(l.airline_iata, /^[A-Z0-9]{2}$/, true),
      flight_no: text(l.flight_no, 10).toUpperCase().replace(/\s+/g, ""),
      from_iata: pattern(l.from_iata, /^[A-Z]{3}$/, true),
      from_name: text(l.from_name, 60),
      to_iata: pattern(l.to_iata, /^[A-Z]{3}$/, true),
      to_name: text(l.to_name, 60),
      dep_date: pattern(l.dep_date, /^\d{4}-\d{2}-\d{2}$/),
      dep_time: pattern(l.dep_time, /^([01]\d|2[0-3]):[0-5]\d$/),
      arr_date: pattern(l.arr_date, /^\d{4}-\d{2}-\d{2}$/),
      arr_time: pattern(l.arr_time, /^([01]\d|2[0-3]):[0-5]\d$/),
      cabin: text(l.cabin, 30),
      baggage: text(l.baggage, 40),
      leg_order: order === "outbound" || order === "inbound" || order === "internal" ? order : null,
    };
  });
  return {
    pnr: pattern(r.pnr, /^[A-Z0-9]{5,8}$/, true),
    passengers: (Array.isArray(r.passengers) ? r.passengers : [])
      .map((p) => text(p, 80))
      .filter(Boolean)
      .slice(0, LIMITS.passengers),
    legs,
  };
}

export type AirportName = { code: string; name: string };
export type AirlineName = { iata: string; name: string };

/** Our own names for what the ticket printed as codes — the card reads in Arabic. */
export function enrichTicket(t: ParsedTicket, airports: AirportName[], airlines: AirlineName[]): ParsedTicket {
  const airport = new Map(airports.filter((a) => a.code).map((a) => [a.code.toUpperCase(), a.name]));
  const airline = new Map(airlines.map((a) => [a.iata.toUpperCase(), a.name]));
  return {
    ...t,
    legs: t.legs.map((leg) => {
      const iata = leg.airline_iata || leg.flight_no.slice(0, 2).toUpperCase();
      return {
        ...leg,
        airline_iata: iata,
        airline: airline.get(iata) || leg.airline || iata,
        from_name: airport.get(leg.from_iata) || leg.from_name,
        to_name: airport.get(leg.to_iata) || leg.to_name,
      };
    }),
  };
}
