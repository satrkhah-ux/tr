import "server-only";
import type { AiImage } from "@/lib/repackage/extract/ai-extract";
import { sanitizeTicket, type ParsedTicket } from "./ticket-parse";

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

async function chatJson(name: string, schema: Schema, system: string, content: Content): Promise<unknown> {
  const key = process.env["OPENAI_API_KEY"];
  if (!key) throw new Error("not_configured");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({
      model: process.env["OPENAI_MODEL"] || DEFAULT_MODEL,
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
