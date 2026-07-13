"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CheckCircle2, FileText, Link2, Loader2, Rocket } from "lucide-react";
import { DirText } from "@/components/DirText";
import { produceOfferFromDraft } from "@/lib/data/drafts";
import { stageHref } from "@/lib/offer/draft-types";
import { validateDraft } from "@/lib/offer/draft-validation";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { OfferDocument } from "../OfferDocument";
import { sectionClass, type StageFormProps } from "../stage-props";

/**
 * Stage 10 — live, PDF-accurate preview + production. The document below is the
 * client variant (sell price only). Producing is blocked while blocking errors
 * remain; the button then lists what to fix.
 */
export function PreviewStage({ draftId, data, patch }: StageFormProps) {
  const router = useRouter();
  const { t, language } = useTraveliunUI();
  const [producing, setProducing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validation = useMemo(() => validateDraft(data), [data]);
  const produced = data.produced_serial;

  async function produce() {
    if (producing || !validation.ok) return;
    setProducing(true);
    setError(null);
    const result = await produceOfferFromDraft(draftId);
    setProducing(false);
    if (!result.ok) {
      setError(t(result.error));
      return;
    }
    patch({ produced_serial: result.serial });
  }

  return (
    <div className="space-y-4">
      <section className={`${sectionClass} flex flex-wrap items-center justify-between gap-3`}>
        <div>
          <h2 className="text-base font-extrabold text-[#003c3a]">{t("pg.previewTitle")}</h2>
          <p className="mt-1 text-[12px] font-semibold text-[#93aaa3]">{t("pg.previewNote")}</p>
        </div>
        {produced ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full bg-[#e9f7f0] px-4 py-2 text-[12.5px] font-extrabold text-[#0f7a52]">
              <CheckCircle2 className="size-4" />
              {t("pg.producedSerial")}
              <DirText dir="ltr" className="tv-tnum">{produced}</DirText>
            </span>
            <Link
              href={`/client-offer/${produced}`}
              target="_blank"
              className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#185045] px-4 text-[13px] font-bold text-white hover:bg-[#0f4439]"
            >
              <Link2 className="size-4" />
              {t("pg.openClientLink")}
            </Link>
            <a
              href={`/offer/${produced}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[#d8e3de] px-4 text-[13px] font-bold text-[#185045] hover:bg-[#f4f8f6]"
            >
              <FileText className="size-4" />
              {t("pg.viewPdf")}
            </a>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void produce()}
            disabled={producing || !validation.ok}
            title={!validation.ok ? t("pg.err.blockingLeft") : undefined}
            className="inline-flex h-11 items-center gap-2 rounded-[11px] bg-[#185045] px-5 text-sm font-bold text-white transition-colors hover:bg-[#0f4439] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {producing ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
            {producing ? t("pg.producing") : t("pg.produce")}
          </button>
        )}
      </section>

      {!validation.ok ? (
        <section className="rounded-2xl border border-[#f2d0d7] bg-[#fdeef2] p-4">
          <p className="mb-2 text-[12.5px] font-extrabold text-[#c22850]">{t("pg.err.blockingLeft")}</p>
          <ul className="space-y-1 text-[12px] font-semibold text-[#8f2140]">
            {validation.blocking.map((issue, index) => (
              <li key={index}>
                • {issue.invariant ? (language === "ar" ? issue.invariant.message_ar : issue.invariant.message_en) : issue.key ? t(issue.key) : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] px-4 py-3 text-[13px] font-semibold text-[#c22850]">
          {error}
        </p>
      ) : null}

      <OfferDocument data={data} onSectionClick={(target) => router.push(stageHref(draftId, target))} />
    </div>
  );
}
