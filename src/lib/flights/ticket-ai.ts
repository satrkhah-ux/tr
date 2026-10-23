import "server-only";
import type { AiImage } from "@/lib/repackage/extract/ai-extract";
import { sanitizeTicket, type ParsedTicket } from "./ticket-parse";
import { responsesJson } from "@/lib/providers/openai";

/**
 * The model, for a ticket — two narrow jobs and nothing else:
 *
 *   transcribeTicket  pictures of a ticket → its text, verbatim. Only when no
 *                     OCR service is configured; the text then goes through the
 *                     same parser as a pasted ticket.
 *   readTicketText    the ticket's text → the strict schema below, used ONLY to
 *                     fill what the regex parser left empty (mergeTicket never
 *                     overwrites a parsed field).
 *
 * Nothing but the ticket is sent: no employee, no client record, no offer. The
 * answer is cut down by sanitizeTicket and shown in the editable form; the card
 * is drawn from what the employee confirms, never from this output directly.
 *
 * SERVER-ONLY, gated on OPENAI_API_KEY (read at runtime, like ai-extract.ts).
 * Nothing here logs — a ticket carries names and a booking reference.
 */

const DEFAULT_MODEL = "gpt-4o-mini";
const MAX_TEXT = 20_000;
const MAX_IMAGES = 4;

type Schema = Record<string, unknown>;
type Content = string | Record<string, unknown>[];

async function chatJson(name: string, schema: Schema, system: string, content: Content, model?: string): Promise<unknown> {
  const key = process.env["OPENAI_API_KEY"];
  if (!key) throw new Error("not_configured");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({
      model: model || process.env["OPENAI_MODEL"] || DEFAULT_MODEL,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content },
      ],
      response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
    }),
  });
  if (!res.ok) throw new Error(`openai_${res.status}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return JSON.parse(data.choices?.[0]?.message?.content ?? "{}");
}

const TRANSCRIBE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["text"],
  properties: { text: { type: "string" } },
} as const;

/** Pictures of a ticket (or a hotel's confirmation — `what`) → its text, line by line, as printed. */
export async function transcribeTicket(images: AiImage[], what = "flight ticket"): Promise<string> {
  const content = [
    { type: "text", text: `Transcribe all the text in these ${what} images.` },
    ...images.slice(0, MAX_IMAGES).map((img) => ({
      type: "image_url",
      image_url: { url: `data:${img.mime};base64,${img.base64}`, detail: "high" },
    })),
  ];
  const out = (await chatJson(
    "ticket_transcript",
    TRANSCRIBE_SCHEMA,
    [
      "You transcribe travel documents — flight tickets, itineraries, hotel confirmations (Arabic or English).",
      "Copy the text exactly, line by line, in reading order. Keep codes, numbers, dates and times exactly as printed.",
      "Do not translate, summarise, correct or add anything. If nothing is legible, return an empty string.",
    ].join("\n"),
    content,
  )) as { text?: unknown };
  return typeof out.text === "string" ? out.text : "";
}

const KIND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind"],
  properties: { kind: { type: "string", enum: ["passport", "ticket", "hotel", "hotel_invoice", "ticket_invoice", "payment", "unknown"] } },
} as const;
type PaperKindSeen = "passport" | "ticket" | "hotel" | "hotel_invoice" | "ticket_invoice" | "payment" | "unknown";

/**
 * Pictures of one paper → which paper it is, nothing more («ارفع كل الملفات»,
 * 2026-10-22). Only the kind comes back: a passport is not read here — its
 * own reader (the MRZ, audited) does that.
 */
export async function classifyPaper(images: AiImage[]): Promise<PaperKindSeen> {
  const content = [
    { type: "text", text: "Which travel document is this?" },
    ...images.slice(0, 2).map((img) => ({ type: "image_url", image_url: { url: `data:${img.mime};base64,${img.base64}`, detail: "low" } })),
  ];
  const out = (await chatJson(
    "paper_kind",
    KIND_SCHEMA,
    [
      "You sort travel documents. Answer with one kind:",
      "passport — a passport's data page (or an ID page with a machine-readable zone);",
      "ticket — a flight e-ticket, itinerary receipt or boarding pass;",
      "hotel — a hotel booking confirmation or voucher;",
      "hotel_invoice — a supplier's invoice or bill for a hotel stay;",
      "ticket_invoice — an airline's or agency's invoice for flight tickets;",
      "payment — a client's payment slip: a bank transfer screenshot, a card/POS slip, a cash receipt;",
      "unknown — anything else, or not legible.",
    ].join("\n"),
    content,
  )) as { kind?: unknown };
  const kinds: PaperKindSeen[] = ["passport", "ticket", "hotel", "hotel_invoice", "ticket_invoice", "payment"];
  return kinds.find((k) => k === out.kind) ?? "unknown";
}

const MONEY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["issuer", "hotel", "amount", "currency", "date", "reference", "method", "paid", "sender"],
  properties: {
    issuer: { type: "string" },
    hotel: { type: "string" },
    amount: { type: "string" },
    currency: { type: "string" },
    date: { type: "string" },
    reference: { type: "string" },
    method: { type: "string", enum: ["transfer", "cash", "pos", "link", ""] },
    paid: { type: "boolean" },
    sender: { type: "string" },
  },
} as const;

export type MoneyPaper = { issuer: string; hotel: string; amount: number | null; currency: string; date: string; reference: string; method: "transfer" | "cash" | "pos" | "link" | ""; paid: boolean; sender: string };

/**
 * A money paper's text → its figures («ارفع كل الملفات», 2026-10-23): an
 * invoice's issuer, hotel, total, currency, number and day, and whether it
 * says paid; a client's slip's amount, day, method, reference and sender. Only
 * the paper is sent. What comes back is shown for the employee to check.
 */
export async function readMoneyPaper(text: string): Promise<MoneyPaper> {
  const raw = (await chatJson(
    "money_paper",
    MONEY_SCHEMA,
    [
      "You read one travel-agency money paper: a supplier's invoice (hotel or flight) or a client's payment slip (bank transfer, card/POS slip, cash receipt).",
      "issuer: who issued an invoice (the supplier's name as printed); hotel: the hotel named, if any.",
      "amount: the grand total to pay, or the amount transferred — digits and a dot only, no separators. currency: its ISO code (SAR, USD, EUR, TRY…).",
      "date: the invoice's or the payment's date as YYYY-MM-DD. reference: the invoice number, or the transfer's reference/transaction number.",
      "method: for a slip — transfer, cash, pos (a card machine) or link (an online payment link); else empty. paid: true only when the paper says it is paid or settled.",
      "sender: who sent a transfer, if printed. Empty string for anything not on the paper. Never guess.",
    ].join("\n"),
    text.slice(0, MAX_TEXT),
  )) as Record<string, unknown>;
  const str = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string).trim().slice(0, 120) : "");
  const amount = Number(str("amount").replace(/[^\d.]/g, ""));
  const method = str("method");
  return {
    issuer: str("issuer"),
    hotel: str("hotel"),
    amount: Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null,
    currency: /^[A-Z]{3}$/.test(str("currency").toUpperCase()) ? str("currency").toUpperCase() : "",
    date: /^\d{4}-\d{2}-\d{2}$/.test(str("date")) ? str("date") : "",
    reference: str("reference"),
    method: method === "transfer" || method === "cash" || method === "pos" || method === "link" ? method : "",
    paid: raw.paid === true,
    sender: str("sender"),
  };
}

/** A paper's words → which paper it is, when its words alone did not say (a hotel's own voucher, a reservation printout). */
export async function classifyText(text: string): Promise<PaperKindSeen> {
  const out = (await chatJson(
    "paper_kind",
    KIND_SCHEMA,
    [
      "You sort travel documents by their text. Answer with one kind:",
      "passport; ticket (a flight e-ticket, itinerary receipt or airline/agency reservation with flights);",
      "hotel (a hotel booking confirmation or voucher, from the hotel or a supplier); hotel_invoice (a supplier's invoice or bill for a hotel stay);",
      "ticket_invoice (an invoice for flight tickets); payment (a client's payment slip or bank transfer); unknown.",
    ].join("\n"),
    text.slice(0, 8000),
  )) as { kind?: unknown };
  const kinds: PaperKindSeen[] = ["passport", "ticket", "hotel", "hotel_invoice", "ticket_invoice", "payment"];
  return kinds.find((k) => k === out.kind) ?? "unknown";
}

const STAY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["issuer", "hotels"],
  properties: {
    issuer: { type: "string" },
    hotels: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["hotel_name", "city", "check_in", "check_out", "confirmation", "room", "guests"],
        properties: {
          hotel_name: { type: "string" },
          city: { type: "string" },
          check_in: { type: "string" },
          check_out: { type: "string" },
          confirmation: { type: "string" },
          room: { type: "string" },
          guests: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

export type PaperStay = { hotel_name: string; city: string; check_in: string; check_out: string; confirmation: string; room: string; guests: string[] };

/**
 * A hotel's or a supplier's own paper → each stay on it (the owner's samples,
 * 2026-10-23: chain websites print «Confirmation #86396384», «MON, 11/09/26 -
 * THU, 11/12/26», «FROM Sunday, October 4, 2026» — shapes no label list
 * holds). A TBO itinerary is several stays. Only the paper is sent; what comes
 * back is checked and shown for the employee to confirm.
 */
export async function readHotelPaper(text: string): Promise<{ issuer: string; hotels: PaperStay[] }> {
  const raw = (await chatJson(
    "hotel_paper",
    STAY_SCHEMA,
    [
      "You read one hotel booking confirmation or voucher (Arabic or English) — from the hotel, a chain's website or a supplier (TBO, Booking.com, Agoda…) — and copy what it states. Never guess.",
      "issuer: the supplier or agency that issued the paper, if named (not the hotel itself).",
      "hotels: one entry per hotel stay on the paper, in its order.",
      "hotel_name: the hotel's name as printed (Latin as printed). city: its city.",
      "check_in / check_out: YYYY-MM-DD. Work out the year and the day-month order from the paper itself (weekday names, the other date, the country's style); leave empty if unsure.",
      "confirmation: the hotel's own confirmation number if printed, else the reservation/booking number of that stay.",
      "room: the room type as printed. guests: the guests' names as printed, without titles.",
      "Empty string for anything not on the paper.",
    ].join("\n"),
    text.slice(0, MAX_TEXT),
  )) as { issuer?: unknown; hotels?: unknown };
  const str = (v: unknown, n = 120) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
  const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : "");
  const hotels = (Array.isArray(raw.hotels) ? raw.hotels : []).slice(0, 12).map((h): PaperStay => {
    const r = (h && typeof h === "object" ? h : {}) as Record<string, unknown>;
    return {
      hotel_name: str(r.hotel_name),
      city: str(r.city, 60),
      check_in: day(r.check_in),
      check_out: day(r.check_out),
      confirmation: str(r.confirmation, 40).replace(/^#/, ""),
      room: str(r.room),
      guests: (Array.isArray(r.guests) ? r.guests : []).map((g) => str(g, 80)).filter(Boolean).slice(0, 20),
    };
  });
  return { issuer: str(raw.issuer), hotels: hotels.filter((h) => h.hotel_name || h.confirmation || h.check_in) };
}

const S = { type: "string" } as const;
const TICKET_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["pnr", "passengers", "legs"],
  properties: {
    pnr: S,
    passengers: { type: "array", items: S },
    legs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "airline", "airline_iata", "flight_no", "from_iata", "from_name", "to_iata", "to_name",
          "dep_date", "dep_time", "arr_date", "arr_time", "cabin", "baggage",
        ],
        properties: {
          airline: S, airline_iata: S, flight_no: S, from_iata: S, from_name: S, to_iata: S, to_name: S,
          dep_date: S, dep_time: S, arr_date: S, arr_time: S, cabin: S, baggage: S,
        },
      },
    },
  },
} as const;

const READ_SYSTEM = `أنت تقرأ تذاكر الطيران ومسارات الرحلات (عربي أو إنجليزي) وتستخرج ما هو مكتوب فقط.
قواعد صارمة:
- لا تخترع شيئاً. ما ليس مكتوباً صراحةً اتركه نصاً فارغاً "".
- حوّل الأرقام العربية الشرقية (٠١٢٣٤٥٦٧٨٩) إلى أرقام غربية قبل القراءة.
- pnr: رقم الحجز / Booking reference كما ورد (٥-٨ حروف وأرقام لاتينية).
- passengers: أسماء المسافرين كما وردت، بلا ألقاب (MR/MRS/السيد…). صيغة «SURNAME/GIVEN» اكتبها «GIVEN SURNAME».
- legs: رحلة لكل رقم رحلة بالترتيب.
- flight_no مثل SV1020، و airline_iata أول حرفين منه.
- from_iata و to_iata رموز المطارات الثلاثية (RUH, JED…) فقط إن كانت مكتوبة؛ from_name و to_name اسم المدينة أو المطار كما ورد.
- dep_date و arr_date بصيغة YYYY-MM-DD، و dep_time و arr_time بصيغة HH:mm (٢٤ ساعة) بالتوقيت المحلي المكتوب. لا تخمّن سنة غير مكتوبة.
- cabin بالعربية: اقتصادية / اقتصادية مميزة / رجال الأعمال / الأولى.
- baggage مختصرة بالعربية مثل «23 كجم» أو «قطعتان».`;

/** The ticket's text → the parser's shape, for the gaps only. */
export async function readTicketText(text: string): Promise<ParsedTicket> {
  const raw = await chatJson("flight_ticket", TICKET_SCHEMA, READ_SYSTEM, text.slice(0, MAX_TEXT));
  return sanitizeTicket(raw);
}

// ---------------- an outside paper, read whole from the file itself ----------------

/** A booking of the case, as the reader of an outside paper is told it — to say which one the paper is for. */
export type PaperContext = { id: string; kind: "hotel" | "flight"; name: string; name_en: string; city: string; from: string; to: string; route: string };

const STR = { type: "string" } as const;
const PAPER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "issuer", "hotels", "ticket", "money"],
  properties: {
    kind: { type: "string", enum: ["passport", "ticket", "hotel", "hotel_invoice", "ticket_invoice", "payment", "unknown"] },
    issuer: STR,
    hotels: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["hotel_name", "city", "check_in", "check_out", "confirmation", "room", "guests", "booking_id"],
        properties: { hotel_name: STR, city: STR, check_in: STR, check_out: STR, confirmation: STR, room: STR, guests: { type: "array", items: STR }, booking_id: STR },
      },
    },
    ticket: {
      type: "object",
      additionalProperties: false,
      required: ["pnr", "passengers", "ticket_numbers", "legs", "booking_id"],
      properties: {
        pnr: STR,
        passengers: { type: "array", items: STR },
        ticket_numbers: { type: "array", items: STR },
        legs: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["flight_no", "from_iata", "to_iata", "dep_date", "dep_time", "arr_date", "arr_time", "cabin", "baggage", "pnr"],
            properties: { flight_no: STR, from_iata: STR, to_iata: STR, dep_date: STR, dep_time: STR, arr_date: STR, arr_time: STR, cabin: STR, baggage: STR, pnr: STR },
          },
        },
        booking_id: STR,
      },
    },
    money: {
      type: "object",
      additionalProperties: false,
      required: ["hotel", "amount", "currency", "date", "reference", "method", "paid", "sender", "booking_id"],
      properties: {
        hotel: STR,
        amount: STR,
        currency: STR,
        date: STR,
        reference: STR,
        method: { type: "string", enum: ["transfer", "cash", "pos", "link", ""] },
        paid: { type: "boolean" },
        sender: STR,
        booking_id: STR,
      },
    },
  },
} as const;

const PAPER_SYSTEM = `You read ONE travel paper an agency's staff upload — the PDF or the photo itself — and copy what it states. Never guess; leave a field "" when it is not on the paper.
kind: passport · ticket (an airline's e-ticket, itinerary receipt, or an agency's flight reservation) · hotel (a hotel's or a supplier's booking confirmation or voucher) · hotel_invoice (a supplier's invoice for hotel stays) · ticket_invoice (an invoice for flight tickets) · payment (a client's payment slip: bank transfer, card/POS slip, cash receipt) · unknown.
issuer: who issued the paper (the airline, the supplier — TBO, Booking.com, Smart Booking… — or the hotel).
hotels (hotel and hotel_invoice papers): one entry per hotel stay. hotel_name as printed (Latin as printed); city; check_in / check_out as YYYY-MM-DD — work out the year and the day-month order from the paper (weekday names, the other date, the country's style); confirmation: the hotel's own confirmation number if printed, else that stay's reservation number; room; guests as printed, no titles.
ticket (ticket and ticket_invoice papers): pnr (the booking reference, 5–8 Latin letters/digits); passengers as printed, "SURNAME/GIVEN" written "GIVEN SURNAME", no titles; ticket_numbers (13 digits, e.g. 065-1234567890); legs, one per flight in order: flight_no like RX853 (never an aircraft type such as A321 or B787), from_iata / to_iata three-letter airport codes in the direction flown, dep/arr dates YYYY-MM-DD and local times HH:mm, cabin, baggage, and the leg's own pnr (one paper may hold several bookings — a booking code per flight or per page; the ticket's pnr is then the first). Copy codes letter by letter: a booking code is often mistaken (JJY43U is not J3Y3UJ), an airport's name tells its code (Don Mueang is DMK, Suvarnabhumi is BKK).
money (invoices and payment slips): hotel (the hotel an invoice is for, if named — then kind is hotel_invoice), amount (the grand total or the amount paid, digits and a dot), currency (ISO code), date YYYY-MM-DD, reference (invoice or transaction number), method (slips), paid (true only when the paper says paid/settled), sender (slips).
booking_id: the case's bookings are listed below. Give a booking's id ONLY when this paper is plainly for it — a hotel stay of the SAME hotel (its name in either language) whose dates overlap; a ticket whose route and dates are that flight booking's. Otherwise "". A hotel the case does not have is "", never the nearest one.`;

export type OutsidePaper = {
  kind: PaperKindSeen;
  issuer: string;
  hotels: (PaperStay & { booking_id: string })[];
  ticket: (ParsedTicket & { ticket_numbers: string[]; booking_id: string }) | null;
  money: (MoneyPaper & { booking_id: string }) | null;
};

/**
 * An outside paper → everything on it, from the file itself (the owner's
 * samples, 2026-10-23: an airline's e-ticket and a chain's confirmation read
 * as text gave «A321 JET→», a middle name as an airport, no PNR; the
 * evaluator's design). The PDF or the photo goes to the model with the case's
 * bookings, and it says which one the paper is for — our code checks that
 * again before anything is placed. The model: OPENAI_DOCS_MODEL, else gpt-5.5.
 * Only the paper and the bookings' names and dates are sent.
 */
export async function readPaperFile(file: { mime: string; base64: string; name: string }, bookings: PaperContext[]): Promise<OutsidePaper> {
  const part =
    file.mime === "application/pdf"
      ? { type: "input_file", filename: file.name || "paper.pdf", file_data: `data:application/pdf;base64,${file.base64}` }
      : { type: "input_image", image_url: `data:${file.mime};base64,${file.base64}`, detail: "high" };
  const raw = (await responsesJson(
    "travel_paper",
    PAPER_SCHEMA,
    [{ type: "input_text", text: `${PAPER_SYSTEM}\n\nThe case's bookings:\n${JSON.stringify(bookings)}` }, part],
    process.env["OPENAI_DOCS_MODEL"] || "gpt-5.5",
  )) as Record<string, unknown>;
  const str = (v: unknown, n = 120) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
  const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : "");
  const ids = new Set(bookings.map((b) => b.id));
  const own = (v: unknown) => (typeof v === "string" && ids.has(v) ? v : "");
  // ponytail: a number of six digits or more holds no letter O before a digit — the model's «81455EEO92094»; a code
  // that really does is mis-corrected, the employee sees it beside the paper before «اعتمد»
  const zero = (v: string) => ((v.match(/\d/g) ?? []).length >= 6 ? v.replace(/O(?=\d)/g, "0") : v);
  /** a booking code without the airline's prefix some papers print («RX-VAH6LL») */
  const code = (v: unknown) => str(v, 14).toUpperCase().replace(/^[A-Z0-9]{2}[-\s]+(?=[A-Z0-9]{5,8}$)/, "");
  const kinds: PaperKindSeen[] = ["passport", "ticket", "hotel", "hotel_invoice", "ticket_invoice", "payment"];
  const kind = kinds.find((k) => k === raw.kind) ?? "unknown";
  const hotels = (Array.isArray(raw.hotels) ? raw.hotels : []).slice(0, 12).map((h) => {
    const r = (h && typeof h === "object" ? h : {}) as Record<string, unknown>;
    return {
      hotel_name: str(r.hotel_name),
      city: str(r.city, 60),
      check_in: day(r.check_in),
      check_out: day(r.check_out),
      confirmation: zero(str(r.confirmation, 40).replace(/^#/, "")),
      room: str(r.room),
      guests: (Array.isArray(r.guests) ? r.guests : []).map((g) => str(g, 80)).filter(Boolean).slice(0, 20),
      booking_id: own(r.booking_id),
    };
  });
  const t = (raw.ticket && typeof raw.ticket === "object" ? raw.ticket : {}) as Record<string, unknown>;
  const legs = (Array.isArray(t.legs) ? t.legs : []).map((l) => {
    const r = (l && typeof l === "object" ? l : {}) as Record<string, unknown>;
    const no = str(r.flight_no, 10).toUpperCase().replace(/[\s-]+/g, "").replace(/^([A-Z0-9]{2})0+(\d)/, "$1$2"); // «FD-660» → FD660, EY0616 → EY616
    return { ...r, flight_no: no, pnr: code(r.pnr), airline: "", airline_iata: no.slice(0, 2), from_name: "", to_name: "", leg_order: null };
  });
  const ticket = sanitizeTicket({ pnr: code(t.pnr), passengers: t.passengers, legs });
  const m = (raw.money && typeof raw.money === "object" ? raw.money : {}) as Record<string, unknown>;
  const amount = Number(str(m.amount).replace(/[^\d.]/g, ""));
  const method = str(m.method);
  return {
    kind,
    issuer: str(raw.issuer),
    hotels: hotels.filter((h) => h.hotel_name || h.confirmation || h.check_in),
    ticket:
      ticket.legs.length || ticket.pnr
        ? { ...ticket, ticket_numbers: (Array.isArray(t.ticket_numbers) ? t.ticket_numbers : []).map((n) => str(n, 20)).filter((n) => /^\d{3}-?\d{10}$/.test(n)), booking_id: own(t.booking_id) }
        : null,
    money:
      kind === "hotel_invoice" || kind === "ticket_invoice" || kind === "payment"
        ? {
            issuer: str(raw.issuer),
            hotel: str(m.hotel),
            amount: Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) / 100 : null,
            currency: /^[A-Z]{3}$/.test(str(m.currency).toUpperCase()) ? str(m.currency).toUpperCase() : "",
            date: day(m.date),
            reference: str(m.reference),
            method: method === "transfer" || method === "cash" || method === "pos" || method === "link" ? method : "",
            paid: m.paid === true,
            sender: str(m.sender),
            booking_id: own(m.booking_id),
          }
        : null,
  };
}
