/**
 * The ONE order a repackage's supplier gets once the client confirmed — every
 * detail they need to hold the package: our reference, the guest to contact, the
 * travellers, the dates and nights, the stays (city, hotel, room, meals), the
 * flights / transfers / visas, what the price includes and leaves out, any
 * special note — and what we pay THEM.
 *
 * Two lines are never here, by construction (the function reads neither):
 *   - what the CLIENT pays — `final_total`, an addition's `sell_price`;
 *   - our profit.
 * The price in the message is the supplier's own figure (`supplier_total`), the
 * one their offer named. The client's name and phone are the guest's contact, the
 * only personal data an order needs; no passport, no number, no client price.
 *
 * Returned for REVIEW — nothing here sends. Pure: no React, no Supabase.
 */

import type { BoardType } from "@/lib/types";
import { packageNights, packageStays, printableAdditions, type RepackageData } from "./repackage-types";

export type OrderLang = "ar" | "en";
export type OrderTraveler = { name: string; kind: "adult" | "child" | "infant" };

export type SupplierOrderInput = {
  lang: OrderLang;
  /** our file number — the offer serial — so their answer can be matched. */
  reference: string;
  /** the person it is addressed to. */
  contact: string | null;
  data: RepackageData;
  /** the case's travellers when it holds names (display names only); empty → counts only. */
  travelers?: OrderTraveler[];
  /** the clerk's own words, never translated. */
  note?: string | null;
};

const TEXT = {
  ar: {
    title: "طلب تأكيد باقة",
    company: "ترافليون للسفر والسياحة",
    greet: (to: string | null) => (to ? `السلام عليكم ${to}،` : "السلام عليكم،"),
    intro: "أكّد عميلنا الباقة التي عرضتموها علينا. نرجو تأكيد حجزها بالتفاصيل التالية، وإرسال رقم التأكيد وسياسة الإلغاء.",
    reference: "مرجعنا",
    guest: "العميل (للتواصل)",
    destination: "الوجهة",
    dates: "التواريخ",
    nights: "ليالٍ",
    pax: "المسافرون",
    adults: "بالغ",
    children: "طفل",
    infants: "رضيع",
    names: "الأسماء",
    namesLater: "الأسماء تُرسل لاحقاً",
    stays: "الإقامة",
    checkIn: "من",
    checkOut: "إلى",
    flights: "الطيران",
    transfers: "المواصلات",
    visas: "التأشيرات",
    includes: "يشمل",
    excludes: "لا يشمل",
    ours: "للعلم — خدمات إضافية يرتّبها طرفنا خارج باقتكم",
    price: "المبلغ المستحق لكم",
    note: "ملاحظة",
    thanks: "شكراً لكم،",
    sign: "قسم العمليات — ترافليون",
    kind: { adult: "بالغ", child: "طفل", infant: "رضيع" },
    board: { RO: "غرفة فقط", BB: "شامل الإفطار", HB: "نصف إقامة", FB: "إقامة كاملة", AI: "شامل كليًا" } as Record<BoardType, string>,
  },
  en: {
    title: "Package confirmation request",
    company: "Traveliun Travel & Tourism",
    greet: (to: string | null) => (to ? `Dear ${to},` : "Dear team,"),
    intro: "Our client has confirmed the package you offered us. Please confirm the booking with the details below, with your confirmation number and cancellation policy.",
    reference: "Our reference",
    guest: "Guest (contact)",
    destination: "Destination",
    dates: "Dates",
    nights: "nights",
    pax: "Travellers",
    adults: "adults",
    children: "children",
    infants: "infants",
    names: "Names",
    namesLater: "Names to follow",
    stays: "Accommodation",
    checkIn: "from",
    checkOut: "to",
    flights: "Flights",
    transfers: "Transfers",
    visas: "Visas",
    includes: "Included",
    excludes: "Not included",
    ours: "For your information — extra services we arrange ourselves, outside your package",
    price: "Amount payable to you",
    note: "Note",
    thanks: "Thank you,",
    sign: "Operations — Traveliun",
    kind: { adult: "adult", child: "child", infant: "infant" },
    board: { RO: "Room only", BB: "Bed & breakfast", HB: "Half board", FB: "Full board", AI: "All inclusive" } as Record<BoardType, string>,
  },
} as const;

const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

export function buildSupplierOrder(input: SupplierOrderInput): { subject: string; body: string } {
  const L = TEXT[input.lang];
  const { data } = input;
  const pkg = data.extracted;
  const section = (title: string, lines: string[]) => (lines.length > 0 ? ["", `${title}:`, ...lines] : []);

  const guest = [data.customer.customer_name.trim(), data.customer.customer_phone.trim()].filter(Boolean).join(" — ");
  const nights = pkg ? packageNights(pkg) : 0;
  const first = pkg?.arrival_date ?? null;
  const last = pkg ? (packageStays(pkg).at(-1)?.check_out ?? pkg.departure_date) : null;

  const stays = pkg
    ? packageStays(pkg).map((s, i) => {
        const hotel = s.hotel?.hotel_name.trim() || "—";
        const room = s.hotel?.room_type.trim();
        const board = s.board_type ? L.board[s.board_type] : "";
        const span = s.check_in ? ` (${L.checkIn} ${s.check_in}${s.check_out ? ` ${L.checkOut} ${s.check_out}` : ""})` : "";
        return `${i + 1}. ${[s.city_name.trim(), hotel, room, board].filter(Boolean).join(" — ")} — ${s.nights} ${L.nights}${span}`;
      })
    : [];

  // a flight the agent added to the package is ours to book, not the supplier's — never in his order
  const flights = (pkg?.flights ?? []).filter((f) => f.added !== true).map((f) => {
    const route = [f.from_airport, f.to_airport].filter(Boolean).join(" → ");
    const when = f.departure_at ? f.departure_at.replace("T", " ").slice(0, 16) : "";
    return `• ${[f.airline, f.flight_no].filter(Boolean).join(" ")}${route ? ` ${route}` : ""}${when ? ` — ${when}` : ""}`.trim();
  });

  const travelers = (input.travelers ?? []).filter((t) => t.name.trim());
  const pax = [
    pkg && pkg.adults > 0 ? `${pkg.adults} ${L.adults}` : null,
    pkg && pkg.children > 0 ? `${pkg.children} ${L.children}` : null,
    pkg && pkg.infants > 0 ? `${pkg.infants} ${L.infants}` : null,
  ].filter(Boolean);

  const cost = pkg?.supplier_total != null ? `${money(pkg.supplier_total)} ${pkg.supplier_currency}` : null;
  const reference = input.reference || "—";

  const body = [
    `${L.title} — ${L.company}`,
    "",
    L.greet(input.contact?.trim() || null),
    L.intro,
    "",
    `${L.reference}: ${reference}`,
    guest ? `${L.guest}: ${guest}` : null,
    pkg && (pkg.destination || pkg.country) ? `${L.destination}: ${pkg.destination || pkg.country}` : null,
    first ? `${L.dates}: ${first}${last ? ` → ${last}` : ""}${nights > 0 ? ` (${nights} ${L.nights})` : ""}` : null,
    pax.length > 0 ? `${L.pax}: ${pax.join(input.lang === "ar" ? "، " : ", ")}` : null,
    `${L.names}:`,
    ...(travelers.length > 0 ? travelers.map((t, i) => `${i + 1}. ${t.name.trim()} (${L.kind[t.kind]})`) : [L.namesLater]),
    ...section(L.stays, stays),
    ...section(L.flights, flights),
    ...section(L.transfers, (pkg?.transfers ?? []).map((x) => `• ${x}`)),
    ...section(L.visas, (pkg?.visas ?? []).map((x) => `• ${x}`)),
    ...section(L.includes, (pkg?.includes ?? []).map((x) => `• ${x}`)),
    ...section(L.excludes, (pkg?.excludes ?? []).map((x) => `• ${x}`)),
    // what we sell ourselves is said without a price — they need to know it is not theirs to provide
    ...section(
      L.ours,
      printableAdditions(data).map((a) => `• ${a.title.trim()}`),
    ),
    cost ? "" : null,
    cost ? `${L.price}: ${cost}` : null,
    input.note?.trim() ? `\n${L.note}: ${input.note.trim()}` : null,
    "",
    L.thanks,
    L.sign,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  const where = pkg ? pkg.destination || pkg.country : "";
  return { subject: `${L.title} ${reference}${where ? ` — ${where}` : ""}`, body };
}
