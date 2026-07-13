import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import type { ClientOffer } from "@/lib/data/offers";

/**
 * Unified Traveliun-branded RTL offer card, rendered to PNG via Satori (next/og).
 * Shared by the /image and /pdf routes. Consumes ClientOffer only, so buy price
 * and profit are never present.
 */

const GREEN = "#185045";
const INK = "#003c3a";
const MUTED = "#557d78";

async function loadFonts() {
  const [regular, bold] = await Promise.all([
    readFile(join(process.cwd(), "public/fonts/Tajawal-Regular.ttf")),
    readFile(join(process.cwd(), "public/fonts/Tajawal-Bold.ttf")),
  ]);
  return [
    { name: "Tajawal", data: regular, weight: 400 as const, style: "normal" as const },
    { name: "Tajawal", data: bold, weight: 700 as const, style: "normal" as const },
  ];
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 24px", background: "#ffffff", border: "1px solid #e2ebe7", borderRadius: 16 }}>
      <span style={{ fontSize: 26, color: MUTED, fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: 30, color: INK, fontWeight: 700 }}>{value}</span>
    </div>
  );
}

function OfferCard({ offer }: { offer: ClientOffer }) {
  const cities = offer.cities.map((c) => c.city_name).filter(Boolean).join(" · ");
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", background: "#f6faf8", fontFamily: "Tajawal" }}>
      {/* header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: GREEN, padding: "40px 48px" }}>
        <span style={{ fontSize: 52, fontWeight: 700, color: "#ffffff" }}>ترافليون للسفر والسياحة</span>
        <span style={{ fontSize: 30, fontWeight: 700, color: "#bfe0d6" }}>{offer.serial}</span>
      </div>

      {/* body */}
      <div style={{ display: "flex", flexDirection: "column", padding: 48, gap: 22 }}>
        <span style={{ fontSize: 64, fontWeight: 700, color: INK }}>برنامج {offer.destination ?? ""}</span>
        {offer.duration ? <span style={{ fontSize: 32, color: MUTED, fontWeight: 700 }}>{offer.duration}</span> : <span />}

        <Row label="المسافرون" value={`${offer.adults} كبير · ${offer.children} صغير · ${offer.infants} رضيع`} />
        {offer.offer_date ? <Row label="تاريخ البداية" value={offer.offer_date} /> : <span />}
        {cities ? <Row label="المدن" value={cities} /> : <span />}
        {offer.includes.length > 0 ? <Row label="يشمل" value={`${offer.includes.length} بنود`} /> : <span />}

        {offer.total != null ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "26px 28px", background: "#e3f6ee", borderRadius: 18, marginTop: 8 }}>
            <span style={{ fontSize: 34, color: "#0f7a52", fontWeight: 700 }}>الإجمالي</span>
            <span style={{ fontSize: 46, color: "#0f7a52", fontWeight: 700 }}>{`${formatNumber(offer.total)} ${offer.currency ?? ""}`}</span>
          </div>
        ) : <span />}
      </div>

      {/* footer */}
      <div style={{ display: "flex", marginTop: "auto", padding: "28px 48px", borderTop: "1px solid #d9e5e0", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 26, color: MUTED, fontWeight: 700 }}>المدينة المنورة · واتساب 0569222111</span>
        <span style={{ fontSize: 28, color: GREEN, fontWeight: 700 }}>Traveliun</span>
      </div>
    </div>
  );
}

export async function buildOfferImage(offer: ClientOffer): Promise<ImageResponse> {
  const fonts = await loadFonts();
  return new ImageResponse(<OfferCard offer={offer} />, { width: 1080, height: 1350, fonts });
}
