import { notFound, redirect } from "next/navigation";
import { OfferDocument } from "@/components/offer-doc/OfferDocument";
import { OfferPreviewToolbar } from "@/components/offer-doc/OfferPreviewToolbar";
import { getCurrentRole } from "@/lib/data/metrics";
import { getInternalOffer, getPublishedClientOffer } from "@/lib/data/offers";
import { toClientOfferDTO } from "@/lib/offer/dto";
import { can } from "@/lib/roles/roles";

/**
 * Staff, on-screen preview of an offer — the SAME <OfferDocument> the PDF prints
 * (preview === PDF, minus the print-only running footer). Shows the LIVE data so
 * edits are visible; publishing freezes a versioned snapshot for the client link.
 * Authenticated (behind the /offer auth gate). The internal variant additionally
 * requires the pricing.internal permission.
 */
const PREVIEW_FONT = `
@font-face{font-family:Tajawal;font-style:normal;font-weight:400;src:url('/fonts/Tajawal-Regular.ttf') format('truetype');}
@font-face{font-family:Tajawal;font-style:normal;font-weight:700;src:url('/fonts/Tajawal-Bold.ttf') format('truetype');}`;

export default async function OfferPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ serial: string }>;
  searchParams: Promise<{ variant?: string }>;
}) {
  const { serial } = await params;
  const { variant: variantParam } = await searchParams;

  const role = await getCurrentRole();
  const canInternal = can(role, "pricing.internal");
  const wantsInternal = variantParam === "internal";
  if (wantsInternal && !canInternal) redirect(`/offer/${serial}/preview`);

  const internal = await getInternalOffer(serial);
  if (!internal) notFound();

  const published = await getPublishedClientOffer(serial);
  const variant: "client" | "internal" = wantsInternal ? "internal" : "client";

  return (
    <main className="min-h-screen bg-[#eef3f1] py-6" dir="rtl">
      <style dangerouslySetInnerHTML={{ __html: PREVIEW_FONT }} />
      <OfferPreviewToolbar
        serial={serial}
        variant={variant}
        canInternal={canInternal}
        publishedVersion={published?.version ?? null}
      />
      <div className="mx-auto w-full max-w-[820px] px-3">
        <div className="overflow-hidden rounded-[14px] bg-white shadow-[0_10px_30px_rgba(0,60,58,0.12)]">
          {variant === "internal" ? (
            <OfferDocument variant="internal" offer={internal} />
          ) : (
            <OfferDocument variant="client" offer={toClientOfferDTO(internal)} />
          )}
        </div>
      </div>
    </main>
  );
}
