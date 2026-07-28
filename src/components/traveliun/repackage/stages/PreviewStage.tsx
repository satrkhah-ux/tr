"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, FileText, Loader2, Sparkles, XCircle } from "lucide-react";
import { DirText } from "@/components/DirText";
import { OfferDocument } from "@/components/offer-doc/OfferDocument";
import { produceRepackageOffer } from "@/lib/data/repackage";
import { repackageToPreviewOffer } from "@/lib/offer/preview-dto";
import { validateRepackage } from "@/lib/repackage/repackage-validation";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { sectionClass } from "../stage-props";
import type { RepackageStageProps } from "../stage-props";

export function PreviewStage({ draftId, data, patch }: RepackageStageProps) {
  const { t } = useTraveliunUI();
  const [producing, setProducing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validation = useMemo(() => validateRepackage(data), [data]);
  const preview = useMemo(() => repackageToPreviewOffer(data), [data]);
  const pkg = data.extracted;
  const serial = data.produced_serial;

  async function produce() {
    if (producing || !validation.ok) return;
    setError(null);
    setProducing(true);
    try {
      const res = await produceRepackageOffer(draftId);
      if (!res.ok) { setError(t(res.error)); return; }
      patch({ produced_serial: res.serial });
    } finally {
      setProducing(false);
    }
  }

  if (!pkg) {
    return <div className={sectionClass}><p className="text-[13px] text-[#557d78]">{t("rp.err.noFile")}</p></div>;
  }

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-extrabold text-[#0f3d38]">{t("rp.preview.title")}</h2>
        <p className="mt-1 text-[13px] text-[#557d78]">{t("rp.preview.hint")}</p>
      </header>

      {/*
        Actions sit ABOVE the document and stay stuck to the top: the preview is
        several A4 pages tall, so a bar underneath it meant scrolling the whole
        offer just to reach «إصدار» — or to reach the client link after issuing.
      */}
      {/* top offsets clear the shell's fixed header (h-60 / lg:h-74); z stays under its z-30 */}
      <div className="sticky top-[68px] z-20 space-y-2 rounded-2xl border border-[#e2ebe7] bg-white/95 px-4 py-3 shadow-[0_1px_2px_rgba(0,60,58,0.04)] backdrop-blur lg:top-[82px]">
        {serial ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-[14px] font-extrabold text-[#0f7a52]"><CheckCircle2 className="size-5" />{t("rp.preview.produced")} <DirText dir="ltr"><span className="tv-tnum">{serial}</span></DirText></p>
            <div className="flex flex-wrap gap-2">
              <Link href={`/client-offer/${serial}`} target="_blank" className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#185045] px-4 text-[13px] font-bold text-white hover:bg-[#0f4439]"><ExternalLink className="size-4" />{t("rp.preview.clientLink")}</Link>
              <Link href={`/client-offer/${serial}/pdf`} target="_blank" className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[#dbe6e1] bg-white px-4 text-[13px] font-bold text-[#185045] hover:bg-[#f4f8f6]"><FileText className="size-4" />{t("rp.preview.pdf")}</Link>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button type="button" onClick={produce} disabled={producing || !validation.ok} className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-[#185045] px-6 text-sm font-bold text-white transition-colors hover:bg-[#0f4439] disabled:cursor-not-allowed disabled:opacity-60">
                {producing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {producing ? t("rp.preview.producing") : t("rp.preview.produce")}
              </button>
              {!validation.ok ? (
                <p className="flex items-center gap-2 rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] px-3 py-2 text-[12.5px] font-bold text-[#c22850]"><XCircle className="size-4" />{t("rp.preview.blocking")}</p>
              ) : null}
            </div>
            {error ? <p role="alert" className="rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] px-3 py-2 text-[13px] font-bold text-[#c22850]">{error}</p> : null}
          </>
        )}
      </div>

      {/*
        THE document — the very same component the published client page and the
        PDF render, fed by an adapter over the imported package. This stage used
        to draw its own little summary card, so the screen never showed what the
        client would actually receive.
      */}
      <div className="overflow-hidden rounded-2xl border border-[#e2ebe7] bg-[#f5f7f4]">
        {preview ? (
          <div className="origin-top scale-[0.62] [width:161.3%]">
            <OfferDocument variant="client" offer={preview} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

