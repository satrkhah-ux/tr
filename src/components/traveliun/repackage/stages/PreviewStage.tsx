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

      {/* produce / result */}
      {serial ? (
        <div className={`${sectionClass} border-[#bfe5d4] bg-[#e9f7f0]`}>
          <p className="flex items-center gap-2 text-[14px] font-extrabold text-[#0f7a52]"><CheckCircle2 className="size-5" />{t("rp.preview.produced")} <DirText dir="ltr"><span className="tv-tnum">{serial}</span></DirText></p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={`/client-offer/${serial}`} target="_blank" className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#185045] px-4 text-[13px] font-bold text-white hover:bg-[#0f4439]"><ExternalLink className="size-4" />{t("rp.preview.clientLink")}</Link>
            <Link href={`/client-offer/${serial}/pdf`} target="_blank" className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[#dbe6e1] bg-white px-4 text-[13px] font-bold text-[#185045] hover:bg-[#f4f8f6]"><FileText className="size-4" />{t("rp.preview.pdf")}</Link>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {!validation.ok ? (
            <p className="flex items-center gap-2 rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] px-3 py-2 text-[12.5px] font-bold text-[#c22850]"><XCircle className="size-4" />{t("rp.preview.blocking")}</p>
          ) : null}
          {error ? <p role="alert" className="rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] px-3 py-2 text-[13px] font-bold text-[#c22850]">{error}</p> : null}
          <button type="button" onClick={produce} disabled={producing || !validation.ok} className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-[#185045] px-6 text-sm font-bold text-white transition-colors hover:bg-[#0f4439] disabled:cursor-not-allowed disabled:opacity-60">
            {producing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            {producing ? t("rp.preview.producing") : t("rp.preview.produce")}
          </button>
        </div>
      )}
    </div>
  );
}

