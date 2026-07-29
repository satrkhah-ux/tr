import type { ReactNode } from "react";
import { AR, COMPANY, fmtDate } from "./labels";
import { OFFER_DOC_CSS } from "./styles";
import { DEFAULT_OFFER_DOC_ASSETS, type OfferDocAssets } from "./assets";
import type { VoucherDTO, VoucherKind } from "@/lib/operations/voucher-dto";

/**
 * The operational documents — hotel voucher, flight ticket, itinerary, booking
 * summary — in the Traveliun identity.
 *
 * It reuses OFFER_DOC_CSS, COMPANY and the label formatters rather than styling
 * itself, which is what makes a voucher look like it came from the same company
 * as the offer. It does NOT reuse OfferDocument's block packer: that machinery
 * exists to fill A4 sheets with eight heterogeneous sections, and a voucher has
 * three fixed ones. Travelers chunk twelve to a page with a plain slice.
 *
 * Server-safe (no hooks), so renderDocHtml can print it with the same fonts and
 * the same zero-margin sheet handling as the sales PDF.
 */

const KIND_TITLE: Record<VoucherKind, string> = {
  hotel_voucher: "قسيمة إقامة فندقية",
  flight_ticket: "تأكيد حجز طيران",
  itinerary: "الجدول السياحي",
  booking_summary: "ملخص الحجوزات",
};

const KIND_NOTE: Record<VoucherKind, string> = {
  hotel_voucher: "تُقدَّم هذه القسيمة عند الوصول إلى الفندق مع إثبات هوية كل نزيل.",
  flight_ticket: "يُرجى الحضور إلى المطار قبل موعد الإقلاع بثلاث ساعات للرحلات الدولية.",
  itinerary: "المواعيد استرشادية وقد تتغيّر حسب حركة السير والطقس.",
  booking_summary: "ملخص داخلي لكل ما تم حجزه ضمن هذا البرنامج.",
};

const TRAVELERS_PER_PAGE = 12;

export function VoucherDocument({
  voucher,
  assets = DEFAULT_OFFER_DOC_ASSETS,
}: {
  voucher: VoucherDTO;
  assets?: OfferDocAssets;
}) {
  const pages: ReactNode[] = [];

  pages.push(
    <Page key="main" cover>
      <Header voucher={voucher} assets={assets} />
      <Parties voucher={voucher} />
      {voucher.bookings.length > 0 ? <Bookings voucher={voucher} /> : null}
      {voucher.travelers.length > 0 && voucher.travelers.length <= TRAVELERS_PER_PAGE ? (
        <Travelers travelers={voucher.travelers} />
      ) : null}
      <Notes voucher={voucher} />
    </Page>,
  );

  // A large group spills onto its own sheets rather than being clipped.
  if (voucher.travelers.length > TRAVELERS_PER_PAGE) {
    for (let i = 0; i < voucher.travelers.length; i += TRAVELERS_PER_PAGE) {
      pages.push(
        <Page key={`t${i}`}>
          <SectionTitle title={AR.travelers ?? "المسافرون"} />
          <Travelers travelers={voucher.travelers.slice(i, i + TRAVELERS_PER_PAGE)} />
        </Page>,
      );
    }
  }

  if (voucher.days.length > 0) {
    pages.push(
      <Page key="days">
        <SectionTitle title={KIND_TITLE.itinerary} />
        <Days days={voucher.days} />
      </Page>,
    );
  }

  return (
    // the map variable lives on the root, exactly as OfferDocument sets it —
    // every .od-page::before reads it from here
    <div className="od-root" dir="rtl" style={{ ["--od-map" as string]: `url("${assets.mapUrl}")` }}>
      <style dangerouslySetInnerHTML={{ __html: OFFER_DOC_CSS }} />
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

function Header({ voucher, assets }: { voucher: VoucherDTO; assets: OfferDocAssets }) {
  return (
    <>
      <div className="od-top">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="od-logo" src={assets.logoUrl} alt={AR.brandLatin} />
        </div>
        <div className="od-company">
          <h2>{COMPANY.nameAr}</h2>
          <div>{COMPANY.address}</div>
          <div>
            {AR.callLabel}: <Ltr>{COMPANY.phone}</Ltr>
          </div>
          <div>
            {AR.webLabel}: <Ltr>{COMPANY.website}</Ltr>
          </div>
        </div>
      </div>

      <div className="od-hero" style={{ marginTop: "12mm" }}>
        <div className="od-hero-label">{KIND_TITLE[voucher.kind]}</div>
        <h1 style={{ fontSize: "24pt" }}>{voucher.destination || COMPANY.nameAr}</h1>
        <div className="od-hero-meta">
          {AR.serial} <Ltr>{voucher.serial}</Ltr> | {AR.issueDate} <Ltr>{fmtDate(voucher.issued_at)}</Ltr>
        </div>
      </div>
    </>
  );
}

function Parties({ voucher }: { voucher: VoucherDTO }) {
  return (
    <div className="od-panel">
      <div className="od-panel-head">
        <span>{AR.customerInfo}</span>
        <span>{voucher.destination || ""}</span>
      </div>
      <table className="od-info">
        <tbody>
          <tr>
            <th>{AR.customer}</th>
            <td>{voucher.customer.name || "—"}</td>
            <th>{AR.contactField}</th>
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

function Bookings({ voucher }: { voucher: VoucherDTO }) {
  return (
    <div style={{ marginTop: "9mm" }}>
      <SectionTitle title={KIND_TITLE[voucher.kind]} />
      {voucher.bookings.map((b, i) => (
        <div key={i} className="od-stay" style={{ gridTemplateColumns: "40mm 1fr", minHeight: "auto" }}>
          <div className="od-datebox">
            <span>{AR.checkIn}</span>
            <strong>
              <Ltr>{fmtDate(b.start_date)}</Ltr>
            </strong>
            <span>{AR.checkOut}</span>
            <strong>
              <Ltr>{fmtDate(b.end_date)}</Ltr>
            </strong>
          </div>
          <div>
            <div style={{ fontSize: "13pt", fontWeight: 800, color: "var(--od-green)" }}>
              {b.title}
              {b.city_name ? <span style={{ fontWeight: 500 }}> — {b.city_name}</span> : null}
            </div>
            {/* the number that makes this document worth carrying */}
            {b.confirmation_number ? (
              <div style={{ marginTop: "2mm", fontSize: "11.5pt", fontWeight: 800 }}>
                رقم التأكيد: <Ltr>{b.confirmation_number}</Ltr>
              </div>
            ) : null}
            <table className="od-table" style={{ marginTop: "3mm" }}>
              <tbody>
                {Object.entries(b.detail).map(([k, v]) => (
                  <tr key={k}>
                    <th style={{ width: "30%" }}>{k}</th>
                    <td>
                      <Ltr>{v}</Ltr>
                    </td>
                  </tr>
                ))}
                {b.supplier_name ? (
                  <tr>
                    <th>المزوّد</th>
                    <td>{b.supplier_name}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            {b.cancellation_policy ? <p className="od-note">{b.cancellation_policy}</p> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function Travelers({ travelers }: { travelers: VoucherDTO["travelers"] }) {
  return (
    <div className="od-panel" style={{ marginTop: "7mm" }}>
      <div className="od-panel-head">
        <span>المسافرون</span>
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
              <td style={{ width: "30%" }}>{t.nationality ?? "—"}</td>
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

function Notes({ voucher }: { voucher: VoucherDTO }) {
  const notes = [KIND_NOTE[voucher.kind], ...voucher.notes];
  return (
    <div style={{ marginTop: "8mm" }}>
      {notes.map((n, i) => (
        <p key={i} className="od-note">
          {n}
        </p>
      ))}
      <p className="od-note" style={{ marginTop: "5mm" }}>
        {COMPANY.nameAr} · <Ltr>{COMPANY.phone}</Ltr> · <Ltr>{COMPANY.email}</Ltr>
      </p>
    </div>
  );
}
