import "server-only";
import QRCode from "qrcode";
import { CouponDocument } from "@/components/offer-doc/CouponDocument";
import { renderDocHtml } from "@/lib/offer-doc/html";
import { documentToPng } from "@/lib/offer-doc/pdf";
import { arabicDate, maskPhone, scopeLabel } from "./rules";

/**
 * The coupon as a landscape picture — the header of the WhatsApp message and the top of the coupon page
 * (the owner, 2026-10-31: «بالعرض», «الهوية الخاصة بترافليون»). The offer document's identity
 * (components/offer-doc/CouponDocument.tsx), drawn by the PDF's Chromium: 1200×630 at twice the pixels.
 */
export type CardInput = {
  name: string | null;
  phone: string;
  code: string;
  link: string;
  kind: "amount" | "percent";
  value: number;
  applies_to: string;
  expires_at: string;
};

export async function couponPng(c: CardInput): Promise<Buffer> {
  const qrSvg = await QRCode.toString(c.link, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#263633", light: "#00000000" } });
  const n = Number.isInteger(c.value) ? String(c.value) : c.value.toFixed(2);
  const html = await renderDocHtml((assets) => (
    <CouponDocument
      assets={assets}
      coupon={{
        name: c.name,
        amount: c.kind === "percent" ? `${n}%` : n,
        unit: c.kind === "percent" ? null : "ريال",
        scope: scopeLabel(c.applies_to),
        code: c.code,
        expires: arabicDate(c.expires_at).replace(/^[^،]+،\s*/, ""),
        phone: maskPhone(c.phone),
        qrSvg,
      }}
    />
  ));
  return documentToPng(html, { width: 1200, height: 630 });
}
