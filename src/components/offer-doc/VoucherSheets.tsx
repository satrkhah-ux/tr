import type { ReactNode } from "react";
import type { InternalFlightLine } from "@/lib/offer/dto";
import type { VoucherBooking, VoucherDTO, VoucherLeg } from "@/lib/operations/voucher-dto";
import { nationalityName } from "@/lib/operations/nationality";
import type { OfferDocAssets } from "./assets";
import type { DocBrand } from "./brand";
import { AR, fmtDate } from "./labels";
import { CompanyHeader, FlightCards } from "./OfferDocument";
import { OFFER_DOC_CSS } from "./styles";
import { BILINGUAL, KIND_NOTE, KIND_NOTE_EN, KIND_TITLE, KIND_TITLE_EN, LTR_CSS, Ltr, Page, both, cleanValue, keyEn, mapLink, say } from "./VoucherDocument";

/**
 * The hotels file and the flight ticket — the two papers a traveller hands
 * over abroad — set as sheets of their own (the user, 2026-10-22: «الفوتشرات
 * تظهر بأسلوب صفحتين و يحتاج تنظيم», «تذكرة الطيران تحتاج اعادة تصميم لهوية
 * الشركة»). The company block, a green band saying what the paper is, then
 * blocks packed by height onto as few A4 sheets as they fill: a block never
 * splits, and a sheet never carries only the tail of the last one. The
 * itinerary and the internal summary keep VoucherDocument's own layout.
 */

/**
 * What a sheet holds under its top padding, in mm: A4's 297 less 13 at the top
 * and 17 kept clear above the footer (a sheet runs over past 284). The heights
 * below were measured in Chromium on real papers (2026-10-22), a block's
 * spacing included, and set a millimetre or two high.
 */
const SHEET_MM = 267;
const RUNNING_MM = 12.5;

/**
 * Blocks in order onto sheets: the next block starts a new sheet when it does
 * not fit what is left. The first sheet holds `first` (it carries the header).
 * Heights are estimates in mm, set a little high: a block that ends early
 * leaves white space; one that runs over would print a sheet nobody asked for.
 */
export function packSheets(heights: number[], first: number, rest = SHEET_MM - RUNNING_MM): number[][] {
  const sheets: number[][] = [[]];
  let room = first;
  heights.forEach((mm, i) => {
    if (mm > room && sheets[sheets.length - 1].length > 0) {
      sheets.push([]);
      room = rest;
    }
    sheets[sheets.length - 1].push(i);
    room -= mm;
  });
  return sheets;
}

type Block = { mm: number; node: ReactNode };

/**
 * A line for our own reader only (upload-all, 2026-10-23): Latin, transparent,
 * in the block's empty top. A paper of ours uploaded again reads back exactly —
 * its cards and boxes come out of the PDF out of order, Arabic reversed.
 */
function Machine({ children }: { children: string }) {
  return (
    <span dir="ltr" style={{ position: "absolute", top: "-3.5mm", insetInlineStart: 0, fontSize: "2pt", lineHeight: 1, color: "rgba(0,0,0,0)", whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}
const wall = (iso: string | null) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : "");

const SHEET_CSS = `
.od-company{font-size:9.6pt;line-height:1.6;}
.od-company h2{font-size:13pt;}
.od-logo,.od-wordmark{width:46mm;max-height:24mm;min-height:0;}
.vs-block{padding-top:4.5mm;}
.vs-band{display:grid;grid-template-columns:1.7fr 1fr .8fr;margin-top:7mm;border-radius:4mm;overflow:hidden;background:linear-gradient(135deg,var(--od-green),var(--od-green-2));color:#fff;}
.vs-band>div{padding:2.6mm 5mm;}
.vs-band>div+div{border-inline-start:1px solid rgba(255,255,255,.28);}
.vs-band span{display:block;font-size:8.5pt;opacity:.85;}
.vs-band strong{display:block;font-size:13pt;font-weight:800;line-height:1.4;}
.vs-running{display:flex;justify-content:space-between;align-items:baseline;color:var(--od-green);border-bottom:1px solid var(--od-line);padding-bottom:2.5mm;margin-bottom:3mm;}
.vs-running strong{font-size:12pt;font-weight:800;}
.vs-running span{font-size:9.5pt;color:var(--od-muted);}
.vs-panel{border:1px solid var(--od-line);border-radius:4mm;overflow:hidden;background:rgba(255,255,255,.96);}
.vs-panel-head{background:var(--od-green);color:#fff;padding:2.4mm 5mm;font-size:11pt;font-weight:700;display:flex;justify-content:space-between;}
.vs-grid{display:grid;grid-template-columns:1fr 1fr;}
.vs-grid>div{display:flex;gap:2.5mm;align-items:baseline;padding:2.2mm 5mm;border-top:1px solid var(--od-line-3);font-size:10pt;}
.vs-grid>div:nth-child(even){border-inline-start:1px solid var(--od-line-3);}
.vs-grid b{color:var(--od-muted);font-weight:500;font-size:9pt;}
.vs-grid .vs-wide{grid-column:1 / -1;border-inline-start:0 !important;}
.vs-notes .od-note{margin:0 0 2mm;}
`;

function Sheets({
  voucher,
  assets,
  brand,
  css,
  header,
  headerMm,
  blocks,
}: {
  voucher: VoucherDTO;
  assets: OfferDocAssets;
  brand: DocBrand;
  css: string;
  /** the first sheet's header, and its height in mm */
  header: ReactNode;
  headerMm: number;
  blocks: Block[];
}) {
  const sheets = packSheets(
    blocks.map((b) => b.mm),
    SHEET_MM - headerMm,
  );
  const english = voucher.lang === "en";
  return (
    <div className="od-root" dir={english ? "ltr" : "rtl"} style={{ ["--od-map" as string]: `url("${assets.mapUrl}")`, ...(brand.vars ?? {}) }}>
      <style dangerouslySetInnerHTML={{ __html: OFFER_DOC_CSS + SHEET_CSS + css + (english ? LTR_CSS : "") }} />
      {sheets.map((sheet, p) => (
        <Page key={p} cover={p === 0}>
          {p === 0 ? (
            header
          ) : (
            <div className="vs-running">
              <strong>{say(english, BILINGUAL.has(voucher.kind), KIND_TITLE[voucher.kind], KIND_TITLE_EN[voucher.kind])}</strong>
              <span>
                <Ltr>{voucher.serial}</Ltr>
              </span>
            </div>
          )}
          {sheet.map((i) => (
            // the estimate rides along, for checking it against the printed height
            <div key={i} className="vs-block" data-mm={blocks[i].mm.toFixed(1)}>
              {blocks[i].node}
            </div>
          ))}
          <div className="od-foot">
            <span>{voucher.serial}</span>
            <span>
              {p + 1} / {sheets.length}
            </span>
          </div>
        </Page>
      ))}
    </div>
  );
}

/** The band under the company block: what the paper is and where to, the file, the day. */
function Band({ voucher, title, label }: { voucher: VoucherDTO; title: string; label: string }) {
  const english = voucher.lang === "en";
  return (
    <div className="vs-band">
      <div>
        <span>{label}</span>
        <strong>{title}</strong>
      </div>
      <div>
        <span>{say(english, true, "رقم الملف", "File no.")}</span>
        <strong>
          <Ltr>{voucher.serial}</Ltr>
        </strong>
      </div>
      <div>
        <span>{say(english, true, AR.issueDate, "Issued")}</span>
        <strong>
          <Ltr>{fmtDate(voucher.issued_at)}</Ltr>
        </strong>
      </div>
    </div>
  );
}

/** The company block and the logo — Latin on an English paper. */
function Top({ voucher, assets, brand }: { voucher: VoucherDTO; assets: OfferDocAssets; brand: DocBrand }) {
  // the house logo is the fallback for OUR brand only — a partner without a logo prints its name
  const logoUrl = brand.vars ? brand.logoUrl : (brand.logoUrl ?? assets.logoUrl);
  if (voucher.lang !== "en") return <CompanyHeader brand={brand} logoUrl={logoUrl} />;
  return (
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
        {brand.email ? <div>Email: {brand.email}</div> : null}
      </div>
    </div>
  );
}

// ─── the travellers and the notes, shared ─────────────────────────────────────

const GUESTS_PER_BLOCK = 16;
const LINE_MM = 9;
const guestsMm = (n: number, contact: boolean) => 16.5 + Math.ceil(n / 2) * 9.6 + (contact ? LINE_MM : 0);

/** The travellers two to a line — the desk and the counter match them to the passports. */
function Guests({ voucher, travelers, from, contact, extra }: { voucher: VoucherDTO; travelers: VoucherDTO["travelers"]; from: number; contact: boolean; extra?: ReactNode }) {
  const english = voucher.lang === "en";
  const ticket = voucher.kind === "flight_ticket";
  return (
    <div className="vs-panel">
      <div className="vs-panel-head">
        <span>{say(english, true, ticket ? "المسافرون" : "النزلاء", ticket ? "Passengers" : "Guests")}</span>
        <span>
          <Ltr>{String(voucher.travelers.length || 1)}</Ltr>
        </span>
      </div>
      <div className="vs-grid">
        {travelers.map((t, i) => (
          <div key={i}>
            <b>
              <Ltr>{String(from + i + 1)}</Ltr>
            </b>
            <strong>
              <bdi>{t.name}</bdi>
            </strong>
            {t.nationality ? <b style={{ marginInlineStart: "auto" }}>{nationalityName(t.nationality, english ? "en" : "ar")}</b> : null}
          </div>
        ))}
        {contact ? (
          <div className="vs-wide">
            <b>{say(english, true, AR.contactField, "Contact")}</b>
            <span>{voucher.customer.phone ? <Ltr>{voucher.customer.phone}</Ltr> : "—"}</span>
          </div>
        ) : null}
        {extra}
      </div>
    </div>
  );
}

/** The travellers as blocks: a large group runs on over sheets, sixteen to a block. `extra` ends the last one. */
function guestBlocks(voucher: VoucherDTO, extra: { node: ReactNode; mm: number } | null = null): Block[] {
  const list = voucher.travelers.length ? voucher.travelers : [{ name: voucher.customer.name || "—", nationality: null }];
  const out: Block[] = [];
  for (let i = 0; i < list.length; i += GUESTS_PER_BLOCK) {
    const part = list.slice(i, i + GUESTS_PER_BLOCK);
    const last = i + GUESTS_PER_BLOCK >= list.length;
    out.push({
      mm: guestsMm(part.length, last) + (last && extra ? extra.mm : 0),
      node: <Guests voucher={voucher} travelers={part} from={i} contact={last} extra={last ? extra?.node : undefined} />,
    });
  }
  return out;
}

/** The paper's notes — the company's numbers are in its header already, so they are not said again here. */
function notesBlock(voucher: VoucherDTO, more: string[] = []): Block {
  const english = voucher.lang === "en";
  const notes = [...(english ? [KIND_NOTE_EN[voucher.kind] ?? "", ...voucher.notes] : [KIND_NOTE[voucher.kind], ...voucher.notes]), ...more].filter(Boolean);
  // a note box is 15mm for its first line and 5 for each line it wraps to (about 100 characters a line)
  const box = (text: string) => 15 + 5 * (Math.ceil(text.length / 100) - 1);
  return {
    mm: notes.length ? 4.5 + notes.reduce((sum, n) => sum + box(n), 0) : 0,
    node: (
      <div className="vs-notes">
        {notes.map((n, i) => (
          <p key={i} className="od-note" dir="auto">
            {n}
          </p>
        ))}
      </div>
    ),
  };
}

// ─── «فوتشر الفنادق» ──────────────────────────────────────────────────────────

/** The company block and the band: the Arabic block carries the address and every number, the English one three lines. */
const HOTEL_HEADER_MM = { ar: 62, en: 51 };
const HOTEL_CSS = `
.vh-card{border:1px solid var(--od-line-2);border-radius:4.5mm;background:#fff;overflow:hidden;box-shadow:0 6px 16px var(--od-shadow-2);}
.vh-head{display:flex;align-items:center;justify-content:space-between;gap:4mm;padding:2.6mm 5mm;background:var(--od-soft);border-bottom:1px solid var(--od-line-2);}
.vh-name strong{font-size:12.5pt;font-weight:800;color:var(--od-green);line-height:1.35;}
.vh-name em{font-style:normal;font-weight:600;color:var(--od-ink);}
.vh-name small{display:block;font-size:9.5pt;font-weight:600;color:var(--od-muted);}
.vh-conf{flex:0 0 auto;text-align:center;background:var(--od-green);color:#fff;border-radius:3mm;padding:1.4mm 4.5mm;}
.vh-conf span{display:block;font-size:7.8pt;opacity:.85;}
.vh-conf strong{display:block;font-size:13pt;font-weight:800;line-height:1.3;}
.vh-facts{display:grid;grid-template-columns:repeat(4,1fr);}
.vh-facts>div{padding:2mm 4mm;border-bottom:1px solid var(--od-line-3);border-inline-end:1px solid var(--od-line-3);}
.vh-facts span{display:block;font-size:8pt;color:var(--od-muted);}
.vh-facts strong{display:block;font-size:10pt;font-weight:700;color:var(--od-ink);line-height:1.45;}
.vh-more{padding:2mm 5mm 2.6mm;font-size:9pt;color:var(--od-muted);line-height:1.6;}
.vh-more a{color:var(--od-green);font-weight:700;}
`;

/** How many of the four columns a fact takes, by its length. */
const spanOf = (value: string) => (value.length > 38 ? 4 : value.length > 17 ? 2 : 1);

/** The rows four columns make of these spans, placed in order as the grid places them. */
export function gridRows(spans: number[]): number {
  let rows = 0;
  let col = 4;
  for (const s of spans) {
    if (col + s > 4) {
      rows++;
      col = 0;
    }
    col += s;
  }
  return rows;
}

type Fact = { label: string; value: string; span: number; ltr?: boolean };

function stayFacts(b: VoucherBooking, english: boolean): Fact[] {
  const bi = (ar: string, en: string) => say(english, true, ar, en);
  return [
    { label: bi(AR.checkIn, "Check-in"), value: fmtDate(b.start_date), span: 1, ltr: true },
    { label: bi(AR.checkOut, "Check-out"), value: fmtDate(b.end_date), span: 1, ltr: true },
    // the city is in the card's head
    ...Object.entries(b.detail)
      .filter(([k]) => k !== "المدينة")
      .map(([k, v]) => ({ label: bi(k, keyEn(k)), value: cleanValue(v), span: spanOf(cleanValue(v)) })),
    ...(b.phone ? [{ label: bi("الهاتف", "Phone"), value: b.phone, span: spanOf(b.phone), ltr: true }] : []),
    ...(b.address ? [{ label: bi("العنوان", "Address"), value: b.address, span: 4 }] : []),
  ];
}

/** The card's own lines under its facts — the cancellation policy only when it is not the one every hotel shares (that goes once, in the notes). */
const stayMore = (b: VoucherBooking, shared: string | null) => [...(b.notes ?? []), ...(b.cancellation_policy && b.cancellation_policy !== shared ? [b.cancellation_policy] : [])];
const otherName = (b: VoucherBooking, english: boolean) => (b.locale ? b.alt_name : english ? null : b.name_en);

function stayMm(b: VoucherBooking, english: boolean, shared: string | null): number {
  const lines = stayMore(b, shared).length + (mapLink(b.map) ? 1 : 0);
  return 26 + gridRows(stayFacts(b, english).map((f) => f.span)) * 13.5 + (lines ? 3 + lines * 5.5 : 0);
}

function StayCard({ booking: b, english, shared }: { booking: VoucherBooking; english: boolean; shared: string | null }) {
  const map = mapLink(b.map);
  const city = b.city_name && !b.title.includes(b.city_name) && !b.city_name.includes(b.title) ? b.city_name : "";
  const other = otherName(b, english);
  const more = stayMore(b, shared);
  return (
    <div className="vh-card">
      <div className="vh-head">
        <div className="vh-name">
          <strong>
            <bdi>{b.title}</bdi>
          </strong>
          {city ? (
            <em>
              {" "}
              — <bdi>{city}</bdi>
            </em>
          ) : null}
          {other ? (
            <small>
              <bdi>{other}</bdi>
            </small>
          ) : null}
        </div>
        {/* the number that makes this paper worth carrying */}
        <div className="vh-conf">
          <span>{say(english, true, "رقم التأكيد", "Confirmation no.")}</span>
          <strong>
            <Ltr>{b.confirmation_number ?? "—"}</Ltr>
          </strong>
        </div>
      </div>
      <div className="vh-facts">
        {stayFacts(b, english).map((f, i) => (
          <div key={i} style={{ gridColumn: `span ${f.span}` }}>
            <span>{f.label}</span>
            <strong>{f.ltr ? <Ltr>{f.value}</Ltr> : <bdi>{f.value}</bdi>}</strong>
          </div>
        ))}
      </div>
      {more.length || map ? (
        <div className="vh-more">
          {more.map((n) => (
            <div key={n} dir="auto">
              {n}
            </div>
          ))}
          {map ? (
            <div>
              <a href={map}>{english ? "Open in Google Maps" : "الموقع على خرائط جوجل · Google Maps"}</a>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Every hotel of the trip on one paper (the user, 2026-10-22: «يفضل الفنادق
 * تكون بملف واحد بعد التأكيد الكلي»): the guests two to a line, a compact card
 * per hotel with its confirmation number boxed, then the notes. Issued only
 * once every hotel is final (wizard/documents.ts), so no «provisional» band.
 */
export function HotelVoucher({ voucher, assets, brand }: { voucher: VoucherDTO; assets: OfferDocAssets; brand: DocBrand }) {
  const english = voucher.lang === "en";
  const cities = [...new Set(voucher.bookings.map((b) => b.city_name).filter(Boolean))].join(" · ");
  const title = english ? cities || voucher.destination || brand.nameLatin : voucher.destination || cities || brand.nameAr;
  const policies = [...new Set(voucher.bookings.map((b) => b.cancellation_policy ?? ""))];
  const shared = voucher.bookings.length > 1 && policies.length === 1 && policies[0] ? policies[0] : null;
  return (
    <Sheets
      voucher={voucher}
      assets={assets}
      brand={brand}
      css={HOTEL_CSS}
      header={
        <>
          <Top voucher={voucher} assets={assets} brand={brand} />
          <Band voucher={voucher} title={title} label={say(english, true, KIND_TITLE.hotel_voucher, KIND_TITLE_EN.hotel_voucher)} />
        </>
      }
      headerMm={english ? HOTEL_HEADER_MM.en : HOTEL_HEADER_MM.ar}
      blocks={[
        ...guestBlocks(voucher),
        ...voucher.bookings.map((b, i) => ({
          mm: stayMm(b, english, shared),
          node: (
            <div className="vh-block">
              <Machine>{`HOTEL CONFIRMATION NO: ${b.confirmation_number ?? ""} CHECK-IN ${b.start_date ?? ""} CHECK-OUT ${b.end_date ?? ""}`}</Machine>
              <StayCard key={i} booking={b} english={english} shared={shared} />
            </div>
          ),
        })),
        notesBlock(voucher, shared ? [shared] : []),
      ]}
    />
  );
}

// ─── «تذكرة الطيران» ─────────────────────────────────────────────────────────

const TICKET_HEADER_MM = 84;
/** A boarding-pass card; the first carries the «الطيران» heading too. */
const CARD_MM = 46.5;
const TICKET_CSS = `
.vt-meta{display:grid;grid-template-columns:repeat(3,1fr);gap:3mm;margin-top:5mm;}
.vt-meta>div{background:var(--od-fill);border:1px solid var(--od-line-2);border-radius:4mm;padding:2.4mm 4mm;text-align:center;}
.vt-meta span{display:block;color:var(--od-muted);font-size:8.5pt;}
.vt-meta strong{display:block;color:var(--od-green);font-size:14pt;font-weight:800;line-height:1.45;}
.vt-meta .vt-ok{color:#0f7a52;}
.vt-flights{position:relative;}
.vt-flights .od-subhead{margin-top:1mm;}
.vt-flights,.vh-block{position:relative;}
.vt-flights .od-fl{margin-bottom:0;}
`;

/** A leg as the offer's boarding-pass card reads it: the place by name and code, the airport's own wall clock. */
function cardOf(l: VoucherLeg, i: number, legs: VoucherLeg[], detail: Record<string, string>, logos: Record<string, string>): InternalFlightLine {
  const place = (name: string | null, code: string) => (name ? `${name} (${code})` : code);
  const back = i > 0 && i === legs.length - 1 && l.to === legs[0].from;
  return {
    airline: l.airline || l.airline_iata,
    flight_no: l.flight_no || null,
    from_airport: place(l.from_name, l.from),
    to_airport: place(l.to_name, l.to),
    // as saved, with the airport's offset — never converted to the reader's zone
    departure_at: l.departs_at?.slice(0, 16) ?? null,
    arrival_at: l.arrives_at?.slice(0, 16) ?? null,
    cabin_class: detail["الدرجة"] ?? null,
    baggage_allowance: detail["الأمتعة"] ?? null,
    airline_iata: l.airline_iata,
    airline_logo_url: (l.airline_iata && logos[l.airline_iata]) || null,
    leg_order: i === 0 ? "outbound" : back ? "inbound" : null,
    sell_price: null,
    sell_currency: null,
    buy_price: null,
    buy_currency: null,
  };
}

/**
 * The ticket in our identity: it printed an empty first sheet, then the legs
 * as a table of run-together lines, twice over. Now the company block, the
 * band, the booking reference, the route and the state in three boxes, each
 * flight as the offer's boarding-pass card (FlightCards — the «بطاقة الطيران»
 * look), the passengers and their ticket numbers, the notes.
 */
export function FlightTicket({ voucher, assets, brand, logos }: { voucher: VoucherDTO; assets: OfferDocAssets; brand: DocBrand; logos: Record<string, string> }) {
  const flights = voucher.bookings.filter((b) => b.legs?.length);
  const legs = flights.flatMap((b) => b.legs ?? []);
  const cards = flights.flatMap((b) => (b.legs ?? []).map((l) => cardOf(l, legs.indexOf(l), legs, b.detail, logos)));
  const pnrs = [...new Set(flights.map((b) => b.pnr || b.confirmation_number).filter((p): p is string => Boolean(p)))];
  const tickets = flights.flatMap((b) => b.tickets ?? []);
  // the codes in the order flown, each once where a leg continues from the last
  const route = legs.map((l, i) => (i === 0 ? `${l.from} → ${l.to}` : legs[i - 1].to === l.from ? `→ ${l.to}` : `· ${l.from} → ${l.to}`)).join(" ");
  const logoUrl = brand.vars ? brand.logoUrl : (brand.logoUrl ?? assets.logoUrl);
  return (
    <Sheets
      voucher={voucher}
      assets={assets}
      brand={brand}
      css={TICKET_CSS}
      header={
        <>
          <CompanyHeader brand={brand} logoUrl={logoUrl} />
          <Band voucher={voucher} title={voucher.destination || brand.nameAr} label={both(true, KIND_TITLE.flight_ticket, "E-Ticket")} />
          <div className="vt-meta">
            <div>
              <span>{both(true, AR.pnr, "Booking ref.")}</span>
              <strong>
                <Ltr>{pnrs.join(" · ") || "—"}</Ltr>
              </strong>
            </div>
            <div>
              <span>{both(true, "المسار", "Route")}</span>
              <strong style={route.length > 22 ? { fontSize: "10.5pt" } : undefined}>
                <Ltr>{route}</Ltr>
              </strong>
            </div>
            <div>
              <span>{both(true, "الحالة", "Status")}</span>
              <strong className="vt-ok">✓ {both(true, "مؤكّد", "Confirmed")}</strong>
            </div>
          </div>
        </>
      }
      headerMm={TICKET_HEADER_MM}
      blocks={[
        ...cards.map((c, i) => ({
          mm: CARD_MM + (i === 0 ? 11 : 0),
          node: (
            <div className="vt-flights">
              <Machine>{`${legs[i].flight_no || "—"} · ${legs[i].from} → ${legs[i].to} · ${wall(legs[i].departs_at)} · ARR ${wall(legs[i].arrives_at)}`}</Machine>
              {i === 0 ? <h3 className="od-subhead">{both(true, AR.flights, "Flights")}</h3> : null}
              <FlightCards flights={[c]} />
            </div>
          ),
        })),
        ...guestBlocks(
          voucher,
          tickets.length
            ? {
                mm: LINE_MM,
                node: (
                  <div className="vs-wide">
                    <b>{both(true, "أرقام التذاكر", "Ticket no.")}</b>
                    <Ltr>{tickets.join(" · ")}</Ltr>
                  </div>
                ),
              }
            : null,
        ),
        notesBlock(voucher),
      ]}
    />
  );
}
