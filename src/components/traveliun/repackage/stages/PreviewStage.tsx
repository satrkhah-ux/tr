"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, FileText, Loader2, Sparkles, UserRound, XCircle } from "lucide-react";
import { DirText } from "@/components/DirText";
import { OfferDocument } from "@/components/offer-doc/OfferDocument";
import { produceRepackageOffer } from "@/lib/data/repackage";
import { getRepackageFile, type RepackageFileView } from "@/lib/data/repackage-order";
import { repackageToPreviewOffer } from "@/lib/offer/preview-dto";
import { hasCustomer, stageHref } from "@/lib/repackage/repackage-types";
import { validateRepackage } from "@/lib/repackage/repackage-validation";
import { ReissueOffer } from "../../ReissueOffer";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { RepackageAccountsCard } from "../RepackageAccountsCard";
import { RepackageConfirm } from "../RepackageConfirm";
import { SupplierOrderPanel } from "../SupplierOrderPanel";
import { sectionClass } from "../stage-props";
import type { RepackageStageProps } from "../stage-props";

export function PreviewStage({ draftId, data, replace, flush }: RepackageStageProps) {
  const { t } = useTraveliunUI();
  const [producing, setProducing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<RepackageFileView | null>(null);
  // bumps after an issue, a re-issue or a confirmation: the file's state and its accounts are read again
  const [stamp, setStamp] = useState(0);

  const validation = useMemo(() => validateRepackage(data), [data]);
  const preview = useMemo(() => repackageToPreviewOffer(data), [data]);
  const pkg = data.extracted;
  const serial = data.produced_serial;
  const hasClient = hasCustomer(data.customer) && data.customer.customer_name.trim() !== "" && data.customer.customer_phone.trim() !== "";

  const loadFile = useCallback(async () => {
    if (!serial) return setFile(null);
    const res = await getRepackageFile(draftId);
    setFile(res.ok ? res : null);
  }, [draftId, serial]);

  useEffect(() => {
    void loadFile();
  }, [loadFile, stamp]);

  async function produce() {
    if (producing || !validation.ok) return;
    setError(null);
    setProducing(true);
    try {
      // the last keystrokes are in the database before the server re-reads the file
      await flush();
      const res = await produceRepackageOffer(draftId);
      if (!res.ok) { setError(t(res.error)); return; }
      // the serial is the server's: it is on the file now, no save of ours names it
      replace({ ...data, produced_serial: res.serial });
      setStamp((n) => n + 1);
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
            <p className="flex items-center gap-2 text-[14px] font-extrabold text-[#0f7a52]">
              <CheckCircle2 className="size-5" />
              {t("rp.preview.issuedLabel")} <DirText dir="ltr"><span className="tv-tnum">{serial}</span></DirText>
              {file?.version ? <span className="text-[#185045]">· {t("rp.preview.versionN", { n: file.version })}</span> : null}
            </p>
            <div className="flex flex-wrap gap-2">
              <Link href={`/client-offer/${serial}`} target="_blank" className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#185045] px-4 text-[13px] font-bold text-white hover:bg-[#0f4439]"><ExternalLink className="size-4" />{t("rp.preview.clientLink")}</Link>
              <Link href={`/client-offer/${serial}/pdf`} target="_blank" className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[#dbe6e1] bg-white px-4 text-[13px] font-bold text-[#185045] hover:bg-[#f4f8f6]"><FileText className="size-4" />{t("rp.preview.pdf")}</Link>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button type="button" onClick={produce} disabled={producing || !validation.ok} className="tv-btn-primary inline-flex h-11 items-center gap-2 rounded-[10px] px-6 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60">
                {producing ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {producing ? t("rp.preview.producing") : t("rp.preview.produce")}
              </button>
              {!validation.ok ? (
                <p className="flex items-center gap-2 rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] px-3 py-2 text-[12.5px] font-bold text-[#c22850]"><XCircle className="size-4" />{t("rp.preview.blocking")}</p>
              ) : null}
            </div>
            {/* the issue files the offer under a client: said plainly, with the way to add one */}
            {!hasClient ? (
              <p className="flex flex-wrap items-center gap-2 rounded-[10px] border border-[#f2e2b4] bg-[#fff8e8] px-3 py-2 text-[12.5px] font-bold text-[#a86a10]">
                <UserRound className="size-4 shrink-0" />
                {t("rp.preview.needClient")}
                <Link href={stageHref(draftId, "review")} className="rounded-md bg-white px-2 py-0.5 text-[11.5px] font-extrabold text-[#185045] underline">{t("rp.linkClient")}</Link>
              </p>
            ) : null}
            {error ? <p role="alert" className="rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] px-3 py-2 text-[13px] font-bold text-[#c22850]">{error}</p> : null}
          </>
        )}
      </div>

      {serial ? (
        <>
          {/* «إصدار نسخة محدّثة» — the file changed after it was issued: the same offer, its next version; nothing goes to the client from here */}
          <section className={sectionClass}>
            <ReissueOffer
              draftId={draftId}
              serial={serial}
              hotels={[]}
              blocked={!validation.ok}
              flush={flush}
              issue={produceRepackageOffer}
              onIssued={() => setStamp((n) => n + 1)}
            />
            <p className="mt-2 text-[11.5px] font-semibold text-tv-text-faint">{t("rp.preview.unsentNote")}</p>
          </section>

          {file ? <RepackageConfirm draftId={draftId} file={file} onConfirmed={() => setStamp((n) => n + 1)} /> : null}
          {file?.operationId && file.state !== "cancelled" ? <SupplierOrderPanel draftId={draftId} /> : null}
          <RepackageAccountsCard draftId={draftId} refreshKey={stamp} />
        </>
      ) : null}

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
