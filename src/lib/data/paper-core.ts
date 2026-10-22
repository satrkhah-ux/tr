import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { isOpenAIConfigured } from "@/lib/providers/openai";
import { classifyPaper, classifyText, readHotelPaper, readPaperFile, transcribeTicket, type MoneyPaper, type PaperContext, type PaperStay } from "@/lib/flights/ticket-ai";
import type { ParsedTicket } from "@/lib/flights/ticket-parse";
import { catalogHotelsFor } from "@/lib/data/hotel-match";
import { parseHotelConfirmation } from "@/lib/operations/wizard/hotels";
import { getOcrProvider } from "@/lib/repackage/extract/ocr";
import { extractPdfText } from "@/lib/repackage/extract/pdf-text";
import { normalizeImage, pdfPageImages } from "@/lib/repackage/extract/page-images";
import { sniff } from "@/lib/repackage/extract/upload-text";
import { ownLegs, plannedLegs } from "@/lib/operations/wizard/flights";
import { matchTicket, paperKind, placeStay, splitStays, type PaperKind, type StayTarget } from "@/lib/operations/wizard/upload-all";

/**
 * «ارفع كل الملفات»'s reading, ungated — upload-sort.ts gates every call on
 * the case first; kept out of that "use server" file so none of it is an
 * action a browser can call. One file → which paper and its words (a passport
 * never transcribed); one hotel paper → its stays, each placed.
 */

export type SortedPaper = {
  kind: PaperKind;
  /** a ticket's or a hotel confirmation's words — never a passport's */
  text: string;
  /** a passport sent as a PDF: its first page, as a picture for the MRZ reader */
  image: string | null;
  /** an outside paper, read whole from the file (readPaperFile) and placed — the readers take it as read */
  read?: OutsideRead;
};

export type OutsideRead = {
  issuer: string;
  stays: PlacedStay[];
  ticket: (ParsedTicket & { ticket_numbers: string[]; target: string | null }) | null;
  /** an invoice's booking, checked like a stay's or a ticket's; a client's slip is the case's */
  money: (MoneyPaper & { target: string | null }) | null;
};

/** The case as the reader of an outside paper is told it, and as our checks place by it. */
export type CaseBookings = { context: PaperContext[]; hotels: StayTarget[]; flights: { id: string; start_date: string | null; end_date: string | null; detail: Record<string, string> | null; pnr: string | null }[] };

/** Our own voucher's line for our reader (VoucherSheets) — it reads by the parser, exactly. */
const OURS = /HOTEL CONFIRMATION NO:/;
/** Our own papers, a voucher's line or a ticket's, read by the parser, never sent to the model. */
const ours = (text: string) => OURS.test(text) || ownLegs(text).length > 0;

const dataUrl = (img: { mime: string; base64: string }) => `data:${img.mime};base64,${img.base64}`;
/** A PDF's «Con fi rmation»: the font's ligature comes out as a word of its own — joined back, or the reader's labels miss it. */
const joined = (text: string) => text.replace(/([A-Za-z]) (fi|fl|ffi|ffl|ff) ([a-z])/g, "$1$2$3");
const WHAT: Record<Exclude<PaperKind, "passport" | "unknown">, string> = {
  ticket: "flight ticket",
  hotel: "hotel booking confirmation",
  hotel_invoice: "hotel supplier invoice",
  ticket_invoice: "flight ticket invoice",
  payment: "payment receipt or bank transfer",
};

export async function sortBytes(bytes: Buffer, cases?: CaseBookings): Promise<{ ok: true; paper: SortedPaper } | { ok: false; error: TranslationKey }> {
  try {
    const kind = sniff(bytes);
    if (!kind) return { ok: false, error: "wz.up.err.type" };

    const layer = kind.kind === "pdf" ? await extractPdfText(bytes).catch(() => null) : null;
    // an outside paper: one read of the file itself, with the case's bookings (the owner's samples, 2026-10-23) —
    // a photo is looked at first, cheaply, so a passport goes to its own reader and nowhere else
    if (cases && isOpenAIConfigured() && !(layer && ours(layer.text))) {
      const sorted = layer?.text.trim() ? paperKind(layer.text) : kind.kind === "image" ? await classifyPaper([await normalizeImage(bytes)]) : "unknown";
      if (sorted === "passport" && kind.kind === "image") return { ok: true, paper: { kind: "passport", text: "", image: null } };
      if (sorted !== "passport") {
        const file = kind.kind === "pdf" ? { mime: "application/pdf", base64: bytes.toString("base64"), name: "paper.pdf" } : { ...(await normalizeImage(bytes)), name: "paper" };
        // the model down or slow: the paper is read as before, from its words
        const out = await readPaperFile(file, cases.context).catch(() => null);
        if (out && out.kind !== "passport") {
          return { ok: true, paper: { kind: out.kind, text: layer?.text ? joined(layer.text).slice(0, 50_000) : "", image: null, read: placeOutside(out, cases) } };
        }
        if (out && kind.kind === "image") return { ok: true, paper: { kind: "passport", text: "", image: null } };
      }
    }

    if (kind.kind === "pdf") {
      const sorted = layer?.text.trim() ? paperKind(layer.text) : "unknown";
      if (sorted === "passport") {
        const [page] = await pdfPageImages(bytes).catch(() => []);
        return { ok: true, paper: { kind: "passport", text: "", image: page ? dataUrl(page) : null } };
      }
      // words that sort it are the words to read it by: the codes, numbers and dates a reader wants are Latin,
      // and our own papers (Arabic shaped, two short pages) count as «scanned» yet render blank as pictures —
      // AD-5-3269's ticket and vouchers came back unread (the evaluator, 2026-10-23)
      if (layer && layer.text.trim() && (sorted !== "unknown" || !layer.likelyScanned)) {
        const words = joined(layer.text).slice(0, 50_000);
        // words that did not say which paper: the model reads them (a hotel's own voucher, the owner's «Indigo»)
        const kind = sorted === "unknown" && isOpenAIConfigured() ? await classifyText(words).catch(() => "unknown" as const) : sorted;
        if (kind === "passport") {
          const [page] = await pdfPageImages(bytes).catch(() => []);
          return { ok: true, paper: { kind, text: "", image: page ? dataUrl(page) : null } };
        }
        return { ok: true, paper: { kind, text: words, image: null } };
      }
    }

    // a picture, or a scan: one look for its kind, then its words for a ticket or a hotel
    const ocr = getOcrProvider();
    if (!isOpenAIConfigured()) {
      if (!ocr.isConfigured()) return { ok: false, error: "wz.up.err.needsReader" };
      const read = await ocr.recognize(bytes, kind.kind === "pdf" ? "application/pdf" : kind.mime);
      const sorted = paperKind(read.text);
      return { ok: true, paper: { kind: sorted, text: sorted === "passport" ? "" : read.text, image: null } };
    }
    const images = kind.kind === "pdf" ? await pdfPageImages(bytes) : [await normalizeImage(bytes)];
    if (images.length === 0) return { ok: false, error: "wz.up.err.unreadable" };
    const sorted = await classifyPaper(images);
    if (sorted === "passport") return { ok: true, paper: { kind: sorted, text: "", image: kind.kind === "pdf" ? dataUrl(images[0]) : null } };
    if (sorted === "unknown") return { ok: true, paper: { kind: sorted, text: "", image: null } };
    let text = "";
    if (ocr.isConfigured()) text = (await ocr.recognize(bytes, kind.kind === "pdf" ? "application/pdf" : kind.mime).catch(() => ({ text: "" }))).text;
    if (!text.trim()) text = await transcribeTicket(images, WHAT[sorted]);
    return { ok: true, paper: { kind: sorted, text: text.slice(0, 50_000), image: null } };
  } catch {
    return { ok: false, error: "wz.up.err.unreadable" };
  }
}

export type PlacedStay = PaperStay & { target: string | null; other: boolean };

/** Each stay on a hotel paper, placed — the body of hotelsOnPaper (upload-sort.ts). */
export async function staysOn(db: SupabaseClient, operationId: string, text: string): Promise<{ issuer: string; stays: PlacedStay[] }> {
    let issuer = "";
    let stays: PaperStay[] = [];
    if (isOpenAIConfigured() && !OURS.test(text)) {
      const read = await readHotelPaper(text).catch(() => null);
      if (read) ({ issuer, hotels: stays } = read);
    }
    if (stays.length === 0) {
      stays = splitStays(text).map((part) => {
        const r = parseHotelConfirmation(part);
        return { hotel_name: "", city: "", check_in: r.check_in, check_out: r.check_out, confirmation: r.confirmation, room: r.room, guests: r.guests };
      });
    }
    const { hotels: targets } = await caseBookings(db, operationId);
    return { issuer, stays: stays.map((s) => ({ ...s, ...(OURS.test(text) ? placeOurs(s, targets) : placeStay(s, targets)) })) };
}

/** Our own voucher names its hotels in the language of the stay: its days place it, as before. */
function placeOurs(s: PaperStay, targets: { id: string; start_date: string | null; end_date: string | null }[]): { target: string | null; other: boolean } {
  const day = targets.find((t) => s.check_in && t.start_date === s.check_in);
  return { target: day?.id ?? (targets.length === 1 ? targets[0].id : null), other: false };
}

/**
 * What the reader said, checked before anything is placed: a hotel stay on the
 * booking it named only when that booking's dates meet the stay's, else by the
 * hotel's name (placeStay — never the file's only hotel for another hotel); a
 * ticket on the flight booking it named, else by its PNR or the route it flies
 * — a ticket whose flights the file does not hold stays unplaced.
 */
export function placeOutside(out: Awaited<ReturnType<typeof readPaperFile>>, cases: CaseBookings): OutsideRead {
  const near = (a: string, b: string | null, days: number) => !b || !a || Math.abs(Date.parse(a) - Date.parse(b)) <= days * 86_400_000;
  const stays: PlacedStay[] = out.hotels.map(({ booking_id, ...s }) => {
    const named = cases.hotels.find((h) => h.id === booking_id);
    const ok = named && (!s.check_in || (near(s.check_in, named.start_date, 1) || (named.start_date && named.end_date && s.check_in >= named.start_date && s.check_in < named.end_date)));
    return { ...s, ...(ok ? { target: named.id, other: false } : placeStay(s, cases.hotels)) };
  });
  let ticket: OutsideRead["ticket"] = null;
  if (out.ticket) {
    const { booking_id, ...t } = out.ticket;
    const byPnr = t.pnr ? cases.flights.find((f) => f.pnr?.toUpperCase() === t.pnr)?.id : undefined;
    const byRoute = t.legs.length ? matchTicket(t.legs, cases.flights) : null;
    const known = cases.flights.some((f) => f.id === booking_id) ? booking_id : null;
    ticket = { ...t, target: known ?? byPnr ?? byRoute ?? (t.legs.length === 0 && cases.flights.length === 1 ? cases.flights[0].id : null) };
  }
  let money: OutsideRead["money"] = null;
  if (out.money) {
    const { booking_id, ...m } = out.money;
    const named = cases.hotels.find((h) => h.id === booking_id);
    const byName = (hotels: StayTarget[]) => placeStay({ hotel_name: m.hotel, check_in: "", check_out: "" }, hotels).target;
    // a hotel's invoice by the hotel it names — the model's pick only where the names agree; a ticket's by its flight
    const target =
      out.kind === "hotel_invoice"
        ? named && (!m.hotel || byName([named]))
          ? named.id
          : m.hotel
            ? byName(cases.hotels)
            : null
        : out.kind === "ticket_invoice"
          ? (cases.flights.find((f) => f.id === booking_id)?.id ?? ticket?.target ?? null)
          : null;
    money = { ...m, target };
  }
  return { issuer: out.issuer, stays, ticket, money };
}

/**
 * The case's live hotel and flight bookings: as the reader of an outside
 * paper is told them (names in both languages, dates, a flight's route) and as
 * our checks place by them. The paper prints the hotel in Latin, the file in
 * Arabic: the catalogue's names come too.
 */
export async function caseBookings(db: SupabaseClient, operationId: string): Promise<CaseBookings> {
  const { data } = await db
    .from("operation_bookings")
    .select("id, kind, title, city_name, start_date, end_date, detail, pnr, confirmation_number")
    .eq("operation_id", operationId)
    .in("kind", ["hotel", "flight"])
    .neq("status", "cancelled");
  type Row = { id: string; kind: "hotel" | "flight"; title: string; city_name: string; start_date: string | null; end_date: string | null; detail: Record<string, string> | null; pnr: string | null; confirmation_number: string | null };
  const rows = (data ?? []) as Row[];
  const hotelRows = rows.filter((r) => r.kind === "hotel");
  const catalog = await catalogHotelsFor<{ id: string; arabic_name: string; english_name: string | null; city_id: string | null }>(db, hotelRows, "english_name");
  const hotels = hotelRows.map((b) => {
    const hit = catalog.pick(b);
    return { id: b.id, names: [b.title, hit?.arabic_name ?? null, hit?.english_name ?? null], start_date: b.start_date, end_date: b.end_date, city: b.city_name };
  });
  const flightRows = rows.filter((r) => r.kind === "flight");
  const flights = flightRows.map((f) => ({ id: f.id, start_date: f.start_date, end_date: f.end_date, detail: f.detail, pnr: f.pnr || f.confirmation_number }));
  const context: PaperContext[] = [
    ...hotels.map((h) => ({ id: h.id, kind: "hotel" as const, name: h.names[0] ?? "", name_en: h.names[2] ?? "", city: h.city ?? "", from: h.start_date ?? "", to: h.end_date ?? "", route: "" })),
    ...flightRows.map((f) => ({
      id: f.id,
      kind: "flight" as const,
      name: f.title,
      name_en: "",
      city: "",
      from: f.start_date ?? "",
      to: f.end_date ?? "",
      route: plannedLegs(f.detail ?? {}).map((l) => `${l.from_iata}→${l.to_iata} ${l.dep_date}`).join(", "),
    })),
  ];
  return { context, hotels, flights };
}
