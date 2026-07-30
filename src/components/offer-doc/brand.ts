/**
 * Whose document is this?
 *
 * Most offers carry our identity. Some are resold: a partner agency takes the
 * file to their own client, so the cover, the colours and the logo have to be
 * theirs — printing ours would tell their client who the real supplier is, and
 * that is the one thing a reseller is paying us not to do.
 *
 * Pure module (no server-only, no React): the preview, the print pipeline and
 * the admin screen all read the same brand shape.
 */
import { AR, COMPANY } from "./labels";

export type DocBrand = {
  nameAr: string;
  nameLatin: string;
  address: string;
  phone: string;
  whatsapp: string;
  website: string;
  email: string;
  /** Logo to draw on the cover. null → the built-in Traveliun asset. */
  logoUrl: string | null;
  /**
   * CSS custom properties to override on `.od-root`, or null to leave the
   * stylesheet's own palette alone. Our document keeps its hand-tuned greens;
   * only a partner brand recolours, and then every shade is derived from two
   * hexes so the result stays coherent instead of one loud colour on our greens.
   */
  vars: Record<string, string> | null;
};

/** The house identity — the stylesheet's literal palette, untouched. */
export const TRAVELIUN_BRAND: DocBrand = {
  nameAr: COMPANY.nameAr,
  nameLatin: AR.brandLatin,
  address: COMPANY.address,
  phone: COMPANY.phone,
  whatsapp: COMPANY.whatsapp,
  website: COMPANY.website,
  email: COMPANY.email,
  logoUrl: null,
  vars: null,
};

const HEX = /^#[0-9a-fA-F]{6}$/;

function channels(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[r, g, b].map((n) => clamp(n).toString(16).padStart(2, "0")).join("")}`;
}

/** Mix a colour toward white. `amount` 0 = unchanged, 1 = white. */
export function tint(hex: string, amount: number): string {
  if (!HEX.test(hex)) return hex;
  const [r, g, b] = channels(hex);
  return toHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}

/** Mix a colour toward black. `amount` 0 = unchanged, 1 = black. */
export function shade(hex: string, amount: number): string {
  if (!HEX.test(hex)) return hex;
  const [r, g, b] = channels(hex);
  return toHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

/**
 * The full palette from two colours.
 *
 * The stylesheet already drives every rule off these variables, so recolouring a
 * document is a style attribute on one element — no second stylesheet, and no
 * risk of the preview and the print diverging.
 */
export function brandVars(primary: string, accent: string): Record<string, string> {
  // A bad value falls back to the house palette rather than reaching the
  // stylesheet: `--od-green: red; drop table` is the shape of the risk here.
  const p = HEX.test(primary) ? primary : "#135549";
  const a = HEX.test(accent) ? accent : "#f0ad22";
  return {
    "--od-green": p,
    "--od-green-2": tint(p, 0.18),
    "--od-soft": tint(p, 0.9),
    "--od-line": tint(p, 0.62),
    "--od-line-2": tint(p, 0.74),
    "--od-gold": a,
    "--od-notice": shade(a, 0.1),
  };
}

/** What the admin screen stores, and the document needs. */
export type PartnerBrandRow = {
  name: string;
  name_latin: string | null;
  brand_color: string;
  accent_color: string;
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  website: string | null;
  email: string | null;
};

/**
 * A partner's identity as a document brand.
 *
 * Missing contact fields fall back to BLANK, never to ours: a half-branded
 * document carrying our phone number under their logo is worse than one with a
 * gap, because the client would call us.
 */
export function partnerBrand(row: PartnerBrandRow, logoUrl: string | null): DocBrand {
  return {
    nameAr: row.name,
    nameLatin: row.name_latin ?? row.name,
    address: row.address ?? "",
    phone: row.phone ?? "",
    whatsapp: row.whatsapp ?? "",
    website: row.website ?? "",
    email: row.email ?? "",
    logoUrl,
    vars: brandVars(row.brand_color, row.accent_color),
  };
}
