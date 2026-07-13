import { Download, ShieldCheck } from "lucide-react";
import { DirText } from "@/components/DirText";
import { OfferDocument } from "@/components/offer-doc/OfferDocument";
import { getPublishedClientOffer } from "@/lib/data/offers";

/**
 * PUBLIC client link. Renders the LATEST PUBLISHED client snapshot with the exact
 * same <OfferDocument> the PDF prints, so the page, the link and the downloaded
 * PDF always agree — and never change retroactively when the offer is edited
 * later (only re-publishing writes a new version). The snapshot is the redacted
 * ClientOfferDTO: no buy price / profit is ever present.
 */
const PREVIEW_FONT = `
@font-face{font-family:Tajawal;font-style:normal;font-weight:400;src:url('/fonts/Tajawal-Regular.ttf') format('truetype');}
@font-face{font-family:Tajawal;font-style:normal;font-weight:700;src:url('/fonts/Tajawal-Bold.ttf') format('truetype');}`;

export default async function ClientOfferPage({ params }: { params: Promise<{ serial: string }> }) {
  const { serial } = await params;
  const published = await getPublishedClientOffer(serial);

  return (
    <main className="min-h-screen bg-[#eef3f1] py-6" dir="rtl">
      <style dangerouslySetInnerHTML={{ __html: PREVIEW_FONT }} />
      {!published ? (
        <section className="mx-auto max-w-[560px] rounded-2xl border border-[#f1d1d1] bg-white p-10 text-center shadow-sm">
          <div className="mx-auto mb-4 flex size-[76px] items-center justify-center rounded-[20px] bg-[#fdeef2] text-[#c43d3d]">
            <ShieldCheck className="size-9" />
          </div>
          <h1 className="text-2xl font-extrabold text-[#c43d3d]">العرض غير متاح</h1>
          <p className="mt-2 text-sm font-semibold text-[#8aa29b]">
            الرقم <DirText dir="ltr" className="tv-tnum">{serial}</DirText> غير منشور أو غير موجود. تواصل مع موظف المبيعات للحصول على رابط صحيح.
          </p>
        </section>
      ) : (
        <div className="mx-auto w-full max-w-[820px] px-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="rounded-full bg-white px-3 py-1.5 text-[12px] font-bold text-[#557d78] shadow-sm">
              نسخة <DirText dir="ltr" className="tv-tnum">{String(published.version)}</DirText>
            </span>
            <a
              href={`/client-offer/${serial}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center gap-2 rounded-[11px] bg-[#185045] px-5 text-sm font-bold text-white shadow-sm hover:bg-[#0f4439]"
            >
              <Download className="size-4" />
              تحميل ملف العرض PDF
            </a>
          </div>
          <div className="overflow-hidden rounded-[14px] bg-white shadow-[0_10px_30px_rgba(0,60,58,0.12)]">
            <OfferDocument variant="client" offer={published.offer} />
          </div>
        </div>
      )}
    </main>
  );
}
