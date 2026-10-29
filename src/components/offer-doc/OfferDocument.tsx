import type { ReactNode } from "react";
import { DirText } from "@/components/DirText";
import type { ClientOfferDTO, InternalOfferDTO } from "@/lib/offer/dto";
import {
  AR,
  BOARD_AR,
  ITEM_TYPE_AR,
  LEG_AR,
  fmtDate,
  fmtDayMonth,
  fmtRange,
  fmtShortDate,
  fmtNum,
  stars,
} from "./labels";
import { FLIGHTS_LATER_LINE, isFreeDay } from "@/lib/offer/draft-types";
import { TOUR_CAR_LINE } from "@/lib/offer/itinerary";
import { hasFinance, type FinanceSection } from "@/lib/offer/finance-terms";
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
/** One ticket (band + route, stub beside) — ~37mm, kept with a little air. */
const flightCardsMm = (rows: number) => rows * 41;

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

/**
 * The stays in the order the group checks in, and two (or more) hotels on the
 * very same dates in one city kept together — one stay, its rooms split over them.
 */
export function stayRuns<T extends { city_name: string | null; check_in: string | null; check_out: string | null }>(hotels: T[]): T[][] {
  const sorted = hotels
    .map((h, i) => ({ h, i }))
    .sort((a, b) => (a.h.check_in ?? "9999").localeCompare(b.h.check_in ?? "9999") || a.i - b.i)
    .map((x) => x.h);
  const runs = new Map<string, T[]>();
  sorted.forEach((h, i) => {
    const key = h.check_in && h.check_out ? `${h.city_name}|${h.check_in}|${h.check_out}` : `#${i}`;
    runs.set(key, [...(runs.get(key) ?? []), h]);
  });
  return [...runs.values()];
}

/** Nights from the stays — different nights, so two hotels on the same dates count once; falls back to the arrival→departure span. */
function tripNights(offer: ClientOfferDTO): number {
  const dated = new Set<string>();
  let undated = 0;
  for (const h of offer.hotels) {
    const n = h.nights ?? 0;
    if (!h.check_in) undated += n;
    else for (let k = 0; k < n; k++) dated.add(new Date(Date.parse(`${h.check_in}T00:00:00Z`) + k * 86400000).toISOString().slice(0, 10));
  }
  const fromHotels = dated.size + undated;
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
  // The NESTED arrays too, not only the top-level ones. A snapshot frozen before
  // `excluded_surcharges` existed reached stayHeightMm as undefined and threw —
  // so an old published offer produced a 500 on its own PDF while its preview,
  // which reads live data, was fine. Every list the document iterates is
  // defaulted here, once.
  const hotels = list(offer.hotels).map((h) => ({
    ...h,
    excluded_surcharges: list(h.excluded_surcharges),
    facilities: list(h.facilities),
  }));
  return {
    ...offer,
    hotels,
    // the days name the hotel they mean — here, on what the client reads, never in the text the agent edits
    days: withHotelNames(
      list(offer.days).map((d) => ({ ...d, activities: list(d.activities), transport_note: d.transport_note ?? null })),
      hotels,
    ),
    flights: list(offer.flights),
    transport: list(offer.transport),
    visas: list(offer.visas),
    // «أضف لاحقاً» is said where the flights would be, not as something the price includes
    includes: list(offer.includes).filter((l) => l !== FLIGHTS_LATER_LINE),
    excludes: list(offer.excludes),
    terms: list(offer.terms),
    climate: list(offer.climate),
  };
}

export function OfferDocument(props: OfferDocumentProps) {
  const offer = withLists(props.offer); // union — shared (sell-side) fields only
  // issued with a part of its flights «أضف لاحقاً» (drafts.ts produce writes the line)
  const flightsLater = (props.offer.includes ?? []).includes(FLIGHTS_LATER_LINE);
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
      heightMm: SUBHEADING_MM + flightCardsMm(intlRows),
      kind: "node",
      node: (
        <>
          <h3 className="od-subhead">{AR.flightsIntl}</h3>
          <FlightCards flights={intl} />
        </>
      ),
    });
  }
  if (domesticRows > 0) {
    blocks.push({
      group: "flights",
      title: AR.flights,
      heightMm: SUBHEADING_MM + flightCardsMm(domesticRows),
      kind: "node",
      node: (
        <>
          <h3 className="od-subhead">{AR.flightsDomestic}</h3>
          <FlightCards flights={domestic} />
        </>
      ),
    });
  }
  if (flightsLater) {
    blocks.push({
      group: "flights",
      title: AR.flights,
      heightMm: 18,
      kind: "node",
      node: <p className="od-note">{FLIGHTS_LATER_LINE}</p>,
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
  for (const run of stayRuns(offer.hotels)) {
    if (run.length === 1) {
      const [stay] = run;
      blocks.push({ group: "stays", title: AR.accommodation, heightMm: stayHeightMm(stay, isFlagged(stay)) + 4, kind: "stay", stay, flagDomestic: isFlagged(stay) });
      continue;
    }
    // one stay split over two hotels (ق5): side by side under one line, never apart on two sheets
    blocks.push({
      group: "stays",
      title: AR.accommodation,
      heightMm: SUBHEADING_MM + run.reduce((sum, stay) => sum + stayHeightMm(stay, isFlagged(stay)) + 4, 0),
      kind: "node",
      node: (
        <>
          <h3 className="od-subhead">{AR.splitStay(run.length)}</h3>
          {run.map((stay, i) => (
            <StayCard
              key={i}
              stay={stay}
              country={offer.destination}
              travelers={{ adults: offer.adults, children: offer.children, infants: offer.infants }}
              flagDomestic={isFlagged(stay)}
            />
          ))}
        </>
      ),
    });
  }

  // the programme city by city: one block per visit (cut where a visit is taller
  // than a sheet), so a city heading always travels with its days
  if (offer.days.length > 0 || offer.transport.length > 0) {
    const note = hasAnyWeather(offer) ? AR.toursWeatherYes : AR.toursWeatherNo;
    const tours = (heightMm: number, node: ReactNode): DocBlock => ({ group: "tours", title: AR.tours, note, heightMm, kind: "node", node });
    for (const visit of cityVisits(offer.days)) {
      const hotels = visit.city ? visitHotels(visit, offer.hotels) : [];
      const head = visit.city ? VISIT_HEAD_MM + (hotels.join("، ").length > 50 ? 5 : 0) : 0;
      for (const days of chunkDays(visit.days, head)) {
        blocks.push(
          tours(
            head + days.reduce((sum, d) => sum + dayHeightMm(d), 0) + 4,
            <VisitTable
              city={visit.city}
              from={visit.days[0].date}
              to={visit.days[visit.days.length - 1].date}
              hotels={hotels}
              days={days}
              // the day home — a one-day programme has none apart from its arrival
              last={offer.days.length > 1 ? offer.days.at(-1)?.day_number : undefined}
            />,
          ),
        );
      }
    }
    // An offer whose days carry their own transport line does not repeat it as
    // loose rows underneath; an older one still prints them.
    const loose = offer.days.some((d) => d.transport_note) ? [] : offer.transport;
    if (loose.length > 0) {
      blocks.push(
        tours(
          tableMm(loose.length, 12),
          <table className="od-table od-days">
            <thead>
              <tr>
                <th>{AR.transport}</th>
              </tr>
            </thead>
            <tbody>
              {loose.map((t, i) => (
                <tr key={i}>
                  <td>{t}</td>
                </tr>
              ))}
            </tbody>
          </table>,
        ),
      );
    }
    if (offer.days.length > 0) blocks.push(tours(18, <div className="od-note">{AR.weatherNote}</div>));
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
      <CompanyHeader brand={brand} logoUrl={logoUrl} />

      <div className="od-hero">
        <div className="od-hero-label">{AR.coverLabel}</div>
        <h1>{title}</h1>
        <div className="od-hero-meta">
          {AR.daysNights(days, nights)} | {AR.serial} <Ltr>{offer.serial}</Ltr>
        </div>
      </div>

      <div className="od-metrics">
        {/* a nought says nothing to the client: no «طفل 0» box */}
        <Metric label={AR.adults} value={String(offer.adults)} />
        {offer.children > 0 ? <Metric label={AR.children} value={String(offer.children)} /> : null}
        {offer.infants > 0 ? <Metric label={AR.infants} value={String(offer.infants)} /> : null}
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
                {/* «2 بالغ» — the noughts left out */}
                {(
                  [
                    [offer.adults, AR.adults],
                    [offer.children, AR.children],
                    [offer.infants, AR.infants],
                  ] as const
                )
                  .filter(([n], i) => i === 0 || n > 0)
                  .map(([n, label], i) => (
                    <span key={label}>
                      {i > 0 ? " | " : ""}
                      <Ltr>{String(n)}</Ltr> {label}
                    </span>
                  ))}
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

/** The company block and logo that open a document — the cover's top, shared with the flight card. */
export function CompanyHeader({ brand, logoUrl }: { brand: DocBrand; logoUrl: string | null }) {
  // Company first in the DOM, so it lands on the right in Arabic; the logo
  // second, on the left. Order in the markup is the order on the page here —
  // not a float — so the same source prints identically.
  return (
    <div className="od-top">
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
      <div>
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="od-logo" src={logoUrl} alt={brand.nameLatin} />
        ) : (
          <div className="od-wordmark">{brand.nameAr}</div>
        )}
      </div>
    </div>
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
  const place = [country, stay.city_name].filter(Boolean).join(" — ");
  // a zero says nothing — «2 بالغ» rather than «بالغ 2 · طفل 0 · رضيع 0»
  const guests = [
    `${travelers.adults} ${AR.adults}`,
    travelers.children > 0 ? `${travelers.children} ${AR.children}` : "",
    travelers.infants > 0 ? `${travelers.infants} ${AR.infants}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="od-stay">
      <div className="od-datebox">
        <span>{AR.checkIn}</span>
        <strong>{fmtShortDate(stay.check_in)}</strong>
        <span>{AR.checkOut}</span>
        <strong>{fmtShortDate(stay.check_out)}</strong>
        <span>{stay.nights != null ? AR.nightsCount(stay.nights) : "—"}</span>
      </div>

      <div className="od-hotel">
        <div className="od-hotel-top">
          <h3>{stay.hotel_name || "—"}</h3>
          {starText ? <span className="od-stars">{starText}</span> : null}
        </div>
        {place ? <p className="od-hotel-place">{place}</p> : null}
        {/* each answer under its name: a client read «Bedroom Jacuzzi Villa 1» alone and did not know it was the room */}
        <dl className="od-facts">
          {stay.room_type ? (
            <div className="od-fact od-fact-wide">
              <dt>{AR.roomType}</dt>
              <dd>
                <bdi>{stay.room_type}</bdi>
              </dd>
            </div>
          ) : null}
          <div className="od-fact">
            <dt>{AR.roomsCount}</dt>
            <dd>
              <Ltr>{String(roomCount)}</Ltr>
            </dd>
          </div>
          {stay.board_type ? (
            <div className="od-fact">
              <dt>{AR.board}</dt>
              <dd>{BOARD_AR[stay.board_type]}</dd>
            </div>
          ) : null}
          <div className="od-fact">
            <dt>{AR.travelers}</dt>
            <dd>{guests}</dd>
          </div>
        </dl>
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
    </div>
  );
}

// ---------------- flights ----------------
/** «مطار الملك خالد الدولي (RUH)» → RUH, else the name. */
const airportCode = (airport: string | null) => airport?.match(/\(([A-Za-z0-9]{3,5})\)/)?.[1] ?? null;
/** The name without its (CODE). */
const airportName = (airport: string | null) => (airport ?? "").replace(/\s*\([A-Za-z0-9]{3,5}\)\s*$/, "").trim();

/**
 * Each flight as a boarding pass: who and which flight on a strip, then the two
 * ends — the airport code large, the time, the day — with the line between
 * them. A table of eight columns broke every airport name over three lines.
 */
export function FlightCards({ flights }: { flights: ClientOfferDTO["flights"] }) {
  return (
    <div>
      {flights.map((f, i) => {
        const dayShift = dayOffset(f.departure_at, f.arrival_at);
        return (
          <div key={i} className="od-fl">
            <div className="od-fl-main">
              <div className="od-fl-head">
                {f.leg_order ? <span className="od-fl-leg">{LEG_AR[f.leg_order]}</span> : null}
                {!f.flight_no ? <span className="od-fl-planned">{AR.flightPlanned}</span> : null}
                {/* The carrier's mark beside its name: a client scanning the page
                    recognises the logo before they read the Arabic. */}
                <span className="od-carrier">
                  {f.airline_logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="od-carrier-logo" src={f.airline_logo_url} alt={f.airline_iata ?? ""} />
                  ) : null}
                  <span>{f.airline || "—"}</span>
                </span>
              </div>
              <div className="od-fl-route">
                <FlightEnd airport={f.from_airport} at={f.departure_at} planned={!f.flight_no} />
                <div className="od-fl-line">
                  <span>✈</span>
                </div>
                <FlightEnd airport={f.to_airport} at={f.arrival_at} shift={dayShift} planned={!f.flight_no} />
              </div>
            </div>
            {/* the stub, as on a boarding pass: what the traveller is asked at the counter */}
            <div className="od-fl-stub">
              <div>
                <span>{AR.flightNo}</span>
                <strong>
                  <Ltr>{f.flight_no || "—"}</Ltr>
                </strong>
              </div>
              <div>
                <span>{AR.cabin}</span>
                <strong>{f.cabin_class || "—"}</strong>
              </div>
              <div>
                <span>{AR.baggage}</span>
                <strong>{f.baggage_allowance || "—"}</strong>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FlightEnd({ airport, at, shift = 0, planned = false }: { airport: string | null; at: string | null; shift?: number; planned?: boolean }) {
  const code = airportCode(airport);
  // a planned leg carries a day, not a time: «00:00» would be read as midnight
  const time = at && at.length > 10 && !(planned && at.slice(11, 16) === "00:00") ? at.slice(11, 16) : null;
  return (
    <div className="od-fl-end">
      <strong>
        <Ltr>{code ?? (airportName(airport) || "—")}</Ltr>
      </strong>
      <b className="od-tnum">
        <Ltr>{time ?? "—"}</Ltr>
        {shift > 0 ? (
          <span className="od-fl-plus" dir="ltr">
            +{shift}
          </span>
        ) : null}
      </b>
      <span>{fmtDayMonth(at)}</span>
      {code ? <small>{airportName(airport)}</small> : null}
    </div>
  );
}

/** Whole days between two local wall-clock times — «+1» on a flight landing the next day. */
function dayOffset(from: string | null, to: string | null): number {
  if (!from || !to) return 0;
  const ms = Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : 0;
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

type Day = ClientOfferDTO["days"][number];

/**
 * The programme as a client reads it: city by city. A visit is a run of
 * consecutive days in one city, so a city the trip returns to is a visit of its
 * own. Issued days carry only the city's name and the date — no key — and
 * that is enough: the days are stored in order. Travel days have no city.
 */
function cityVisits(days: Day[]): { city: string; days: Day[] }[] {
  const visits: { city: string; days: Day[] }[] = [];
  for (const day of days) {
    const last = visits[visits.length - 1];
    if (last && last.city === day.city_name) last.days.push(day);
    else visits.push({ city: day.city_name, days: [day] });
  }
  return visits;
}

/** The hotels of THIS visit: its city, and a stay that overlaps its days — two on the same dates are both named. */
function visitHotels(visit: { city: string; days: Day[] }, hotels: ClientOfferDTO["hotels"]): string[] {
  const from = visit.days[0].date;
  const to = visit.days[visit.days.length - 1].date;
  const names = hotels
    .filter((h) => h.city_name === visit.city && (!from || !to || !h.check_in || (h.check_in <= to && (!h.check_out || h.check_out > from))))
    .map((h) => h.hotel_name?.trim() ?? "")
    .filter(Boolean);
  return [...new Set(names)];
}

/**
 * «الفندق» as a word of its own — not «الفندقية», not «بالفندق»; a clause may end on it («الفندق،»). No lookbehind:
 * an older Safari would not parse it.
 */
const HOTEL_WORD = /(^|[^\u0600-\u06FF])الفندق(?![\u0600-\u060B\u060D-\u061A\u061C-\u061E\u0620-\u06FF])/g;
/** What comes before the word says which hotel it is: the one left («تسجيل الخروج من», «مغادرة», «إخلاء») … */
const HOTEL_OUT = /(?:الخروج|خروج|المغادرة|مغادرة|إخلاء)(?:\s+(?:المتأخر|متأخر))?(?:\s+(?:من|عن))?\s*$/;
/** … a pickup point («الاستقبال من الفندق» — «بكج متقدم»'s hotel not named), never ours … */
const HOTEL_PICKUP = /[اإ]ستقبال\S*\s+من\s*$/;
/** … the one the day starts from («الانطلاق من») … */
const HOTEL_FROM = /(?:^|\s)(?:من|عن)\s*$/;
/** … or the one the group goes to and sleeps in («التوجه إلى», «العودة الي», «الدخول في»). */
const HOTEL_TO = /(?:(?:^|\s)(?:إلى|الى|الي|إلي)|الدخول\s+في|(?:المبيت|الإقامة)\s+في)\s*$/;
/** Where the day leaves its hotel, said anywhere — «… ثم العودة إلى الفندق وتسجيل الخروج». */
const CHECK_OUT = /(^|[^\u0600-\u06FF])[وف]?(?:ال)?(?:خروج|مغادرة|إخلاء)(?![\u0600-\u06FF])/;
type HotelWhere = "out" | "pickup" | "from" | "to" | "other";
const hotelWhere = (head: string): HotelWhere =>
  HOTEL_PICKUP.test(head) ? "pickup" : HOTEL_OUT.test(head) ? "out" : HOTEL_FROM.test(head) ? "from" : HOTEL_TO.test(head) ? "to" : "other";

/** «فندق …» — said once: a name that already says what it is (فندق، منتجع، شقق، Hotel …) is printed as it is. */
const LODGING = /^(?:فندق|الفندق|فنادق|أوتيل|اوتيل|منتجع|شقق|فلل|فيلا|فيلات|نزل|أجنحة|كامب|مخيم|hotel|resort|suites?|apartments?|villas?|hostel)(?:\s|$)/i;
const hotelPhrase = (name: string) => (LODGING.test(name) ? name : `فندق ${name}`);

/**
 * The programme says which hotel (the owner, 2026-10-24: its name on the client link and in the PDF only — the
 * day text the agent writes stays «الفندق»). On each day the first «الفندق» meant for a stay takes its name; a
 * stay already named that day (typed by the agent, or named earlier) is not named again, and an undated stay is
 * never guessed. Which stay:
 * - a day with one hotel (a stay day, the arrival, the day home): that hotel — but a check-out on a day no stay
 *   ends, or a pickup point, stays «الفندق»;
 * - a day the group changes hotel, read in order: everything before the check-out (wherever it is said) is the
 *   hotel left, and so are the check-out itself and «من الفندق» until the group reaches the next one; «إلى
 *   الفندق» is the new one, and after it everything is. Before the check-out or the way in, a mention that says
 *   neither is left as «الفندق» rather than guessed.
 * Two hotels on the same dates are both named.
 */
export function withHotelNames<D extends { date: string | null; activities: string[] }>(
  days: D[],
  hotels: { hotel_name: string | null; check_in: string | null; check_out: string | null }[],
): D[] {
  const dated = hotels.filter((h) => h.check_in && h.check_out && h.hotel_name?.trim());
  const names = (pick: (h: (typeof dated)[number]) => boolean) => [...new Set(dated.filter(pick).map((h) => h.hotel_name!.trim()))];
  const own = (line: string) => !line.startsWith(TOUR_CAR_LINE);
  return days.map((day) => {
    const date = day.date;
    if (!date || dated.length === 0) return day;
    const leaving = names((h) => h.check_out === date);
    const sleeping = names((h) => h.check_in! <= date && date < h.check_out!);
    const change = leaving.length > 0 && sleeping.length > 0 && leaving.join("|") !== sleeping.join("|");
    // every mention of the day in reading order — what comes before it, and where it stands (line, then place)
    const lines = day.activities.filter(own);
    const mentions = lines.flatMap((line, i) =>
      [...line.matchAll(HOTEL_WORD)].map((m) => ({ where: hotelWhere(line.slice(0, m.index + m[1].length)), at: i * 1e6 + m.index + m[1].length })),
    );
    // where the group checks out, said anywhere in the day
    const outAt = lines.reduce<number | null>((found, line, i) => {
      const m = found === null ? CHECK_OUT.exec(line) : null;
      return m ? i * 1e6 + m.index + m[1].length : found;
    }, null);
    let arrived = false;
    const stays = mentions.map(({ where, at }): string[] => {
      if (where === "pickup") return [];
      if (!change) return where === "out" ? leaving : sleeping.length > 0 ? sleeping : leaving;
      if (where === "to") {
        // the way in — unless the group has not left yet («العودة إلى الفندق وتسجيل الخروج»)
        if (outAt !== null && at < outAt) return leaving;
        arrived = true;
        return sleeping;
      }
      if (outAt !== null && at < outAt) return leaving;
      if (where === "out" || where === "from") return arrived ? sleeping : leaving;
      return arrived ? sleeping : [];
    });
    const done = new Set<string>();
    let k = 0;
    const activities = day.activities.map((line) =>
      own(line)
        ? line.replace(HOTEL_WORD, (match: string, before: string) => {
            const stay = stays[k] ?? [];
            k += 1;
            const key = stay.join("|");
            if (stay.length === 0 || done.has(key)) return match;
            done.add(key);
            // the agent already wrote it somewhere on the day
            if (day.activities.some((l) => stay.every((n) => l.includes(n)))) return match;
            return `${before}${stay.map(hotelPhrase).join(" و")}`;
          })
        : line,
    );
    return { ...day, activities };
  });
}

/** The city heading band: name, dates, hotels. */
const VISIT_HEAD_MM = 13;
/**
 * ponytail: calibrated like the terms — ~70 characters a line in the details
 * column at 9.8pt; a title, one joined activity line and the weather measured
 * 22mm under the old table. Conservative on purpose.
 */
const DAY_CHARS_PER_LINE = 70;
const DAY_LINE_MM = 5.2;

function dayHeightMm(day: Day): number {
  const lines = [day.title, day.transport_note ?? "", ...day.activities]
    .filter(Boolean)
    .reduce((n, text) => n + Math.ceil(text.length / DAY_CHARS_PER_LINE), 0);
  return 7 + (Math.max(lines, 1) + (day.weather_source ? 1 : 0)) * DAY_LINE_MM;
}

/** A visit's days cut so each piece, under its own city heading, fits a fresh sheet. */
function chunkDays(days: Day[], headMm: number): Day[][] {
  const chunks: Day[][] = [];
  let used = Infinity;
  for (const day of days) {
    const h = dayHeightMm(day);
    if (used + h + 4 > PAGE_BUDGET_MM - HEADING_MM) {
      chunks.push([]);
      used = headMm;
    }
    chunks[chunks.length - 1].push(day);
    used += h;
  }
  return chunks;
}

/** One visit (or a sheet's share of it): the city heading in the table head, so a continuation repeats it. `last` — the programme's last day number (the day home). */
function VisitTable({
  city,
  from,
  to,
  hotels,
  days,
  last,
}: {
  city: string;
  from: string | null;
  to: string | null;
  hotels: string[];
  days: Day[];
  last?: number;
}) {
  return (
    <table className="od-table od-days">
      {city ? (
        <thead>
          <tr>
            <th colSpan={2} className="od-city-head">
              <strong>{city}</strong>
              <span className="od-tnum">{fmtRange(from, to)}</span>
              {hotels.length > 0 ? (
                <span>
                  {AR.visitHotels(hotels.length)}:{" "}
                  {hotels.map((h, i) => (
                    <span key={i} className="od-city-hotel">
                      {i > 0 ? "، " : ""}
                      <bdi>{h}</bdi>
                    </span>
                  ))}
                </span>
              ) : null}
            </th>
          </tr>
        </thead>
      ) : null}
      <tbody>
        {days.map((day) => (
          <DayRow key={day.day_number} day={day} last={day.day_number === last} />
        ))}
      </tbody>
    </table>
  );
}

/**
 * One day: the date, the title, then what happens in the order it happens. On
 * a day with a tour, the way the group arrives (or moves) comes first — the
 * reception, then the tour — and the tour's car, «التنقل بـفان × 2», last. The
 * day home with a tour («جولة قبل المغادرة», `last`) is the other way round:
 * the tour and its car, then the way to the airport and the farewell. A free
 * day is set apart. No price: a day carries none.
 */
function DayRow({ day, last = false }: { day: Day; last?: boolean }) {
  const cars = day.activities.filter((a) => a.startsWith(TOUR_CAR_LINE));
  const lines = day.activities.filter((a) => !a.startsWith(TOUR_CAR_LINE));
  // the vehicle goes on the day it is used — a client reads day by day
  const move = day.transport_note ? <span className="od-sub od-day-move">{day.transport_note}</span> : null;
  // the day home with a tour: its lines as written (the tour, its car, the airport), the farewell last
  const leaving = last && cars.length > 0;
  return (
    <tr className={isFreeDay(day) ? "od-day od-day-free" : "od-day"}>
      <td className="od-tnum od-day-date">
        <Ltr>{fmtDate(day.date)}</Ltr>
      </td>
      <td>
        <span className="od-route">{day.title || day.city_name || "—"}</span>
        {cars.length > 0 && !leaving ? move : null}
        {(leaving ? day.activities : lines).map((a, i) => (
          <span key={i} className={a.startsWith(TOUR_CAR_LINE) ? "od-sub od-day-move" : "od-act"}>
            {a}
          </span>
        ))}
        {leaving
          ? null
          : cars.map((c, i) => (
              <span key={`c${i}`} className="od-sub od-day-move">
                {c}
              </span>
            ))}
        {cars.length > 0 && !leaving ? null : move}
        <DayWeather day={day} />
      </td>
    </tr>
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
/**
 * Measured in Chromium (Tajawal, 2026-10-13): a card's head is 16.4mm and its
 * list padding 8mm; a one-line item 10.5mm, each further line 6.5mm, at 43–55
 * characters a line in the ~88mm column. The old «8mm a row» was 30mm short on
 * eight one-line items, so the payment note spilled onto a sheet of its own (a
 * partner's PDF, page 3). Characters per line taken low: long words wrap early.
 *
 * ponytail: still an estimate — a services block taller than a whole sheet
 * cannot be split (it is one node); split the lists into blocks if one ever is.
 */
const LIST_CHARS_PER_LINE = 38;
const listCardMm = (items: string[]) =>
  16.4 + 8 + items.reduce((sum, item, i) => sum + 4 + 6.5 * Math.max(1, Math.ceil((item.length + String(i + 1).length + 2) / LIST_CHARS_PER_LINE)), 0);

/**
 * The payment note: the standing one is 19mm (measured, three lines); «الشروط
 * المالية» is its title (9mm) and padding (8mm), each paragraph's heading
 * (7mm) and its lines at ~95 characters and 6.2mm a line.
 * ponytail: an estimate like the cards — measure if a long bank list spills.
 */
const paymentNoteMm = (finance: FinanceSection | undefined) => {
  if (!hasFinance(finance)) return 19;
  const lines = (list: string[]) => list.reduce((sum, l) => sum + 6.2 * Math.max(1, Math.ceil(l.length / 95)), 0);
  return 17 + [finance.banks, finance.payments, finance.instalment].reduce((sum, list) => sum + (list.length ? 7 + lines(list) : 0), 0);
};

/** «الشروط المالية»: the bank accounts, the payment milestones, the instalment plan — each only when written. */
function FinanceTerms({ finance }: { finance: FinanceSection }) {
  const part = (title: string, list: string[]) =>
    list.length ? (
      <div className="od-fin-part">
        <h4>{title}</h4>
        <ul>
          {list.map((line, i) => (
            <li key={i} dir="auto">{line}</li>
          ))}
        </ul>
      </div>
    ) : null;
  return (
    <div className="od-note od-finance">
      <h3>{AR.financeTerms}</h3>
      {part(AR.financeBanks, finance.banks)}
      {part(AR.financePayments, finance.payments)}
      {part(AR.financeInstalment, finance.instalment)}
    </div>
  );
}

/** The block is tall and near-fixed: two list cards, the total, and the payment note. */
function servicesHeightMm(offer: ClientOfferDTO, showPrices: boolean): number {
  const cards =
    offer.includes.length + offer.excludes.length > 0 ? 7 + Math.max(70, listCardMm(offer.includes), listCardMm(offer.excludes)) : 0;
  // price band (9 + 26.2) and the payment note (6 + 18.6), measured. A price-less
  // file loses both, so the estimate loses them too or the packer reserves
  // 60mm of nothing.
  return cards + (showPrices ? 9 + 26.5 + 6 + paymentNoteMm(offer.finance) : 0);
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
          {hasFinance(offer.finance) ? <FinanceTerms finance={offer.finance} /> : <p className="od-note">{AR.paymentTerms}</p>}
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
