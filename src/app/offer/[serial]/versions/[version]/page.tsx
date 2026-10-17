import { notFound } from "next/navigation";
import { DirText } from "@/components/DirText";
import { OfferDocument } from "@/components/offer-doc/OfferDocument";
import { resolveDocBrand } from "@/lib/data/doc-brand";
import { getOfferVersionDocument } from "@/lib/data/offer-versions";

/**
 * One version of an issued offer, exactly as the client was sent it — staff
 * only (getOfferVersionDocument refuses partners and anyone without
 * offers.write), for «سجل النسخ». The public link still shows only the latest.
 */
const PREVIEW_FONT = `
@font-face{font-family:Tajawal;font-style:normal;font-weight:400;src:url('/fonts/Tajawal-Regular.ttf') format('truetype');}
@font-face{font-family:Tajawal;font-style:normal;font-weight:700;src:url('/fonts/Tajawal-Bold.ttf') format('truetype');}`;

export default async function OfferVersionPage({ params }: { params: Promise<{ serial: string; version: string }> }) {
  const { serial, version } = await params;
  const v = Number(version);
  if (!Number.isInteger(v) || v < 1) notFound();
  const offer = await getOfferVersionDocument(serial, v);
  if (!offer) notFound();
  const { brand, showPrices } = await resolveDocBrand({ serial });
  return (
    <main className="min-h-screen bg-[#eef3f1] py-6" dir="rtl">
      <style dangerouslySetInnerHTML={{ __html: PREVIEW_FONT }} />
      <div className="mx-auto w-full max-w-[820px] px-3">
        <div className="mb-3 flex items-center gap-2">
          <span className="rounded-full bg-[#185045] px-3 py-1.5 text-[12px] font-bold text-white shadow-sm">
            النسخة <DirText dir="ltr" className="tv-tnum">{String(v)}</DirText> — كما أُرسلت للعميل
          </span>
          <DirText dir="ltr" className="tv-tnum text-[12px] font-bold text-[#557d78]">{serial}</DirText>
        </div>
        <div className="overflow-hidden rounded-[14px] bg-white shadow-[0_10px_30px_rgba(0,60,58,0.12)]">
          <OfferDocument variant="client" offer={offer} brand={brand} showPrices={showPrices} />
        </div>
      </div>
    </main>
  );
}
