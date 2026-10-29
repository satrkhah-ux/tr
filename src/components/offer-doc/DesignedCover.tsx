import type { ReactNode } from "react";
import { DirText } from "@/components/DirText";

/**
 * The designed first page: the destination's landmark across the whole sheet under a soft green veil, the title
 * over it, and a frosted card for the client and the trip. No internal wording (the employee's choice is never
 * printed). Without a picture the veil sits on the brand's own world map — the neutral cover.
 */
export function DesignedCover({
  header,
  imageUrl,
  title,
  eyebrow,
  serial,
  rows,
}: {
  /** the company block and logo (OfferDocument's CompanyHeader) — passed in, so this file does not import its parent */
  header: ReactNode;
  imageUrl: string | null;
  title: string;
  eyebrow: string;
  serial: string;
  /** label → value; a row with no value is left out */
  rows: { label: string; value: ReactNode }[];
}) {
  return (
    <>
      {imageUrl ? <img className="od-dc-photo" src={imageUrl} alt="" /> : null}
      <div className="od-dc-veil" />
      <div className="od-dc-top">
        <div className="od-dc-chip">
          {header}
        </div>
      </div>
      <div className="od-dc-title">
        <div className="od-dc-eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <div className="od-dc-serial">
          <DirText dir="ltr">{serial}</DirText>
        </div>
      </div>
      <div className="od-dc-card">
        {rows.filter((r) => r.value).map((r) => (
          <div key={r.label} className="od-dc-row">
            <span>{r.label}</span>
            <strong>{r.value}</strong>
          </div>
        ))}
      </div>
    </>
  );
}
