import type { ReactNode } from "react";
import { AR, fmtDate } from "./labels";
import { TRAVELIUN_BRAND, type DocBrand } from "./brand";
import { OFFER_DOC_CSS } from "./styles";
import { DEFAULT_OFFER_DOC_ASSETS, type OfferDocAssets } from "./assets";
import type { VoucherBooking, VoucherDTO, VoucherKind } from "@/lib/operations/voucher-dto";
// the country's name, not «SAU» (the owner, 2026-10-22) — said at print time, so issued snapshots get it too
import { nationalityName } from "@/lib/operations/nationality";

/**
 * The operational documents — hotel voucher, flight ticket, itinerary, booking
 * summary — in the Traveliun identity.
 *
 * It reuses OFFER_DOC_CSS, the document brand and the label formatters rather than styling
 * itself, which is what makes a voucher look like it came from the same company
 * as the offer. It does NOT reuse OfferDocument's block packer: that machinery
 * exists to fill A4 sheets with eight heterogeneous sections, and a voucher has
 * three fixed ones. Travelers chunk twelve to a page with a plain slice.
 *
 * Server-safe (no hooks), so renderDocHtml can print it with the same fonts and
 * the same zero-margin sheet handling as the sales PDF.
 */

// «فوتشر» is what the Gulf trade actually calls this, on both sides of the desk.
// «قسيمة» is a translation nobody uses, and a document titled in words the hotel
// does not recognise is a document the guest has to explain.
const KIND_TITLE: Record<VoucherKind, string> = {
  hotel_voucher: "فوتشر الفنادق",
  flight_ticket: "تذكرة الطيران",
  itinerary: "الجدول السياحي",
  booking_summary: "ملخص الحجوزات",
  // Never rendered by THIS component — a welcome board has its own document and
  // its own route. The entry exists because VoucherKind is exhaustive, which is
  // exactly how the compiler told us this file needed looking at.
  welcome_board: "لوحة الاستقبال",
};

const KIND_NOTE: Record<VoucherKind, string> = {
  hotel_voucher: "يُقدَّم هذا الفوتشر عند الوصول إلى الفندق مع إثبات هوية كل نزيل.",
  flight_ticket: "يُرجى الحضور إلى المطار قبل موعد الإقلاع بثلاث ساعات للرحلات الدولية. تُراجَع مواعيد الرحلات مع شركة الطيران قبل السفر بـ٢٤ ساعة.",
  itinerary: "المواعيد استرشادية وقد تتغيّر حسب حركة السير والطقس.",
  booking_summary: "ملخص داخلي لكل ما تم حجزه ضمن هذا البرنامج.",
  welcome_board: "",
};

const TRAVELERS_PER_PAGE = 12;
/** Booking blocks per sheet: two under the cover's header, three on a sheet of their own. */
const BOOKINGS_ON_COVER = 2;
const BOOKINGS_PER_PAGE = 3;
/** Itinerary rows per sheet. */
const DAYS_ON_COVER = 9;
const DAYS_PER_PAGE = 15;
/** The internal summary's rows per sheet. */
const SUMMARY_ON_COVER = 10;
const SUMMARY_PER_PAGE = 18;

/**
 * The hotel desk and the airline counter abroad read English: the voucher and
 * the ticket say every label in both. The itinerary and the summary stay Arabic.
 */
const BILINGUAL = new Set<VoucherKind>(["hotel_voucher", "flight_ticket"]);
const KIND_TITLE_EN: Record<VoucherKind, string> = {
  hotel_voucher: "Hotel Voucher",
  flight_ticket: "Flight Ticket",
  itinerary: "Itinerary",
  booking_summary: "Booking Summary",
  welcome_board: "Welcome Board",
};
const KEY_EN: Record<string, string> = {
  "نوع الغرفة": "Room type",
  الغرفة: "Room",
  الإقامة: "Board",
  "عدد الغرف": "Rooms",
  "عدد الليالي": "Nights",
  النزلاء: "Guests",
  المدينة: "City",
  "شركة الطيران": "Airline",
  "رقم الرحلة": "Flight no.",
  من: "From",
  إلى: "To",
  الإقلاع: "Departure",
  الوصول: "Arrival",
  الدرجة: "Class",
  الأمتعة: "Baggage",
  الذهاب: "Outbound",
  العودة: "Return",
  الركاب: "Passengers",
  العنوان: "Address",
  الهاتف: "Phone",
};
const keyEn = (key: string) =>
  KEY_EN[key] ??
  key
    .replace(/^الغرفة (\d+)$/, "Room $1")
    .replace(/^الذهاب (\d+)$/, "Outbound $1")
    .replace(/^العودة (\d+)$/, "Return $1")
    .replace(/^رحلة (\d+)$/, "Flight $1");
const both = (bilingual: boolean, ar: string, en: string) => (bilingual && en && en !== ar ? `${ar} · ${en}` : ar);
/** English only on a voucher issued in English (VoucherDTO.lang), else as before. */
const say = (english: boolean, bilingual: boolean, ar: string, en: string) => (english ? en : both(bilingual, ar, en));

const KIND_NOTE_EN: Partial<Record<VoucherKind, string>> = {
  hotel_voucher: "Please present this voucher at check-in, with a valid ID for every guest.",
};
/** OFFER_DOC_CSS is drawn right to left: its one-sided borders, mirrored. */
const LTR_CSS = `.od-root[dir="ltr"] .od-table td{border-left:0;border-right:1px solid var(--od-line-2);}.od-root[dir="ltr"] .od-table td:last-child{border-right:0;}.od-root[dir="ltr"] .od-notice{border-right:0;border-left:3px solid var(--od-notice);}`;
/** Only a real web link becomes a link on the paper. */
const mapLink = (url: string | null | undefined) => (url && /^https?:\/\//i.test(url.trim()) ? url.trim() : null);
const LATER = "يُحدَّد لاحقاً";
/** A planned leg's «00:00» is not a time: say it is still to be set. */
const cleanValue = (v: string) => v.replace(/ 00:00$/, ` — ${LATER}`);

/** The two date labels a booking reads with — a stay checks in and out, a ticket goes and comes back, a drive is one day. */
function dateLabels(kind: string, bilingual: boolean, english = false): [string, string | null] {
  if (kind === "hotel") return [say(english, bilingual, AR.checkIn, "Check-in"), say(english, bilingual, AR.checkOut, "Check-out")];
  if (kind === "flight") return [say(english, bilingual, "الذهاب", "Departure"), say(english, bilingual, "العودة", "Return")];
  return [say(english, bilingual, "التاريخ", "Date"), null];
}

const chunks = <T,>(list: T[], first: number, rest: number): T[][] => {
  const out: T[][] = [list.slice(0, first)];
  for (let i = first; i < list.length; i += rest) out.push(list.slice(i, i + rest));
  return out;
};

export function VoucherDocument({
  voucher,
  assets = DEFAULT_OFFER_DOC_ASSETS,
  brand = TRAVELIUN_BRAND,
}: {
  voucher: VoucherDTO;
  assets?: OfferDocAssets;
  /** whose file it is: a partner's client carries the partner's documents, not ours. */
  brand?: DocBrand;
}) {
  const pages: ReactNode[] = [];
  const summary = voucher.kind === "booking_summary";
  const bookingSheets = summary
    ? chunks(voucher.bookings, SUMMARY_ON_COVER, SUMMARY_PER_PAGE)
    : chunks(voucher.bookings, BOOKINGS_ON_COVER, BOOKINGS_PER_PAGE);
  // the itinerary starts on the cover — a first sheet with a header and nothing else read as empty
  const daySheets = voucher.kind === "itinerary" ? chunks(voucher.days, DAYS_ON_COVER, DAYS_PER_PAGE) : [];
  const travelersFit = voucher.travelers.length > 0 && voucher.travelers.length <= TRAVELERS_PER_PAGE;
  const lastBookings = bookingSheets.length - 1;

  pages.push(
    <Page key="main" cover>
      <Header voucher={voucher} assets={assets} brand={brand} />
      <Parties voucher={voucher} />
      {bookingSheets[0].length > 0 ? (summary ? <SummaryTable bookings={bookingSheets[0]} first /> : <Bookings voucher={voucher} bookings={bookingSheets[0]} first />) : null}
      {daySheets[0]?.length ? (
        <div style={{ marginTop: "8mm" }}>
          <SectionTitle title={KIND_TITLE.itinerary} />
          <Days days={daySheets[0]} />
        </div>
      ) : null}
      {lastBookings === 0 && daySheets.length <= 1 && travelersFit ? <Travelers travelers={voucher.travelers} english={voucher.lang === "en"} /> : null}
      {lastBookings === 0 && daySheets.length <= 1 ? <Notes voucher={voucher} brand={brand} /> : null}
    </Page>,
  );
  bookingSheets.slice(1).forEach((sheet, i) =>
    pages.push(
      <Page key={`b${i}`}>
        {summary ? <SummaryTable bookings={sheet} /> : <Bookings voucher={voucher} bookings={sheet} />}
        {i + 1 === lastBookings && daySheets.length <= 1 && travelersFit ? <Travelers travelers={voucher.travelers} english={voucher.lang === "en"} /> : null}
        {i + 1 === lastBookings && daySheets.length <= 1 ? <Notes voucher={voucher} brand={brand} /> : null}
      </Page>,
    ),
  );
  daySheets.slice(1).forEach((sheet, i) =>
    pages.push(
      <Page key={`d${i}`}>
        <SectionTitle title={KIND_TITLE.itinerary} />
        <Days days={sheet} />
        {i + 2 === daySheets.length ? <Notes voucher={voucher} brand={brand} /> : null}
      </Page>,
    ),
  );

  // A large group spills onto its own sheets rather than being clipped.
  if (!travelersFit && voucher.travelers.length > 0) {
    for (let i = 0; i < voucher.travelers.length; i += TRAVELERS_PER_PAGE) {
      pages.push(
        <Page key={`t${i}`}>
          <SectionTitle title={voucher.lang === "en" ? "Guests" : (AR.travelers ?? "المسافرون")} />
          <Travelers travelers={voucher.travelers.slice(i, i + TRAVELERS_PER_PAGE)} english={voucher.lang === "en"} />
        </Page>,
      );
    }
  }

  return (
    // the map variable lives on the root, exactly as OfferDocument sets it —
    // every .od-page::before reads it from here
    // brand.vars is null for our own palette, as in OfferDocument
    <div className="od-root" dir={voucher.lang === "en" ? "ltr" : "rtl"} style={{ ["--od-map" as string]: `url("${assets.mapUrl}")`, ...(brand.vars ?? {}) }}>
      <style dangerouslySetInnerHTML={{ __html: OFFER_DOC_CSS + (voucher.lang === "en" ? LTR_CSS : "") }} />
      {pages}
    </div>
  );
}

function Page({ children, cover }: { children: ReactNode; cover?: boolean }) {
  return <section className={`od-page${cover ? " od-cover" : ""}`}>{children}</section>;
}

function Ltr({ children }: { children: ReactNode }) {
  return <bdi dir="ltr">{children}</bdi>;
}

function Header({ voucher, assets, brand }: { voucher: VoucherDTO; assets: OfferDocAssets; brand: DocBrand }) {
  // the house logo is the fallback for OUR brand only — a partner without a logo prints its name
  const logoUrl = brand.vars ? brand.logoUrl : (brand.logoUrl ?? assets.logoUrl);
  if (voucher.lang === "en") {
    const cities = [...new Set(voucher.bookings.map((b) => b.city_name).filter(Boolean))].join(" · ");
    return (
      <>
        <div className="od-top">
          <div>
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="od-logo" src={logoUrl} alt={brand.nameLatin} />
            ) : (
              <div className="od-wordmark">{brand.nameLatin}</div>
            )}
          </div>
          <div className="od-company">
            <h2>{brand.nameLatin}</h2>
            {brand.phone ? <div>Tel: {brand.phone}</div> : null}
            {brand.website ? <div>Web: {brand.website}</div> : null}
          </div>
        </div>
        <div className="od-hero" style={{ marginTop: "12mm" }}>
          <div className="od-hero-label">{KIND_TITLE_EN[voucher.kind]}</div>
          <h1 style={{ fontSize: "24pt" }}>{cities || brand.nameLatin}</h1>
          <div className="od-hero-meta">
            File no. {voucher.serial} | Issued {fmtDate(voucher.issued_at)}
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="od-top">
        <div>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="od-logo" src={logoUrl} alt={brand.nameLatin} />
          ) : (
            <div className="od-wordmark">{brand.nameAr}</div>
          )}
        </div>
        <div className="od-company">
          <h2>{brand.nameAr}</h2>
          {brand.address ? <div>{brand.address}</div> : null}
          {brand.phone ? (
            <div>
              {AR.callLabel}: <Ltr>{brand.phone}</Ltr>
            </div>
          ) : null}
          {brand.website ? (
            <div>
              {AR.webLabel}: <Ltr>{brand.website}</Ltr>
            </div>
          ) : null}
        </div>
      </div>

      <div className="od-hero" style={{ marginTop: "12mm" }}>
        <div className="od-hero-label">{both(BILINGUAL.has(voucher.kind), KIND_TITLE[voucher.kind], KIND_TITLE_EN[voucher.kind])}</div>
        <h1 style={{ fontSize: "24pt" }}>{voucher.destination || brand.nameAr}</h1>
        <div className="od-hero-meta">
          {AR.serial} <Ltr>{voucher.serial}</Ltr> | {AR.issueDate} <Ltr>{fmtDate(voucher.issued_at)}</Ltr>
        </div>
      </div>
    </>
  );
}

function Parties({ voucher }: { voucher: VoucherDTO }) {
  if (voucher.lang === "en") {
    return (
      <div className="od-panel">
        <div className="od-panel-head">
          <span>Guest details</span>
          <span>{voucher.travelers.length > 0 ? `${voucher.travelers.length} ${voucher.travelers.length === 1 ? "guest" : "guests"}` : ""}</span>
        </div>
        <table className="od-info">
          <tbody>
            <tr>
              {/* the desk looks for the name on the passport: the lead traveller's, else the file's */}
              <th>Lead guest</th>
              <td>{voucher.travelers[0]?.name || voucher.customer.name || "—"}</td>
              <th>Contact</th>
              <td>{voucher.customer.phone ? <Ltr>{voucher.customer.phone}</Ltr> : "—"}</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="od-panel">
      <div className="od-panel-head">
        <span>{AR.customerInfo}</span>
        <span>{voucher.destination || ""}</span>
      </div>
      <table className="od-info">
        <tbody>
          <tr>
            <th>{both(BILINGUAL.has(voucher.kind), AR.customer, "Guest")}</th>
            <td>{voucher.customer.name || "—"}</td>
            <th>{both(BILINGUAL.has(voucher.kind), AR.contactField, "Contact")}</th>
            <td>{voucher.customer.phone ? <Ltr>{voucher.customer.phone}</Ltr> : "—"}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function SectionTitle({ title, note }: { title: string; note?: string }) {
  return (
    <div className="od-title">
      <h2>{title}</h2>
      {note ? <small>{note}</small> : null}
    </div>
  );
}

function Bookings({ voucher, bookings, first }: { voucher: VoucherDTO; bookings: VoucherBooking[]; first?: boolean }) {
  const bilingual = BILINGUAL.has(voucher.kind);
  const english = voucher.lang === "en";
  return (
    <div style={{ marginTop: first ? "9mm" : 0 }}>
      {first ? <SectionTitle title={say(english, bilingual, KIND_TITLE[voucher.kind], KIND_TITLE_EN[voucher.kind])} /> : null}
      {bookings.map((b, i) => {
        const [fromLabel, toLabel] = dateLabels(b.kind, bilingual, english);
        const map = mapLink(b.map);
        const when = b.detail["الوقت"] || b.detail["وقت الانطلاق"] || "";
        // the city once: «RUH → KUL — RUH → KUL» printed the route twice
        const city = b.city_name && !b.title.includes(b.city_name) && !b.city_name.includes(b.title) ? b.city_name : "";
        const rows: [string, string][] = [
          ...Object.entries(b.detail),
          ...(b.address ? ([["العنوان", b.address]] as [string, string][]) : []),
          ...(b.phone ? ([["الهاتف", b.phone]] as [string, string][]) : []),
        ];
        return (
        <div
          key={i}
          className="od-stay"
          // 38mm date column, auto height, and never split across a sheet — a
          // voucher torn in half at the confirmation number is worthless.
          style={{ gridTemplateColumns: "38mm 1fr", minHeight: "auto", breakInside: "avoid", marginBottom: "5mm" }}
        >
          <div className="od-datebox">
            <span>{fromLabel}</span>
            <strong>
              <Ltr>{fmtDate(b.start_date)}</Ltr>
            </strong>
            {toLabel && b.end_date ? (
              <>
                <span>{toLabel}</span>
                <strong>
                  <Ltr>{fmtDate(b.end_date)}</Ltr>
                </strong>
              </>
            ) : when && when !== LATER ? (
              <>
                <span>{say(english, bilingual, "الوقت", "Time")}</span>
                <strong>
                  <Ltr>{when}</Ltr>
                </strong>
              </>
            ) : null}
          </div>
          <div>
            {/* a stay issued after the room catalogue is in its destination's language — the hotel's name in it, the other below */}
            <div style={{ fontSize: "13pt", fontWeight: 800, color: "var(--od-green)", ...(b.locale === "en" && !english ? { direction: "ltr", textAlign: "right" } : {}) }}>
              {b.title}
              {city ? <span style={{ fontWeight: 500 }}> — {city}</span> : null}
            </div>
            {b.locale ? (
              b.alt_name ? (
                <div
                  style={{
                    fontSize: "10.5pt",
                    fontWeight: 600,
                    color: "var(--od-muted)",
                    ...(b.locale === "ar" ? { direction: "ltr", textAlign: "right" } : english ? { direction: "rtl", textAlign: "left" } : {}),
                  }}
                >
                  {b.alt_name}
                </div>
              ) : null
            ) : bilingual && b.name_en ? (
              // the name the hotel knows itself by
              <div style={{ fontSize: "11pt", fontWeight: 700, direction: "ltr", textAlign: "right" }}>{b.name_en}</div>
            ) : null}
            {/* the number that makes this document worth carrying */}
            {b.confirmation_number ? (
              <div style={{ marginTop: "2mm", fontSize: english ? "14pt" : "11.5pt", fontWeight: 800 }}>
                {say(english, bilingual, "رقم التأكيد", "Confirmation no.")}: <Ltr>{b.confirmation_number}</Ltr>
              </div>
            ) : null}
            {/*
              THREE states, not two, because a traveller's day depends on which:
              no reference at all is a provisional hold, a reference without
              payment is confirmed-not-issued, and both are printed loudly. A
              family turned away at a counter is holding a document that said
              nothing about the difference.
            */}
            <BookingState booking={b} english={english} />
            <table className="od-table" style={{ marginTop: "3mm" }}>
              <tbody>
                {rows.map(([k, v]) => (
                  <tr key={k}>
                    <th style={{ width: "34%" }}>{say(english, bilingual, k, keyEn(k))}</th>
                    <td>
                      <Ltr>{cleanValue(v)}</Ltr>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(b.notes ?? []).map((n) => (
              <p key={n} className="od-note" dir={b.locale === "en" ? "ltr" : undefined}>
                {n}
              </p>
            ))}
            {map ? (
              <p className="od-note">
                <a href={map} style={{ color: "var(--od-green)", fontWeight: 700 }}>
                  {english ? "Open in Google Maps" : "الموقع على خرائط جوجل · Google Maps"}
                </a>
              </p>
            ) : null}
            {b.cancellation_policy ? <p className="od-note">{b.cancellation_policy}</p> : null}
          </div>
        </div>
        );
      })}
    </div>
  );
}

/**
 * The internal summary — one line per booking, with what the client never
 * sees: the supplier and whether it is paid. Never on the client link.
 */
function SummaryTable({ bookings, first }: { bookings: VoucherBooking[]; first?: boolean }) {
  const state = (b: VoucherBooking) => (b.confirmation_number ? (b.is_paid ? "مؤكّد ومُسدَّد" : "مؤكّد — غير مُسدَّد") : "مبدئي");
  return (
    <div style={{ marginTop: first ? "9mm" : 0 }}>
      {first ? <SectionTitle title={KIND_TITLE.booking_summary} note="داخلي — لا يُسلَّم للعميل" /> : null}
      <table className="od-table">
        <thead>
          <tr>
            <th style={{ width: "15%" }}>التاريخ</th>
            <th>الحجز</th>
            <th style={{ width: "17%" }}>رقم التأكيد</th>
            <th style={{ width: "17%" }}>المورّد</th>
            <th style={{ width: "15%" }}>الحالة</th>
          </tr>
        </thead>
        <tbody>
          {bookings.map((b, i) => (
            <tr key={i}>
              <td>
                <Ltr>{fmtDate(b.start_date)}</Ltr>
              </td>
              <td>
                <strong>{b.title}</strong>
                {b.city_name && !b.title.includes(b.city_name) ? <span> — {b.city_name}</span> : null}
              </td>
              <td>
                <Ltr>{b.confirmation_number ?? "—"}</Ltr>
              </td>
              <td>{b.supplier_name || "—"}</td>
              <td>{state(b)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * What this line actually IS today.
 *
 *   no confirmation number → حجز مبدئي   (nothing is held yet)
 *   number, not paid       → حجز مؤكّد غير مُصدر
 *   number and paid        → حجز كامل    (clean, no band)
 */
function BookingState({ booking, english = false }: { booking: VoucherBooking; english?: boolean }) {
  const hasRef = Boolean(booking.confirmation_number);
  if (hasRef && booking.is_paid) {
    return (
      <div style={{ marginTop: "2mm", fontSize: "10pt", fontWeight: 800, color: "#0f7a52" }}>
        {english ? "✓ Confirmed and paid" : "✓ حجز كامل — صادر ومُسدَّد"}
      </div>
    );
  }
  const text = english
    ? hasRef
      ? "⚠ Confirmed, payment pending — not valid for travel until our operations team confirms."
      : "⚠ Provisional — no confirmation number yet. For information only."
    : hasRef
      ? "⚠ حجز مؤكّد غير مُصدر — لم تُسدَّد قيمته بعد. لا يُعتمد للسفر حتى إشعار من قسم العمليات."
      : "⚠ حجز مبدئي — لم يصدر رقم التأكيد بعد. هذا المستند للاطلاع ولا يُعتمد لدى المزوّد.";
  return (
    <div
      style={{
        marginTop: "2.5mm",
        padding: "2mm 3mm",
        borderRadius: "2mm",
        border: "1px solid var(--od-notice)",
        background: "#fff6e3",
        color: "#8a5a0c",
        fontSize: "10pt",
        fontWeight: 800,
        lineHeight: 1.6,
      }}
    >
      {text}
    </div>
  );
}

function Travelers({ travelers, english = false }: { travelers: VoucherDTO["travelers"]; english?: boolean }) {
  const nationality = travelers.some((t) => t.nationality);
  return (
    <div className="od-panel" style={{ marginTop: "7mm" }}>
      <div className="od-panel-head">
        <span>{english ? "Guests" : "المسافرون"}</span>
        <span>
          <Ltr>{String(travelers.length)}</Ltr>
        </span>
      </div>
      <table className="od-info">
        <tbody>
          {travelers.map((t, i) => (
            <tr key={i}>
              <th style={{ width: "12%" }}>
                <Ltr>{String(i + 1)}</Ltr>
              </th>
              <td>{t.name}</td>
              {nationality ? <td style={{ width: "30%" }}>{t.nationality ? nationalityName(t.nationality, english ? "en" : "ar") : "—"}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Days({ days }: { days: VoucherDay[] }) {
  return (
    <table className="od-table">
      <thead>
        <tr>
          <th style={{ width: "12%" }}>اليوم</th>
          <th style={{ width: "18%" }}>التاريخ</th>
          <th>البرنامج</th>
        </tr>
      </thead>
      <tbody>
        {days.map((d) => (
          <tr key={d.day_number}>
            <td>
              <Ltr>{String(d.day_number)}</Ltr>
            </td>
            <td>
              <Ltr>{fmtDate(d.date)}</Ltr>
            </td>
            <td>
              <strong>{d.title || d.city_name || "—"}</strong>
              {d.activities.length > 0 ? (
                <div style={{ marginTop: "1.5mm", color: "var(--od-muted)" }}>{d.activities.join(" · ")}</div>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type VoucherDay = VoucherDTO["days"][number];

function Notes({ voucher, brand }: { voucher: VoucherDTO; brand: DocBrand }) {
  if (voucher.lang === "en") {
    return (
      <div style={{ marginTop: "8mm" }}>
        {[KIND_NOTE_EN[voucher.kind] ?? "", ...voucher.notes].filter(Boolean).map((n, i) => (
          <p key={i} className="od-note">
            {n}
          </p>
        ))}
        <p className="od-note" style={{ marginTop: "5mm" }}>
          {[brand.nameLatin, brand.phone, brand.email].filter(Boolean).join(" · ")}
        </p>
      </div>
    );
  }
  const notes = [KIND_NOTE[voucher.kind], ...voucher.notes];
  return (
    <div style={{ marginTop: "8mm" }}>
      {notes.map((n, i) => (
        <p key={i} className="od-note">
          {n}
        </p>
      ))}
      <p className="od-note" style={{ marginTop: "5mm" }}>
        {[brand.nameAr, brand.phone, brand.email].filter(Boolean).map((part, i) => (
          <span key={i}>
            {i > 0 ? " · " : null}
            {i > 0 ? <Ltr>{part}</Ltr> : part}
          </span>
        ))}
      </p>
    </div>
  );
}
