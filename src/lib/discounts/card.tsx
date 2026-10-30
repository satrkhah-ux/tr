import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import QRCode from "qrcode";
import { arabicDate, maskPhone, scopeLabel } from "./rules";

/**
 * The coupon as a landscape picture (the owner, 2026-10-31: «بالعرض افضل» on WhatsApp) — the header
 * image of the coupon message: the gift on the right in our green, the stub with the QR on the left.
 * 1200×630, the size WhatsApp shows whole. Satori (next/og), the same fonts as the offer card.
 */

const GREEN = "#135549";
const DEEP = "#0a3a32";
const GOLD = "#f0ad22";
const INK = "#0b3d35";

async function fonts() {
  const [regular, bold] = await Promise.all([
    readFile(join(process.cwd(), "public/fonts/Tajawal-Regular.ttf")),
    readFile(join(process.cwd(), "public/fonts/Tajawal-Bold.ttf")),
  ]);
  return [
    { name: "Tajawal", data: regular, weight: 400 as const, style: "normal" as const },
    { name: "Tajawal", data: bold, weight: 700 as const, style: "normal" as const },
  ];
}

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

export async function couponCard(c: CardInput): Promise<ImageResponse> {
  const [qr, font] = await Promise.all([
    QRCode.toDataURL(c.link, { margin: 1, width: 360, errorCorrectionLevel: "M", color: { dark: INK, light: "#ffffff" } }),
    fonts(),
  ]);
  const amount = Number.isInteger(c.value) ? String(c.value) : c.value.toFixed(2);
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: "#06302a", padding: 28, fontFamily: "Tajawal" }}>
        <div style={{ display: "flex", flex: 1, borderRadius: 36, overflow: "hidden", background: "#ffffff" }}>
          {/* the stub: QR, code, end date */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: 380, padding: 28, background: "#ffffff" }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- satori draws <img> */}
            <img src={qr} width={250} height={250} alt="" style={{ borderRadius: 16 }} />
            <span style={{ marginTop: 14, fontSize: 38, fontWeight: 700, color: INK, letterSpacing: 4 }}>{c.code}</span>
            <span style={{ marginTop: 10, fontSize: 22, color: "#55716b" }}>صالح حتى</span>
            <span style={{ fontSize: 26, fontWeight: 700, color: INK }}>{arabicDate(c.expires_at)}</span>
          </div>

          {/* the tear line */}
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", alignItems: "center", width: 36, background: "#ffffff" }}>
            <div style={{ display: "flex", width: 44, height: 44, marginTop: -22, borderRadius: 22, background: "#06302a" }} />
            <div style={{ display: "flex", flex: 1, width: 0, borderLeft: "4px dashed #c9d8d3", margin: "8px 0" }} />
            <div style={{ display: "flex", width: 44, height: 44, marginBottom: -22, borderRadius: 22, background: "#06302a" }} />
          </div>

          {/* the gift */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "space-between", flex: 1, padding: "40px 48px", background: `linear-gradient(135deg, ${GREEN}, ${DEEP})`, color: "#ffffff" }}>
            <div style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ display: "flex", padding: "8px 22px", borderRadius: 999, border: `2px solid ${GOLD}`, color: "#ffd27a", fontSize: 24, fontWeight: 700 }}>هدية خاصة</span>
              <span style={{ fontSize: 34, fontWeight: 700 }}>ترافليون</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <span style={{ fontSize: 28, color: "#bfe0d6" }}>كوبون خصم باسم</span>
              <span style={{ fontSize: 50, fontWeight: 700, marginTop: 4 }}>{c.name?.trim() || "عميلنا العزيز"}</span>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              {c.kind === "amount" && <span style={{ fontSize: 46, fontWeight: 700, color: "#ffd27a", marginLeft: 16, marginBottom: 22 }}>ريال</span>}
              <span style={{ fontSize: 170, fontWeight: 700, color: GOLD, lineHeight: 1 }}>{c.kind === "percent" ? `${amount}%` : amount}</span>
            </div>
            <div style={{ display: "flex", width: "100%", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 24, color: "#bfe0d6" }}>{maskPhone(c.phone)}</span>
              <span style={{ fontSize: 30, fontWeight: 700 }}>خصم {scopeLabel(c.applies_to)}</span>
            </div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, fonts: font, headers: { "cache-control": "public, max-age=3600" } },
  );
}
