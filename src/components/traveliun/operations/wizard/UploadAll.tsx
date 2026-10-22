"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileUp, Loader2, X } from "lucide-react";
import { DirText } from "@/components/DirText";
import type { TranslationKey } from "@/lib/i18n";
import { readPassportPhoto } from "@/lib/data/operation-travelers";
import { hotelsOnPaper, paperSupplier, readMoney, sortPaper, type PaperSupplier, type PlacedStay, type SortedPaper } from "@/lib/data/upload-sort";
import { addBooking } from "@/lib/data/operation-bookings";
import { attachBookingInvoice, attachSupplierConfirmation, createSupplierFromInvoice, recordSupplierPayment, setBookingCost } from "@/lib/data/supplier-work";
import { assignBooking } from "@/lib/data/operation-assign";
import { recordPayment } from "@/lib/data/operations";
import { uploadPaymentProof } from "@/lib/data/operation-payments";
import { getRates } from "@/lib/data/rates-actions";
import { paidTotal } from "@/lib/operations/payments";
import { readBookingTicket, readHotelConfirmation, saveBookingTicket, saveHotelConfirmation, type HotelRead, type TicketRead } from "@/lib/data/wizard-tickets";
import { parseTicketText } from "@/lib/flights/ticket-parse";
import { trustedFields, type MrzPassport } from "@/lib/operations/mrz";
import { hotelBookings } from "@/lib/operations/wizard/hotels";
import { matchPassport, type MatchRow } from "@/lib/operations/wizard/passports";
import { matchHotel, matchTicket, placeStay, ticketInvoice, type PaperKind } from "@/lib/operations/wizard/upload-all";
import type { WizardCase } from "@/lib/operations/wizard/types";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { savePassport } from "./passport-save";
import { MoneyFieldsRow, MoneySummary, type MoneyFields } from "./UploadMoney";
import { wzPrimary, wzSecondary } from "./FlightsStep";

/** What the MRZ reader is handed — a picture. */
const READABLE = /^image\/(jpeg|png|webp)$/;
const KINDS: PaperKind[] = ["passport", "ticket", "hotel", "hotel_invoice", "ticket_invoice", "payment", "unknown"];
type MoneyKind = "hotel_invoice" | "ticket_invoice" | "payment";
const isMoney = (k: PaperKind): k is MoneyKind => k === "hotel_invoice" || k === "ticket_invoice" || k === "payment";
const NO_MONEY: MoneyFields = { money: null, amount: "", currency: "", checked: false, supplier: "", payTo: false, duplicate: false };
/** a client's slip says transfer/cash/pos/link; a supplier's payment is booked as bank_transfer/cash/card/other */
const SUPPLIER_METHOD: Record<string, string> = { transfer: "bank_transfer", cash: "cash", pos: "card", link: "other", "": "bank_transfer" };
/** Files read at once — a vision read is slow, and one slow file must not hold the rest. */
const AT_ONCE = 4;

type Item = MoneyFields & {
  key: number;
  file: File;
  /** sorting: not yet known what it is; reading: read again for the place it was moved to */
  status: "sorting" | "reading" | "ready" | "failed" | "saving" | "saved" | "dropped";
  kind: PaperKind;
  /** a traveller's id, «new» for a traveller the case lacks, or a booking's id; "" not placed */
  target: string;
  /** a ticket's or a confirmation's words, read once */
  text: string;
  /** the picture the MRZ reader reads: the file, or a PDF's first page */
  picture: File | null;
  passport: MrzPassport | null;
  ticket: TicketRead | null;
  hotel: HotelRead | null;
  /** the PNR / the hotel's number, as the employee leaves it */
  ref: string;
  /** a ticket's or a hotel paper's supplier, named on it, beside the booking's — `supplier` holds the pick */
  paperSup: PaperSupplier | null;
  /** a hotel paper's stay as read off it (an outside paper: the model's), and whether its hotel is not the file's */
  stay: PlacedStay | null;
  /** an outside paper as read off the file whole (sortPaper) — handed to the readers, never read again */
  read: SortedPaper["read"] | null;
  error?: string;
};

const fileOf = (dataUrl: string, name: string) => {
  const [head, body] = dataUrl.split(",");
  const mime = head.match(/data:([^;]+)/)?.[1] ?? "image/jpeg";
  const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return new File([bytes], name.replace(/\.pdf$/i, ".jpg"), { type: mime });
};

/**
 * «ارفع كل الملفات» (the owner, 2026-10-22): the client's passports, tickets
 * and hotel confirmations in one drop. Each file is sorted (sortPaper), read by
 * its step's own reader, and placed — a passport on its traveller
 * (matchPassport), a ticket on the flight it flies, a confirmation on its hotel
 * (upload-all.ts) — then listed for review: what was read, where it goes, ✓ or
 * «راجع». Nothing is saved before «اعتمد»; saving goes through the steps' own
 * actions, so their rules hold (only checked passport fields, never a blank
 * over a value, the server checks again), and the tiles above follow.
 */
export function UploadAll({ data, canReadMrz, canSeeCost, onClose }: { data: WizardCase; canReadMrz: boolean; canSeeCost: boolean; onClose: () => void }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const op = data.operation;
  const caseCurrency = (op.currency || "SAR").toUpperCase();
  // the system's rates (the dollar at the company's 3.80) — a slip in another currency is shown in the package's too
  const [rates, setRates] = useState<Record<string, number>>({});
  useEffect(() => {
    let live = true;
    getRates()
      .then((r) => live && setRates(r.sarPer))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  /** a payment in the package's currency, at the system's rate; null when it already is (or no rate) */
  const inCase = (amount: number, currency: string): { amount: number; rate: number } | null => {
    const cur = currency.toUpperCase();
    if (!cur || cur === caseCurrency || !rates[cur] || !rates[caseCurrency]) return null;
    const rate = Math.round((rates[cur] / rates[caseCurrency]) * 10000) / 10000;
    return { amount: Math.round(amount * rate * 100) / 100, rate };
  };
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const seq = useRef(0);
  // the case's travellers as this page knows them — savePassport keeps it current between approvals
  const rows = useRef<MatchRow[]>(data.travelers.map((r) => ({ ...r })));
  const given = useRef(new Set<string>());
  /** lines saved along with another (a passenger's ticket with its PNR's) */
  const done = useRef(new Set<number>());
  /** the tickets of one PNR on one flight booking — a PDF per passenger */
  const siblings = (item: Item) =>
    items.filter((s) => s.kind === "ticket" && s.status !== "dropped" && s.target === item.target && s.ticket && s.ref.trim().toUpperCase() === item.ref.trim().toUpperCase());
  const flights = data.bookings.filter((b) => b.kind === "flight" && b.status !== "cancelled");
  const hotels = hotelBookings(data);
  const hotelTargets = hotels.map((h) => ({ id: h.id, names: [h.title], start_date: h.start_date, end_date: h.end_date }));

  /** «أضف كفندق جديد في الملف»: the paper's hotel and dates as a booking of the file, then the line placed on it. */
  async function addStayHotel(item: Item) {
    if (!item.stay) return;
    patch(item.key, { status: "reading", error: undefined });
    const res = await addBooking({
      operation_id: op.id,
      kind: "hotel",
      title: item.stay.hotel_name,
      city_name: item.stay.city,
      start_date: item.stay.check_in || null,
      end_date: item.stay.check_out || null,
    });
    if (!res.ok) return patch(item.key, { status: "ready", error: t(res.error) });
    router.refresh();
    patch(item.key, { status: "ready", target: res.id, stay: { ...item.stay, target: res.id, other: false }, ...(await readFor({ ...item, stay: { ...item.stay, target: res.id, other: false } }, "hotel", res.id)) });
  }

  const patch = (key: number, next: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...next } : i)));

  /** A ticket or a confirmation read again for the booking it is placed on — from its words, not the file again. */
  async function readFor(item: Pick<Item, "key" | "file" | "text" | "stay" | "read">, kind: PaperKind, target: string): Promise<Partial<Item>> {
    const fd = new FormData();
    fd.append("booking_id", target);
    const given = kind === "hotel" ? item.stay : kind === "ticket" ? item.read?.ticket : null;
    if (given) fd.append(kind === "hotel" ? "stay" : "read", JSON.stringify(given));
    if (item.text) fd.append("text", item.text);
    else if (!given) fd.append("file", item.file);
    // the supplier the paper names becomes the booking's only when the booking has none — else the employee picks
    const sup = await paperSupplier(op.id, target, item.text).catch(() => null);
    const supplier = sup?.supplier && !sup.onFile ? sup.supplier.id : "";
    if (kind === "ticket") {
      const res = await readBookingTicket(fd);
      return res.ok ? { ticket: res.read, ref: res.read.pnr, error: undefined, paperSup: sup, supplier } : { ticket: null, error: t(res.error) };
    }
    const res = await readHotelConfirmation(fd);
    return res.ok ? { hotel: res.result, ref: res.result.read.confirmation, error: undefined, paperSup: sup, supplier } : { hotel: null, error: t(res.error) };
  }

  /** A flight booking whose PNR the paper prints, else the one its legs fly. */
  const flightFor = (text: string) =>
    flights.find((f) => [f.pnr, f.confirmation_number].some((ref) => ref && ref.length >= 5 && text.toUpperCase().includes(ref.toUpperCase())))?.id ??
    matchTicket(parseTicketText(text).legs, flights);

  /** A money paper's figures for the place it is put — an invoice beside the booking's cost and supplier. */
  async function moneyFor(text: string, kind: MoneyKind, target: string, read?: Item["read"]): Promise<Partial<Item>> {
    const res = await readMoney(op.id, { kind, text, ...(kind !== "payment" && target ? { booking_id: target } : {}), ...(read?.money ? { paper: read.money } : {}) });
    if (!res.ok) return { money: null, error: t(res.error) };
    const m = res.read;
    const currency = m.currency || (kind === "payment" ? caseCurrency : (m.cost?.currency ?? caseCurrency));
    const amount = m.amount ?? 0;
    const same = inCase(amount, currency)?.amount ?? amount;
    const ref = m.reference.replace(/\s+/g, "").toUpperCase();
    // the same reference, or the same amount on the same day — already recorded, so not ticked
    const duplicate =
      kind === "payment" &&
      data.payments.some((p) => (ref && (p.reference ?? "").replace(/\s+/g, "").toUpperCase() === ref) || (Math.abs(p.amount - same) < 0.01 && (!m.date || p.paid_at === m.date)));
    // the issuer becomes the booking's supplier only where it has none; a different one waits for the employee
    const supplier = m.supplier && !m.onFile ? m.supplier.id : "";
    return { money: m, amount: m.amount == null ? "" : String(m.amount), currency, supplier, payTo: false, checked: false, duplicate, error: undefined };
  }

  async function sortOne(item: Item, placed: Set<string>) {
    const fd = new FormData();
    fd.append("file", item.file);
    const sorted = await sortPaper(op.id, fd);
    if (!sorted.ok) return patch(item.key, { status: "failed", error: t(sorted.error) });
    const { kind, text, image } = sorted.paper;
    const read = sorted.paper.read ?? null;
    if (kind === "passport") {
      const picture = image ? fileOf(image, item.file.name) : item.file;
      let passport: MrzPassport | null = null;
      let error: string | undefined;
      if (canReadMrz && READABLE.test(picture.type)) {
        const pd = new FormData();
        pd.append("file", picture);
        const read = await readPassportPhoto(op.id, pd);
        if (read.ok) passport = read.passport;
        else error = t(read.error);
      }
      const row = passport ? matchPassport(rows.current, trustedFields(passport, data.today).values, op, data.today, placed) : null;
      const target = row?.id ?? (passport ? "new" : (rows.current.find((r) => !placed.has(r.id) && !r.has_passport)?.id ?? "new"));
      if (target !== "new") placed.add(target);
      return patch(item.key, { status: "ready", kind, picture, passport, target, error });
    }
    if (kind === "unknown") return patch(item.key, { status: "ready", kind, text, read });
    if (isMoney(kind)) {
      // cost is pricing.internal's: an invoice is sorted, never read, without it
      if (kind !== "payment" && !canSeeCost) return patch(item.key, { status: "ready", kind, text, read, error: t("wz.up.err.costOnly") });
      if (kind === "payment") return patch(item.key, { status: "ready", kind, text, read, target: "case", ...(await moneyFor(text, kind, "case", read)) });
      // read off the file whole: placed by the hotel or the flight it names, checked on the server (placeOutside)
      if (read?.money) {
        const target = read.money.target ?? "";
        return patch(item.key, { status: "ready", kind, text, read, target, ...(await moneyFor(text, kind, target, read)) });
      }
      // read first: an invoice naming a hotel is that hotel's, whatever its words looked like (the owner's
      // «Smart Booking» invoice for Tanadewa went to the flight) — placed by the hotel's name, never by a guess
      const first = await moneyFor(text, kind, "");
      const hotel = first.money?.hotel?.trim();
      const as: MoneyKind = hotel ? "hotel_invoice" : kind;
      const target = as === "hotel_invoice" ? (hotel ? (placeStay({ hotel_name: hotel, check_in: "", check_out: "" }, hotelTargets).target ?? "") : (matchHotel(text, hotels) ?? "")) : (flightFor(text) ?? "");
      return patch(item.key, { status: "ready", kind: as, text, target, ...(target ? await moneyFor(text, as, target) : first) });
    }
    if (kind === "hotel") {
      // each stay on the paper (a TBO itinerary holds several), each on its own booking by the hotel's name —
      // a stay of a hotel the file does not have stays unplaced, offered as a new hotel of the file
      const { stays } = read ? read : await hotelsOnPaper(op.id, text);
      if (stays.length === 0) {
        const target = matchHotel(text, hotels) ?? "";
        return patch(item.key, { status: "ready", kind, text, target, ...(target ? await readFor({ ...item, text }, kind, target) : {}) });
      }
      const lines = stays.map((stay, i) => ({ ...item, key: i === 0 ? item.key : seq.current++, kind, status: "reading" as const, text, stay, read }));
      if (lines.length > 1) setItems((list) => [...list, ...lines.slice(1)]);
      for (const one of lines) {
        const target = one.stay.target ?? "";
        patch(one.key, { status: "ready", kind, text, stay: one.stay, read, target, ...(target ? await readFor(one, kind, target) : {}) });
      }
      return;
    }
    let target: string;
    if (read?.ticket) {
      // read off the file whole: placed by its booking, its PNR or the flights it flies (placeOutside) — a ticket of
      // flights the file does not hold waits for the employee
      target = read.ticket.target ?? "";
      patch(item.key, { status: "ready", kind, text, read, target, ref: read.ticket.pnr, ...(target ? await readFor({ ...item, text, read }, kind, target) : {}) });
    } else {
      // our own ticket, or no model: read first, then placed by its PNR or the flights it flies
      const byPnr = flights.find((f) => [f.pnr, f.confirmation_number].some((ref) => ref && ref.length >= 5 && text.toUpperCase().includes(ref.toUpperCase())))?.id;
      if (flights.length === 0) return patch(item.key, { status: "ready", kind, text });
      const got = await readFor({ ...item, text }, kind, byPnr ?? flights[0].id);
      target = byPnr ?? matchTicket(got.ticket?.legs ?? [], flights) ?? "";
      patch(item.key, { status: "ready", kind, text, target, ...got });
    }
    // an e-ticket's PDF with its invoice in it: the invoice is a line of its own (cost — pricing.internal)
    if (kind === "ticket" && canSeeCost && ticketInvoice(text)) {
      const extra: Item = { ...item, key: seq.current++, kind: "ticket_invoice", status: "ready", text, target, ...NO_MONEY };
      setItems((list) => [...list, extra]);
      if (target) patch(extra.key, await moneyFor(text, "ticket_invoice", target));
    }
  }

  function add(files: File[]) {
    if (!files.length) return;
    const fresh: Item[] = files.map((file) => ({ key: seq.current++, file, status: "sorting", kind: "unknown", target: "", text: "", picture: null, passport: null, ticket: null, hotel: null, ref: "", paperSup: null, stay: null, read: null, ...NO_MONEY }));
    setItems((list) => [...list, ...fresh]);
    setBusy(true);
    const queue = [...fresh];
    // the travellers already given a passport in this drop — one passport each
    const placed = new Set(items.filter((i) => i.kind === "passport" && i.target && i.target !== "new" && i.status !== "dropped").map((i) => i.target));
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        // one bad file never stops the others
        await sortOne(next, placed).catch(() => patch(next.key, { status: "failed", error: t("wz.up.err.unreadable") }));
      }
    };
    void Promise.all(Array.from({ length: AT_ONCE }, worker)).then(() => setBusy(false));
  }

  async function place(item: Item, value: string) {
    const [kind, target] = value.split(":") as [PaperKind, string];
    // a file that failed to sort is placed by hand too
    patch(item.key, { kind, target, ticket: null, hotel: null, paperSup: null, ...NO_MONEY, error: undefined, status: "ready" });
    if (isMoney(kind)) {
      patch(item.key, { status: "reading" });
      patch(item.key, { status: "ready", ...(await moneyFor(item.text, kind, target)) });
    } else if (kind === "ticket" || kind === "hotel") {
      patch(item.key, { status: "reading" });
      patch(item.key, { status: "ready", ...(await readFor(item, kind, target)) });
    } else if (kind === "passport" && !item.passport && canReadMrz && READABLE.test((item.picture ?? item.file).type)) {
      // a paper sorted wrong, placed as a passport: read by the passport's own reader now
      patch(item.key, { status: "reading" });
      const fd = new FormData();
      fd.append("file", item.picture ?? item.file);
      const read = await readPassportPhoto(op.id, fd);
      patch(item.key, read.ok ? { status: "ready", passport: read.passport } : { status: "ready", error: t(read.error) });
    }
  }

  async function approve(item: Item): Promise<boolean> {
    patch(item.key, { status: "saving", error: undefined });
    let error: TranslationKey | undefined;
    if (item.kind === "passport") {
      const fd = new FormData();
      fd.append("file", item.picture ?? item.file);
      const row = item.target === "new" ? null : (rows.current.find((r) => r.id === item.target) ?? null);
      const out = await savePassport({ operationId: op.id, rows: rows.current, taken: given.current, row, read: item.passport, fd, today: data.today, travelStart: op.travel_start });
      error = out.error;
    } else if (item.kind === "ticket" && item.ticket) {
      const pnr = item.ref.trim().toUpperCase();
      // the airlines send one PDF per passenger under one PNR: one booking, every passenger's number added to
      // what it already holds — never a later paper taking the earlier one's place
      const twins = siblings(item);
      const booking = flights.find((f) => f.id === item.target);
      const res = await saveBookingTicket({
        booking_id: item.target,
        pnr,
        ticket_numbers: [...new Set([...(booking?.ticket_numbers ?? []), ...twins.flatMap((s) => s.ticket?.ticket_numbers ?? [])])],
        legs: item.ticket.legs.map((l) => ({ ...l, pnr: l.pnr?.trim().toUpperCase() === pnr ? "" : l.pnr })),
        baggage: item.ticket.baggage,
      });
      if (!res.ok) error = res.error;
      else {
        // the airline's own paper is the booking's confirmation file — «عرض ملف التأكيد» opens it
        const fd = new FormData();
        fd.append("booking_ids", item.target);
        fd.append("file", item.file);
        await attachSupplierConfirmation(fd).catch(() => null);
        for (const s of twins) if (s.key !== item.key) {
          done.current.add(s.key);
          patch(s.key, { status: "saved" });
        }
      }
    } else if (item.kind === "hotel" && item.hotel) {
      const fd = new FormData();
      fd.append("booking_id", item.target);
      fd.append("confirmation_number", item.ref.trim());
      fd.append("file", item.file);
      // the hotel's address and phone are not filled from here: unseen in this list, and a paper's header
      // phone may be the issuer's (ours, on a voucher of ours) — «الفنادق» shows them before it fills
      const res = await saveHotelConfirmation(fd);
      if (!res.ok) error = res.error;
    } else if (isMoney(item.kind) && item.money) {
      error = await saveMoney(item);
    } else error = "wz.up.err.unplaced";
    // the supplier the paper names, when the employee kept it on the line
    if (!error && (item.kind === "ticket" || item.kind === "hotel") && item.supplier && item.supplier !== item.paperSup?.onFile?.id) {
      const res = await assignBooking({ booking_id: item.target, kind: "supplier", assignee_id: item.supplier });
      if (!res.ok) error = res.error;
    }
    patch(item.key, error ? { status: "ready", error: t(error) } : { status: "saved" });
    return !error;
  }

  /**
   * A money line, through the money screens' own actions: an invoice sets the
   * booking's supplier (made from the paper only when ticked «new»), its cost
   * and its filed invoice, and — when ticked — the payment to that supplier; a
   * client's slip becomes a payment in the package's currency, its photo kept.
   */
  async function saveMoney(item: Item): Promise<TranslationKey | undefined> {
    const m = item.money!;
    const amount = Number(item.amount);
    const currency = item.currency.trim().toUpperCase() || caseCurrency;
    const fd = new FormData();
    fd.append("file", item.file);
    if (item.kind === "payment") {
      const converted = inCase(amount, currency);
      const paidBefore = paidTotal(data.payments);
      const value = converted?.amount ?? amount;
      const left = op.total == null ? null : op.total - paidBefore - value;
      const res = await recordPayment({
        operation_id: op.id,
        amount: value,
        currency: caseCurrency,
        kind: left != null && left <= 0.01 ? "final" : paidBefore > 0 ? "installment" : "deposit",
        method: m.method || null,
        reference: m.reference || null,
        paid_at: m.date || data.today,
        note: converted ? `${amount} ${currency} × ${converted.rate}` : null,
      });
      if (!res.ok) return res.error;
      const up = await uploadPaymentProof(res.id, fd).catch(() => null);
      return up?.ok ? undefined : "ops.pay.proofUploadFailed";
    }
    let supplierId = item.supplier === "new" ? "" : item.supplier;
    if (item.supplier === "new") {
      const made = await createSupplierFromInvoice({ name: m.issuer, category: item.kind === "hotel_invoice" ? "فنادق" : "طيران" });
      if (!made.ok) return made.error;
      supplierId = made.id;
    }
    if (supplierId && supplierId !== m.onFile?.id) {
      const res = await assignBooking({ booking_id: item.target, kind: "supplier", assignee_id: supplierId });
      if (!res.ok) return res.error;
    }
    const cost = await setBookingCost({ booking_id: item.target, amount, currency });
    if (!cost.ok) return cost.error;
    const bd = new FormData();
    bd.append("booking_id", item.target);
    bd.append("file", item.file);
    const filed = await attachBookingInvoice(bd);
    if (!filed.ok) return filed.error;
    if (item.payTo) {
      const payee = supplierId || m.onFile?.id;
      if (!payee) return "wz.up.err.supplier";
      const pd = new FormData();
      for (const [k, v] of Object.entries({
        supplier_id: payee,
        operation_id: op.id,
        booking_ids: item.target,
        amount: String(amount),
        currency,
        paid_on: m.date || data.today,
        method: SUPPLIER_METHOD[m.method] ?? "bank_transfer",
        reference: m.reference,
      }))
        pd.append(k, v);
      pd.append("file", item.file);
      const paid = await recordSupplierPayment(pd);
      if (!paid.ok) return paid.error;
    }
    return undefined;
  }

  async function approveAll(list: Item[]) {
    setBusy(true);
    // a ticket's twins are saved with it
    for (const item of list) if (!done.current.has(item.key)) await approve(item);
    setBusy(false);
    router.refresh();
  }

  const reading = items.filter((i) => i.status === "sorting").length;
  const ready = items.filter((i) => i.status === "ready" && canApprove(i));

  // every place a paper can go, by kind — the picker beside each line
  const places: { kind: PaperKind; options: { value: string; label: string }[] }[] = [
    {
      kind: "passport",
      options: [
        ...data.travelers.map((r, i) => ({ value: `passport:${r.id}`, label: r.display_name.trim() || t("wz.up.traveler", { n: i + 1 }) })),
        { value: "passport:new", label: t("wz.up.newTraveler") },
      ],
    },
    { kind: "ticket", options: flights.map((f) => ({ value: `ticket:${f.id}`, label: `${f.title} · ${f.start_date ?? "—"}` })) },
    { kind: "hotel", options: hotels.map((h) => ({ value: `hotel:${h.id}`, label: `${h.city_name || "—"} · ${h.title} · ${h.start_date ?? "—"}` })) },
    // an invoice is cost: offered only to pricing.internal
    ...(canSeeCost
      ? [
          { kind: "hotel_invoice" as const, options: hotels.map((h) => ({ value: `hotel_invoice:${h.id}`, label: `${h.city_name || "—"} · ${h.title}` })) },
          { kind: "ticket_invoice" as const, options: flights.map((f) => ({ value: `ticket_invoice:${f.id}`, label: f.title })) },
        ]
      : []),
    { kind: "payment", options: [{ value: "payment:case", label: t("wz.up.money.toCase") }] },
  ];
  const payments = items.filter((i) => i.kind === "payment" && i.status !== "dropped" && i.status !== "saved" && i.checked && Number(i.amount) > 0);
  const ticked = payments.reduce((sum, i) => sum + (inCase(Number(i.amount), i.currency)?.amount ?? Number(i.amount)), 0);

  return (
    <section className="rounded-2xl border border-[#cfe0d9] bg-white p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="text-[14px] font-extrabold text-[#185045]">{t("wz.up.title")}</h2>
          <p className="mt-0.5 text-[11.5px] font-semibold text-[#93aaa3]">{t("wz.up.hint")}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={t("wz.up.close")} className="inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] text-[#557d78] hover:bg-[#f0f5f3]">
          <X className="size-4" />
        </button>
      </div>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          add([...e.dataTransfer.files]);
        }}
        className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-[14px] border-2 border-dashed px-4 py-6 text-center ${over ? "border-[#2aa87a] bg-[#eef8f3]" : "border-[#b7d0c7] bg-[#f8fbf9] hover:bg-[#f0f7f4]"}`}
      >
        {reading ? <Loader2 className="size-6 animate-spin text-[#185045]" /> : <FileUp className="size-6 text-[#185045]" />}
        <span className="text-[13.5px] font-extrabold text-[#185045]">
          {reading ? t("wz.up.reading", { done: items.length - reading, of: items.length }) : t("wz.up.drop")}
        </span>
        <span className="text-[11.5px] font-semibold text-[#93aaa3]">{t("wz.up.types")}</span>
        <input
          type="file"
          multiple
          accept="application/pdf,.pdf,image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            add(files);
          }}
        />
      </label>

      {items.length > 0 ? (
        <div className="mt-3 grid gap-3">
          {/* «إجمالي البكج · سدّد العميل · المتبقي» — before and after the payments ticked here */}
          <MoneySummary total={op.total} paid={paidTotal(data.payments)} ticked={Math.round(ticked * 100) / 100} currency={caseCurrency} />
          {KINDS.map((kind) => {
            const group = items.filter((i) => i.kind === kind && i.status !== "dropped" && i.status !== "sorting");
            return group.length ? (
              <div key={kind}>
                <h3 className="mb-1.5 text-[12px] font-extrabold text-[#557d78]">
                  {t(`wz.up.group.${kind}` as TranslationKey)} · <DirText>{String(group.length)}</DirText>
                </h3>
                <ul className="grid gap-1.5">
                  {group.map((item) => (
                    <Line
                      key={item.key}
                      item={item}
                      groupMissing={item.kind === "ticket" && item.ticket ? siblings(item).reduce<string[]>((acc, s) => acc.filter((m) => s.ticket?.missing.includes(m)), item.ticket.missing) : []}
                      today={data.today}
                      caseCurrency={caseCurrency}
                      inCase={item.kind === "payment" ? inCase(Number(item.amount), item.currency) : null}
                      onMoney={(next) => patch(item.key, next)}
                      onAddHotel={() => void addStayHotel(item)}
                      places={places} onPlace={(v) => void place(item, v)} onRef={(ref) => patch(item.key, { ref })} onApprove={() => void approve(item).then((ok) => ok && router.refresh())} onDrop={() => patch(item.key, { status: "dropped" })} />
                  ))}
                </ul>
              </div>
            ) : null;
          })}
          {reading ? (
            <p className="flex items-center gap-1.5 text-[11.5px] font-bold text-[#557d78]">
              <Loader2 className="size-3.5 animate-spin" />
              {items
                .filter((i) => i.status === "sorting")
                .map((i) => i.file.name)
                .join("، ")}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy || ready.length === 0} onClick={() => void approveAll(ready)} className={wzPrimary}>
              {busy && !reading ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
              {t("wz.up.approveAll", { n: ready.length })}
            </button>
            {items.length > 0 && items.every((i) => i.status === "saved" || i.status === "dropped") ? (
              <span className="text-[12px] font-bold text-[#0f7a52]">{t("wz.up.allDone")}</span>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** Ready to save: placed, and — a ticket or a hotel — read for that place. */
function canApprove(i: Item): boolean {
  if (!i.target) return false;
  if (i.kind === "passport") return true;
  if (i.kind === "ticket") return Boolean(i.ticket && i.ref.trim());
  if (i.kind === "hotel") return Boolean(i.hotel && i.ref.trim());
  // a money line: read, a positive amount, and the employee's own «تحقّقت»
  if (isMoney(i.kind)) return Boolean(i.money && i.checked && Number(i.amount) > 0);
  return false;
}

/** ✓ when what was read checks out; «راجع» when a check digit failed, a name or a date differs, or something is missing. */
function verdict(i: Item, today: string, field: (f: string) => string): { ok: boolean; note: string[] } {
  if (i.kind === "passport") {
    if (!i.passport) return { ok: false, note: [] };
    const { missing } = trustedFields(i.passport, today);
    return { ok: missing.length === 0 && i.passport.failed.length === 0, note: [...new Set<string>([...i.passport.failed, ...missing])].map(field) };
  }
  if (i.kind === "ticket" && i.ticket) {
    const off = i.ticket.names.filter((n) => n.status !== "ok").map((n) => n.name);
    return { ok: off.length === 0 && i.ticket.missing.length === 0 && i.ticket.legs.length > 0 && Boolean(i.ref.trim()), note: [...off, ...i.ticket.missing] };
  }
  if (i.kind === "hotel" && i.hotel) return { ok: i.hotel.diffs.length === 0 && Boolean(i.ref.trim()), note: i.hotel.diffs.map((d) => d.theirs) };
  if (isMoney(i.kind) && i.money) return { ok: i.checked && !i.duplicate, note: [] };
  return { ok: false, note: [] };
}

function Line({
  item,
  onAddHotel,
  groupMissing,
  today,
  caseCurrency,
  inCase,
  onMoney,
  places,
  onPlace,
  onRef,
  onApprove,
  onDrop,
}: {
  item: Item;
  /** «أضف كفندق جديد في الملف» for a stay of a hotel the file does not have */
  onAddHotel: () => void;
  /** a ticket's travellers no paper of its PNR names — one PDF per passenger names one each */
  groupMissing: string[];
  today: string;
  caseCurrency: string;
  inCase: { amount: number; rate: number } | null;
  onMoney: (next: Partial<MoneyFields>) => void;
  places: { kind: PaperKind; options: { value: string; label: string }[] }[];
  onPlace: (value: string) => void;
  onRef: (ref: string) => void;
  onApprove: () => void;
  onDrop: () => void;
}) {
  const { t } = useTraveliunUI();
  const { ok, note } = verdict(item.kind === "ticket" && item.ticket ? { ...item, ticket: { ...item.ticket, missing: groupMissing } } : item, today, (f) => t(`wz.up.field.${f}` as TranslationKey));
  const sup = item.paperSup;
  const saved = item.status === "saved";
  const working = item.status === "saving" || item.status === "reading";
  const read =
    item.kind === "passport"
      ? item.passport
        ? item.passport.full_name
        : t("wz.up.passport.unread")
      : item.kind === "ticket" && item.ticket
        ? item.ticket.legs.map((l) => `${l.flight_no} ${l.from_iata}→${l.to_iata} ${l.dep_date}`).join(" · ")
        : item.kind === "hotel" && item.hotel
          ? `${item.hotel.read.check_in || "—"} → ${item.hotel.read.check_out || "—"}`
          : isMoney(item.kind) && item.money
            ? [item.money.issuer || item.money.sender, item.money.hotel].filter(Boolean).join(" · ")
            : "";
  return (
    <li className={`rounded-[12px] border p-2.5 ${saved ? "border-[#cfe9dc] bg-[#f3faf6]" : "border-[#e2ebe7] bg-white"}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-bold">
        {saved ? (
          <CheckCircle2 className="size-4 shrink-0 text-[#0f7a52]" />
        ) : working ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-[#557d78]" />
        ) : item.status === "failed" ? (
          <AlertTriangle className="size-4 shrink-0 text-[#c22850]" />
        ) : ok ? (
          <span className="rounded-full bg-[#e9f7f0] px-2 py-0.5 text-[10.5px] text-[#0f7a52]">✓</span>
        ) : (
          <span className="rounded-full bg-[#fff4e0] px-2 py-0.5 text-[10.5px] text-[#a86a10]">{t("wz.up.review")}</span>
        )}
        <span className="min-w-0 break-all text-[#185045]">{item.file.name}</span>
        {read ? (
          <DirText dir="auto" className="tv-tnum min-w-0 break-words font-semibold text-[#557d78]">
            {read}
          </DirText>
        ) : null}
      </div>

      {saved ? null : (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {/* where it goes — any place of any kind: a paper sorted wrong is moved here */}
            <select
              value={item.target ? `${item.kind}:${item.target}` : ""}
              disabled={working}
              onChange={(e) => e.target.value && onPlace(e.target.value)}
              className={`h-9 w-0 min-w-[10rem] flex-1 rounded-[9px] border bg-white px-2 text-[12px] font-bold text-[#185045] ${item.target ? "border-[#dbe6e1]" : "border-[#f0d9a8] bg-[#fffaf0]"}`}
            >
              <option value="">{t("wz.up.unplaced")}</option>
              {places.map((g) =>
                g.options.length ? (
                  <optgroup key={g.kind} label={t(`wz.up.group.${g.kind}` as TranslationKey)}>
                    {g.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </optgroup>
                ) : null,
              )}
            </select>
            {item.kind === "ticket" || item.kind === "hotel" ? (
              <input
                value={item.ref}
                onChange={(e) => onRef(e.target.value)}
                disabled={working}
                placeholder={t(item.kind === "ticket" ? "wz.up.pnr" : "wz.hotels.number")}
                aria-label={t(item.kind === "ticket" ? "wz.up.pnr" : "wz.hotels.number")}
                dir="ltr"
                className="tv-tnum h-9 w-36 rounded-[9px] border border-[#dbe6e1] bg-white px-2 text-[12px] font-bold text-[#185045]"
              />
            ) : null}
          </div>
          {item.kind === "hotel" && item.stay?.other && !item.target ? (
            // a paper of a hotel the file does not have: said, never put on the file's only hotel
            <p className="flex flex-wrap items-center gap-2 text-[11.5px] font-bold text-[#a86a10] sm:col-span-2">
              {t("wz.up.otherHotel", { name: item.stay.hotel_name })}
              {[item.stay.check_in, item.stay.check_out].filter(Boolean).length ? <DirText className="tv-tnum">{`${item.stay.check_in || "—"} → ${item.stay.check_out || "—"}`}</DirText> : null}
              <button type="button" disabled={working} onClick={onAddHotel} className="inline-flex h-8 items-center rounded-[8px] border border-[#cfe0d9] bg-white px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f0f7f4]">
                {t("wz.up.addHotel")}
              </button>
            </p>
          ) : null}
          {(item.kind === "ticket" || item.kind === "hotel") && sup?.supplier && sup.supplier.id !== sup.onFile?.id ? (
            // the supplier the paper names, beside the file's — the employee picks (never replaced by itself)
            <label className="flex flex-wrap items-center gap-2 text-[11.5px] font-semibold text-[#557d78] sm:col-span-2">
              {t("wz.up.money.supplierOnFile")}: {sup.onFile?.name ?? "—"} · {t("wz.up.paperSupplier")}: {sup.supplier.name}
              <select value={item.supplier} onChange={(e) => onMoney({ supplier: e.target.value })} disabled={working} className="h-8 rounded-[8px] border border-[#dbe6e1] bg-white px-2 text-[12px] font-bold text-[#185045]">
                <option value="">{sup.onFile ? t("wz.up.money.keep", { name: sup.onFile.name }) : t("wz.up.money.noSupplier")}</option>
                <option value={sup.supplier.id}>{t("wz.up.money.use", { name: sup.supplier.name })}</option>
              </select>
            </label>
          ) : null}
          {isMoney(item.kind) ? (
            <div className="sm:col-span-2">
              <MoneyFieldsRow kind={item.kind} fields={item} caseCurrency={caseCurrency} inCase={inCase} onChange={onMoney} disabled={working} />
            </div>
          ) : null}
          <div className="flex gap-2">
            <button type="button" disabled={working || !canApprove(item)} onClick={onApprove} className={`${wzPrimary} h-9`}>
              {t("wz.up.approve")}
            </button>
            <button type="button" disabled={working} onClick={onDrop} className={`${wzSecondary} h-9`}>
              {t("wz.up.remove")}
            </button>
          </div>
        </div>
      )}
      {note.length && !saved ? (
        <p className="mt-1.5 break-words text-[11px] font-semibold text-[#a86a10]">
          {t("wz.up.check")}: <DirText dir="auto">{note.join("، ")}</DirText>
        </p>
      ) : null}
      {item.error ? <p className="mt-1.5 text-[11.5px] font-bold text-[#c22850]">{item.error}</p> : null}
    </li>
  );
}
