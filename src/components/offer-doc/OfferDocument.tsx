import type { ReactNode } from "react";
import { DirText } from "@/components/DirText";
import type { ClientOfferDTO, InternalOfferDTO } from "@/lib/offer/dto";
import {
  AR,
  BOARD_AR,
  ITEM_TYPE_AR,
  LEG_AR,
  fmtDate,
  fmtDateTime,
  fmtNum,
  stars,
} from "./labels";
import {
  formatRainAr,
  formatTempsAr,
  isWeatherEmpty,
  weatherCodeAr,
  weatherSourceAr,
} from "@/lib/offer/weather-format";
import { DEFAULT_OFFER_DOC_ASSETS, type OfferDocAssets } from "./assets";
import { TRAVELIUN_BRAND, type DocBrand } from "./brand";
import { OFFER_DOC_CSS } from "./styles";

/**
 * THE offer document — one fixed-layout React template rendered identically for
 * the on-screen preview and the headless-Chromium PDF (see src/lib/offer-doc).
 * Server-safe (no hooks): also used via renderToStaticMarkup for the PDF.
 *
 * Discriminated variant: the CLIENT branch is typed `ClientOfferDTO`, so buy
 * price / profit are not even in scope — the omission is by construction. Only
 * the INTERNAL branch can read buy/profit, and only on its own extra page.
 *
 * STRUCTURE — the content is cut into blocks in a fixed reading order, then
 * PACKED onto A4 sheets. One section per sheet was the first design and it
 * printed pages that were 90% white (a single visa row; one stay card), so
 * sections now share a sheet whenever they fit:
 *   cover (always alone) → flights → visas → stays → tours/weather →
 *   services + total + summary → internal pricing (internal only) → terms
 *
 * A section absent from the data contributes no block at all, so it can never
 * render as an empty box. A section is split across sheets only when it is
 * genuinely taller than one; the first section on a sheet gets the big heading
 * and any that follow get a secondary one.
 *
 * The employee's name is printed once, in the LAST sheet's footer — management
 * needs to know who issued the offer; the client does not need a name card.
 */
export type OfferDocumentProps = (
  | { variant: "client"; offer: ClientOfferDTO }
  | { variant: "internal"; offer: InternalOfferDTO }
) & {
  assets?: OfferDocAssets;
  /**
   * Whose document this is. Defaults to ours; a partner reselling the file gets
   * their own cover, logo and palette (see brand.ts).
   */
  brand?: DocBrand;
  /**
   * false → print no money at all: no total band, no per-service amounts, no
   * payment terms. A reseller adds their own margin, so our number on the page
   * would undercut them. Ignored for the internal variant, which exists to show
   * exactly those figures.
   */
  showPrices?: boolean;
};

const Ltr = ({ children }: { children: ReactNode }) => <DirText dir="ltr">{children}</DirText>;

/**
 * Estimated printed height of one terms clause.
 *
 * A fixed clause count split the company's ten standard clauses 8 + 2, leaving a
 * nearly blank sheet carrying two lines. Clause length varies from one line to
 * four, so the packer measures instead.
 *
 * ponytail: characters-per-line calibrated against a render at 9.35pt across the
 * ~184mm column; it only has to be conservative — over-estimating costs a little
 * white space, under-estimating would clip.
 */
const TERMS_CHARS_PER_LINE = 88;
const TERMS_LINE_MM = 5.2;
const TERMS_ROW_PADDING_MM = 4;

function termHeightMm(text: string): number {
  const lines = Math.max(1, Math.ceil(text.length / TERMS_CHARS_PER_LINE));
  return lines * TERMS_LINE_MM + TERMS_ROW_PADDING_MM;
}

/**
 * Usable content height: A4 297mm − 13mm top padding − the 14mm the footer rule
 * and label occupy at the bottom, less a small safety margin.
 */
const PAGE_BUDGET_MM = 262;
/** Height of a section's big heading, and of a secondary one further down a page. */
const HEADING_MM = 16;
const SUBHEADING_MM = 11;
/** Breathing room between two sections that share a sheet. */
const BLOCK_GAP_MM = 6;

/**
 * One printable unit. Sections are cut into blocks so a sheet can be FILLED:
 * a lone visa table used to occupy a page that was 90% white, and one stay card
 * another. Consecutive blocks of the same `group` render under a single heading,
 * so a section that spills keeps its title on the next sheet.
 */
type DocBlock = {
  group: string;
  title: string;
  note?: string;
  heightMm: number;
  /** chrome the group's wrapper adds once per sheet (the terms box header). */
  runOverheadMm?: number;
} & (
  | { kind: "node"; node: ReactNode }
  | { kind: "stay"; stay: ClientOfferDTO["hotels"][number]; flagDomestic: boolean }
  | { kind: "clause"; clause: string }
);

/**
 * Fill sheets in reading order, with one rule beyond first-fit: **a section is
 * never split when it would fit whole on a fresh sheet.** Plain greedy packing
 * started the terms at the bottom of the services page and spilled two clauses
 * onto a near-blank sheet — the very thing this pager exists to prevent. Only a
 * section genuinely taller than a page gets divided.
 */
function packBlocks(blocks: DocBlock[]): DocBlock[][] {
  // consecutive blocks of the same section move together
  const groups: DocBlock[][] = [];
  for (const block of blocks) {
    const last = groups[groups.length - 1];
    if (last && last[0].group === block.group) last.push(block);
    else groups.push([block]);
  }

  const pages: DocBlock[][] = [];
  let current: DocBlock[] = [];
  let used = 0;
  const flush = () => {
    if (current.length > 0) pages.push(current);
    current = [];
    used = 0;
  };

  for (const group of groups) {
    const overhead = group[0].runOverheadMm ?? 0;
    const headingHere = current.length === 0 ? HEADING_MM : SUBHEADING_MM + BLOCK_GAP_MM;
    const total = group.reduce((sum, b) => sum + b.heightMm, 0) + overhead;

    // `used` is 0 on an empty sheet, so this covers "starts the page" too — an
    // early `current.length === 0` short-circuit here would accept a section of
    // any size onto one sheet and overflow it.
    if (used + headingHere + total <= PAGE_BUDGET_MM) {
      used += headingHere + total;
      current.push(...group);
      continue;
    }
    if (HEADING_MM + total <= PAGE_BUDGET_MM) {
      flush();
      used = HEADING_MM + total;
      current.push(...group);
      continue;
    }
    // taller than a whole sheet: fill what is left, then continue overleaf
    let heading = headingHere;
    for (const block of group) {
      if (current.length > 0 && used + heading + block.heightMm > PAGE_BUDGET_MM) {
        flush();
        heading = HEADING_MM + overhead;
      }
      used += heading + block.heightMm;
      heading = 0;
      current.push(block);
    }
  }
  flush();
  return pages;
}

/** Rows of a `.od-table`: the header band plus one row per line of content. */
const tableMm = (rows: number, rowMm = 16) => 14 + rows * rowMm;

/**
 * Estimated printed height of one stay card.
 *
 * A fixed "five per page" breaks as soon as a stay carries policy notices.
 * Measured against real renders: a bare card is 44mm, one with a cancellation
 * policy and a pay-at-hotel line is 62–68mm, and 83mm once a domestic-flight
 * notice joins them — five of those overflow A4 by a third. Rather than compress
 * the cards (which the approved design forbids) the pager measures and splits.
 *
 * ponytail: coefficients calibrated against those renders, not computed — they
 * only have to be conservative, since being one card early costs a little white
 * space while being one card late would push a card onto a bare sheet.
 */
function stayHeightMm(stay: ClientOfferDTO["hotels"][number], flagDomestic: boolean): number {
  const notices =
    (stay.cancellation_policy ? 1 : 0) + (stay.excluded_surcharges.length > 0 ? 1 : 0) + (flagDomestic ? 1 : 0);
  // room count is deliberately absent: measurement shows the card's 37mm floor
  // and its middle column set the height, so extra room boxes cost nothing.
  return 44 + notices * 13;
}

/** Nights from the stays; falls back to the arrival→departure span. */
function tripNights(offer: ClientOfferDTO): number {
  const fromHotels = offer.hotels.reduce((sum, h) => sum + (h.nights ?? 0), 0);
  if (fromHotels > 0) return fromHotels;
  if (offer.arrival_date && offer.departure_date) {
    const ms = Date.parse(`${offer.departure_date}T00:00:00Z`) - Date.parse(`${offer.arrival_date}T00:00:00Z`);
    if (Number.isFinite(ms) && ms > 0) return Math.round(ms / 86400000);
  }
  return 0;
}

/**
 * A published offer is a FROZEN snapshot: `offer_renders.snapshot_json` is
 * written once and read back forever. Snapshots created before a field existed
 * (the daily program, for one) simply lack it, so every list is defaulted here
 * rather than trusted — a client link from any past release must still render.
 */
function withLists<T extends ClientOfferDTO>(offer: T): T {
  const list = <V,>(value: V[] | undefined): V[] => (Array.isArray(value) ? value : []);
  return {
    ...offer,
    hotels: list(offer.hotels),
    flights: list(offer.flights),
    transport: list(offer.transport),
    visas: list(offer.visas),
    includes: list(offer.includes),
    excludes: list(offer.excludes),
    terms: list(offer.terms),
    climate: list(offer.climate),
    days: list(offer.days),
  };
}

export function OfferDocument(props: OfferDocumentProps) {
  const offer = withLists(props.offer); // union — shared (sell-side) fields only
  const assets = props.assets ?? DEFAULT_OFFER_DOC_ASSETS;
  const brand = props.brand ?? TRAVELIUN_BRAND;
  // The internal document exists to show buy/sell/profit — hiding money there
  // would leave an empty page and no way to ask for the numbers.
  const showPrices = props.variant === "internal" ? true : props.showPrices !== false;
  const nights = tripNights(offer);
  const days = nights > 0 ? nights + 1 : 0;
  const title = offer.destination ? AR.offerTitleFor(offer.destination) : brand.nameAr;

  // `internal` = a domestic hop inside the destination country; everything else
  // (outbound/inbound, and legs with no order) is international.
  const intl = offer.flights.filter((f) => f.leg_order !== "internal");
  const domestic = offer.flights.filter((f) => f.leg_order === "internal");
  // A stay is flagged when a domestic hop departs the day the guest checks out.
  const domesticDepartureDates = new Set(
    domestic.map((f) => (f.departure_at ?? "").slice(0, 10)).filter(Boolean),
  );

  // ---- build the blocks in reading order, then fill sheets with them ----
  const blocks: DocBlock[] = [];

  const intlRows = intl.length;
  const domesticRows = domestic.length;
  if (intlRows > 0) {
    blocks.push({
      group: "flights",
      title: AR.flights,
      note: AR.flightsIntlNote,
      heightMm: SUBHEADING_MM + tableMm(intlRows),
      kind: "node",
      node: (
        <>
          <h3 className="od-subhead">{AR.flightsIntl}</h3>
          <FlightTable flights={intl} />
        </>
      ),
    });
  }
  if (domesticRows > 0) {
    blocks.push({
      group: "flights",
      title: AR.flights,
      note: AR.flightsIntlNote,
      heightMm: SUBHEADING_MM + tableMm(domesticRows),
      kind: "node",
      node: (
        <>
          <h3 className="od-subhead">{AR.flightsDomestic}</h3>
          <FlightTable flights={domestic} />
        </>
      ),
    });
  }
  // The note is about prices moving until ticketing; with no price printed it
  // would be answering a question the document never asks.
  if (intlRows + domesticRows > 0 && showPrices) {
    blocks.push({
      group: "flights",
      title: AR.flights,
      heightMm: 18,
      kind: "node",
      node: <p className="od-note">{AR.flightPriceNote}</p>,
    });
  }

  if (offer.visas.length > 0) {
    blocks.push({
      group: "visas",
      title: AR.visas,
      heightMm: tableMm(offer.visas.length, 11),
      kind: "node",
      node: (
        <table className="od-table">
          <thead>
            <tr>
              <th>{AR.colItem}</th>
              <th>{AR.destination}</th>
            </tr>
          </thead>
          <tbody>
            {offer.visas.map((v, i) => (
              <tr key={i}>
                <td>{v}</td>
                <td>{offer.destination || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
    });
  }

  const isFlagged = (h: ClientOfferDTO["hotels"][number]) =>
    Boolean(h.check_out && domesticDepartureDates.has(h.check_out));
  offer.hotels.forEach((stay, i) => {
    blocks.push({
      group: "stays",
      title: AR.accommodation,
      note: intl.length === 0 ? AR.accommodationNoIntlNote : AR.accommodationNote,
      heightMm: stayHeightMm(stay, isFlagged(stay)) + 4,
      kind: "stay",
      stay,
      flagDomestic: isFlagged(stay),
    });
    void i;
  });

  if (offer.days.length > 0 || offer.transport.length > 0) {
    const rows = offer.days.length * 22 + offer.transport.length * 12;
    blocks.push({
      group: "tours",
      title: AR.tours,
      note: hasAnyWeather(offer) ? AR.toursWeatherYes : AR.toursWeatherNo,
      heightMm: 14 + rows + (offer.days.length > 0 ? 18 : 0),
      kind: "node",
      node: <ToursTable offer={offer} />,
    });
  }

  blocks.push({
    group: "services",
    // With no price on the page the section is only what is included and what is
    // not, so the heading must not promise a price.
    title: showPrices ? AR.servicesAndPrice : AR.servicesOnly,
    note: showPrices ? AR.servicesAndPriceNote : undefined,
    heightMm: servicesHeightMm(offer, showPrices),
    kind: "node",
    node: <ServicesAndPrice offer={offer} nights={nights} days={days} showPrices={showPrices} />,
  });

  if (props.variant === "internal") {
    blocks.push({
      group: "internal",
      title: AR.internalTitle,
      heightMm: 20 + tableMm(props.offer.pricing.lines.length + 1, 11),
      kind: "node",
      node: <InternalPrice offer={props.offer} />,
    });
  }

  offer.terms.forEach((clause) => {
    blocks.push({
      group: "terms",
      title: AR.terms,
      // the bordered contract box repeats its own header on every sheet it spans
      runOverheadMm: 18,
      heightMm: termHeightMm(clause),
      kind: "clause",
      clause,
    });
  });

  const bodyPages = packBlocks(blocks);
  // clause numbering runs across sheets, so it is tracked while rendering
  let clauseNo = 0;
  const rendered = bodyPages.map((page, pageIndex) => {
    const runs: { group: string; title: string; note?: string; items: DocBlock[] }[] = [];
    for (const block of page) {
      const last = runs[runs.length - 1];
      if (last && last.group === block.group) last.items.push(block);
      else runs.push({ group: block.group, title: block.title, note: block.note, items: [block] });
    }
    return {
      key: `page-${pageIndex}`,
      section: runs.map((r) => r.title).join(" · "),
      body: runs.map((run, runIndex) => {
        const first = runIndex === 0;
        const heading = first ? (
          <SectionTitle title={run.title} note={run.note} />
        ) : (
          <h2 className="od-subhead od-subhead-major">{run.title}</h2>
        );
        if (run.group === "terms") {
          const start = clauseNo + 1;
          clauseNo += run.items.length;
          return (
            <div key={run.group + runIndex} className="od-run">
              {heading}
              <div className="od-terms">
                <h2>{AR.termsContract}</h2>
                <ol start={start}>
                  {run.items.map((b, i) => (
                    <li key={i}>{b.kind === "clause" ? b.clause : null}</li>
                  ))}
                </ol>
              </div>
            </div>
          );
        }
        return (
          <div key={run.group + runIndex} className="od-run">
            {heading}
            {run.items.map((b, i) =>
              b.kind === "stay" ? (
                <StayCard
                  key={i}
                  stay={b.stay}
                  country={offer.destination}
                  travelers={{ adults: offer.adults, children: offer.children, infants: offer.infants }}
                  flagDomestic={b.flagDomestic}
                />
              ) : b.kind === "node" ? (
                <div key={i}>{b.node}</div>
              ) : null,
            )}
          </div>
        );
      }),
    };
  });

  const pages = [
    {
      key: "cover",
      section: `${brand.nameLatin} Travel Offer`,
      cover: true,
      body: (
        <Cover
          offer={offer}
          nights={nights}
          days={days}
          title={title}
          brand={brand}
          // Our logo above a partner's name would be the worst of both — the
          // house asset is a fallback for the HOUSE brand only. A partner with no
          // logo yet gets their name set as a wordmark instead.
          logoUrl={brand.vars ? brand.logoUrl : (brand.logoUrl ?? assets.logoUrl)}
        />
      ),
    },
    ...rendered.map((p) => ({ ...p, cover: false })),
  ];

  const lastKey = pages[pages.length - 1]?.key;

  return (
    <article
      className="od-root"
      dir="rtl"
      lang="ar"
      // brand.vars is null for our own document, so its hand-tuned palette in
      // styles.ts stands untouched; a partner's two colours override the whole
      // derived set at once.
      style={{ ["--od-map" as string]: `url("${assets.mapUrl}")`, ...(brand.vars ?? {}) }}
    >
      <style dangerouslySetInnerHTML={{ __html: OFFER_DOC_CSS }} />
      {pages.map((p) => (
        <section key={p.key} className={`od-page${p.cover ? " od-cover" : ""}`} data-section={p.section}>
          {p.body}
          <div className="od-foot">
            <span>{offer.serial}</span>
            <span>
              {p.key === lastKey && offer.employee_name
                ? `${AR.employeeFooter(offer.employee_name)} | ${p.section}`
                : p.section}
            </span>
          </div>
        </section>
      ))}
    </article>
  );
}

// ---------------- cover ----------------
function Cover({
  offer,
  nights,
  days,
  title,
  brand,
  logoUrl,
}: {
  offer: ClientOfferDTO;
  nights: number;
  days: number;
  title: string;
  brand: DocBrand;
  logoUrl: string | null;
}) {
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
        {/* Each contact line renders only if the brand has it: a partner who gave
            us no website gets a shorter block, never our address under their
            logo. */}
        <div className="od-company">
          <h2>{brand.nameAr}</h2>
          {brand.address ? <div>{brand.address}</div> : null}
          {brand.phone ? <div>{AR.callLabel}: <Ltr>{brand.phone}</Ltr></div> : null}
          {brand.whatsapp ? <div>{AR.whatsappLabel}: <Ltr>{brand.whatsapp}</Ltr></div> : null}
          {brand.website ? <div>{AR.webLabel}: <Ltr>{brand.website}</Ltr></div> : null}
          {brand.email ? <div>{AR.emailLabel}: <Ltr>{brand.email}</Ltr></div> : null}
        </div>
      </div>

      <div className="od-hero">
        <div className="od-hero-label">{AR.coverLabel}</div>
        <h1>{title}</h1>
        <div className="od-hero-meta">
          {AR.daysNights(days, nights)} | {AR.serial} <Ltr>{offer.serial}</Ltr>
        </div>
      </div>

      <div className="od-metrics">
        <Metric label={AR.adults} value={String(offer.adults)} />
        <Metric label={AR.children} value={String(offer.children)} />
        <Metric label={AR.infants} value={String(offer.infants)} />
        <Metric label={AR.offerDate} value={fmtDate(offer.issue_date ?? offer.offer_date)} ltr />
      </div>

      <div className="od-panel">
        <div className="od-panel-head">
          <span>{AR.customerInfo}</span>
          <span>{AR.offerInfo}</span>
        </div>
        <table className="od-info">
          <tbody>
            <tr>
              <th>{AR.customer}</th>
              <td>{offer.customer_name || "—"}</td>
              <th>{AR.destination}</th>
              <td>{offer.destination || "—"}</td>
            </tr>
            <tr>
              <th>{AR.contactField}</th>
              <td>{offer.customer_phone ? <Ltr>{offer.customer_phone}</Ltr> : "—"}</td>
              <th>{AR.duration}</th>
              <td>{AR.daysNights(days, nights)}</td>
            </tr>
            <tr>
              <th>{AR.serial}</th>
              <td><Ltr>{offer.serial}</Ltr></td>
              <th>{AR.travelers}</th>
              <td>
                <Ltr>{`${offer.adults}`}</Ltr> {AR.adults} | <Ltr>{`${offer.children}`}</Ltr> {AR.children} |{" "}
                <Ltr>{`${offer.infants}`}</Ltr> {AR.infants}
              </td>
            </tr>
            {/* the programme window — this used to be a second «ملخص سريع» panel
                further down the document, repeating the duration and travellers
                already stated here. One table, read once, on the first page. */}
            <tr>
              <th>{AR.programStart}</th>
              <td><Ltr>{fmtDate(offer.arrival_date)}</Ltr></td>
              <th>{AR.programEnd}</th>
              <td><Ltr>{fmtDate(offer.departure_date)}</Ltr></td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function Metric({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div className="od-metric">
      <span>{label}</span>
      <strong>{ltr ? <Ltr>{value}</Ltr> : value}</strong>
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

// ---------------- stays ----------------
function StayCard({
  stay,
  country,
  travelers,
  flagDomestic,
}: {
  stay: ClientOfferDTO["hotels"][number];
  country: string | null;
  travelers: { adults: number; children: number; infants: number };
  flagDomestic: boolean;
}) {
  const roomCount = Math.max(stay.rooms_count || 0, 1);
  const starText = stars(stay.stars);
  const heading = [country, stay.city_name].filter(Boolean).join(" - ");
  return (
    <div className="od-stay">
      <div className="od-datebox">
        <span>{AR.checkIn}</span>
        <strong><Ltr>{fmtDate(stay.check_in)}</Ltr></strong>
        <span>{AR.checkOut}</span>
        <strong><Ltr>{fmtDate(stay.check_out)}</Ltr></strong>
        <span>{stay.nights != null ? AR.nightsCount(stay.nights) : "—"}</span>
      </div>

      <div className="od-hotel">
        <h3>
          {heading || "—"}
          <br />
          {stay.hotel_name || "—"}
        </h3>
        <p>
          {AR.roomsCount}: <Ltr>{String(roomCount)}</Ltr>
          {stay.board_type ? ` | ${BOARD_AR[stay.board_type]}` : ""}
        </p>
        {/* with a single room the occupancy is already printed in the room box */}
        {roomCount > 1 ? (
          <p>
            {AR.travelers}: <Ltr>{String(travelers.adults)}</Ltr> {AR.adults} ·{" "}
            <Ltr>{String(travelers.children)}</Ltr> {AR.children} ·{" "}
            <Ltr>{String(travelers.infants)}</Ltr> {AR.infants}
          </p>
        ) : null}
        {starText ? <div className="od-stars">{starText}</div> : null}
        {stay.cancellation_policy ? (
          <div className="od-notice">{AR.cancellation}: {stay.cancellation_policy}</div>
        ) : null}
        {stay.excluded_surcharges.length > 0 ? (
          <div className="od-notice">
            {AR.payAtHotel}:{" "}
            {stay.excluded_surcharges.map((s, i) => (
              <span key={i}>
                {i > 0 ? "، " : ""}
                {s.name} (<Ltr>{`${s.amount} ${s.currency}`}</Ltr>)
              </span>
            ))}
          </div>
        ) : null}
        {flagDomestic ? <div className="od-notice">{AR.domesticFlightAfterStay}</div> : null}
      </div>

      <div className="od-rooms">
        {Array.from({ length: roomCount }, (_, i) => (
          <div key={i} className="od-room">
            <strong>
              {AR.room(i + 1)}
              {stay.room_type ? ` - ${stay.room_type}` : ""}
            </strong>
            {roomCount === 1 ? (
              <div className="od-counts">
                <span>{AR.adults} <Ltr>{String(travelers.adults)}</Ltr></span>
                <span>{AR.children} <Ltr>{String(travelers.children)}</Ltr></span>
                <span>{AR.infants} <Ltr>{String(travelers.infants)}</Ltr></span>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- flights ----------------
function FlightTable({ flights }: { flights: ClientOfferDTO["flights"] }) {
  return (
    <table className="od-table">
      <thead>
        <tr>
          <th>{AR.flightLeg}</th>
          <th>{AR.airline}</th>
          <th>{AR.flightNo}</th>
          <th>{AR.route}</th>
          <th>{AR.departure}</th>
          <th>{AR.arrival}</th>
          <th>{AR.cabin}</th>
          <th>{AR.baggage}</th>
        </tr>
      </thead>
      <tbody>
        {flights.map((f, i) => (
          <tr key={i}>
            <td>{f.leg_order ? LEG_AR[f.leg_order] : "—"}</td>
            <td>{f.airline || "—"}</td>
            <td>{f.flight_no ? <Ltr>{f.flight_no}</Ltr> : "—"}</td>
            <td><Ltr>{`${f.from_airport || "—"} → ${f.to_airport || "—"}`}</Ltr></td>
            <td className="od-tnum"><Ltr>{fmtDateTime(f.departure_at)}</Ltr></td>
            <td className="od-tnum"><Ltr>{fmtDateTime(f.arrival_at)}</Ltr></td>
            <td>{f.cabin_class || "—"}</td>
            <td>{f.baggage_allowance || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------- transfers / tours / weather ----------------
/** True when at least one day carries a usable reading — drives the section note. */
function hasAnyWeather(offer: ClientOfferDTO): boolean {
  return offer.days.some(
    (d) =>
      d.weather_source &&
      !isWeatherEmpty({
        temp_max: d.temp_max,
        temp_min: d.temp_min,
        rain_chance: d.rain_chance,
        code: d.weather_code,
        source: d.weather_source,
        fetched_at: "",
      }),
  );
}

function ToursTable({ offer }: { offer: ClientOfferDTO }) {
  return (
    <>
      <table className="od-table">
        <thead>
          <tr>
            <th style={{ width: "30mm" }}>{AR.colDate}</th>
            <th style={{ width: "34mm" }}>{AR.colService}</th>
            <th>{AR.colDetails}</th>
          </tr>
        </thead>
        <tbody>
          {offer.days.map((day) => (
            <tr key={`d-${day.day_number}`}>
              <td className="od-tnum"><Ltr>{fmtDate(day.date)}</Ltr></td>
              <td>{day.city_name || "—"}</td>
              <td>
                <span className="od-route">{day.title || day.city_name || "—"}</span>
                {day.activities.join(" · ")}
                <DayWeather day={day} />
              </td>
            </tr>
          ))}
          {offer.transport.map((t, i) => (
            <tr key={`t-${i}`}>
              <td>—</td>
              <td>{AR.transport}</td>
              <td>{t}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {offer.days.length > 0 ? <div className="od-note">{AR.weatherNote}</div> : null}
    </>
  );
}

/**
 * The weather line under a day. The SOURCE is printed, always: a climate
 * average must never be read as a forecast for that date.
 */
function DayWeather({ day }: { day: ClientOfferDTO["days"][number] }) {
  if (!day.weather_source) return null;
  const snapshot = {
    temp_max: day.temp_max,
    temp_min: day.temp_min,
    rain_chance: day.rain_chance,
    code: day.weather_code,
    source: day.weather_source,
    fetched_at: "",
  };
  if (isWeatherEmpty(snapshot)) return null;
  return (
    <span className="od-sub">
      {AR.weather}: <Ltr>{formatTempsAr(snapshot)}</Ltr>
      {weatherCodeAr(snapshot.code) ? ` · ${weatherCodeAr(snapshot.code)}` : ""}
      {formatRainAr(snapshot) ? ` · ${formatRainAr(snapshot)}` : ""} ({weatherSourceAr(snapshot.source)})
    </span>
  );
}

// ---------------- services / price ----------------
/** The block is tall and near-fixed: two list cards, the total, and the summary. */
function servicesHeightMm(offer: ClientOfferDTO, showPrices: boolean): number {
  const rows = Math.max(offer.includes.length, offer.excludes.length);
  const cards = offer.includes.length + offer.excludes.length > 0 ? Math.max(70, 16 + rows * 8) : 0;
  // cards + price band + payment note. The «ملخص سريع» panel that used to add
  // ~48mm here now lives on the cover, so this section is that much shorter —
  // leaving the estimate high would waste most of a sheet. A price-less file
  // loses both the band and the note, so the estimate has to lose them too or
  // the packer reserves 54mm of nothing.
  return cards + (showPrices ? 34 + 20 : 0);
}

function ServicesAndPrice({
  offer,
  nights,
  days,
  showPrices,
}: {
  offer: ClientOfferDTO;
  nights: number;
  days: number;
  showPrices: boolean;
}) {
  return (
    <>
      {offer.includes.length > 0 || offer.excludes.length > 0 ? (
        <div className="od-two">
          <div className="od-listcard">
            <h3>{AR.includesCard}</h3>
            <ul>
              {offer.includes.map((s, i) => (
                <li key={i}>
                  <Ltr>{String(i + 1)}</Ltr>. {s}
                </li>
              ))}
            </ul>
          </div>
          <div className="od-listcard">
            <h3>{AR.excludesCard}</h3>
            <ul>
              {offer.excludes.map((s, i) => (
                <li key={i}>
                  <Ltr>{String(i + 1)}</Ltr>. {s}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {showPrices ? (
        <>
          <div className="od-price">
            <span>{AR.total}</span>
            <strong><Ltr>{offer.total != null ? fmtNum(offer.total, 2) : "—"}</Ltr></strong>
            <span>{offer.currency ?? ""}</span>
          </div>
          <p className="od-note">{AR.paymentTerms}</p>
        </>
      ) : null}
    </>
  );
}

/** INTERNAL-only pricing table (buy / sell / profit). Never in the client tree. */
function InternalPrice({ offer }: { offer: InternalOfferDTO }) {
  const p = offer.pricing;
  return (
    <>
      <div className="od-internal-note">{AR.internalNote}</div>
      <table className="od-table">
        <thead>
          <tr>
            <th>{AR.item}</th>
            <th>{AR.buy}</th>
            <th>{AR.sell}</th>
            <th>{AR.profit}</th>
            <th>{AR.margin}</th>
          </tr>
        </thead>
        <tbody>
          {p.lines.map((line, i) => (
            <tr key={i}>
              <td>{line.description || (line.item_type ? ITEM_TYPE_AR[line.item_type] : "—")}</td>
              <td className="od-tnum"><Ltr>{fmtNum(line.base_buy, 2)}</Ltr></td>
              <td className="od-tnum"><Ltr>{fmtNum(line.base_sell, 2)}</Ltr></td>
              <td className="od-tnum"><Ltr>{fmtNum(line.profit_base, 2)}</Ltr></td>
              <td className="od-tnum"><Ltr>{line.margin_pct != null ? `${fmtNum(line.margin_pct, 1)}%` : "—"}</Ltr></td>
            </tr>
          ))}
          <tr>
            <td style={{ fontWeight: 800 }}>{p.base}</td>
            <td className="od-tnum" style={{ fontWeight: 800 }}><Ltr>{fmtNum(p.total_buy, 2)}</Ltr></td>
            <td className="od-tnum" style={{ fontWeight: 800 }}><Ltr>{fmtNum(p.total_sell, 2)}</Ltr></td>
            <td className="od-tnum" style={{ fontWeight: 800, color: "#0f7a52" }}><Ltr>{fmtNum(p.profit, 2)}</Ltr></td>
            <td className="od-tnum" style={{ fontWeight: 800 }}><Ltr>{p.margin_pct != null ? `${fmtNum(p.margin_pct, 1)}%` : "—"}</Ltr></td>
          </tr>
        </tbody>
      </table>
    </>
  );
}
