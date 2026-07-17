"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, FileText, Loader2, Sparkles, XCircle } from "lucide-react";
import { DirText } from "@/components/DirText";
import { produceRepackageOffer } from "@/lib/data/repackage";
import { validateRepackage } from "@/lib/repackage/repackage-validation";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { sectionClass } from "../stage-props";
import type { RepackageStageProps } from "../stage-props";

export function PreviewStage({ draftId, data, patch }: RepackageStageProps) {
  const { t } = useTraveliunUI();
  const [producing, setProducing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validation = useMemo(() => validateRepackage(data), [data]);
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

      {/* branded client-facing summary (SELL only — no supplier cost / profit) */}
      <div className="overflow-hidden rounded-2xl border border-[#e2ebe7] bg-white shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
        <div className="flex items-center justify-between bg-[#185045] px-5 py-3 text-white">
          <span className="text-[15px] font-extrabold">ترافليون للسفر والسياحة</span>
          <span className="text-[12px] font-bold text-[#bfe0d6]">Traveliun</span>
        </div>
        <div className="space-y-3 p-5">
          <p className="text-[17px] font-extrabold text-[#0f3d38]">برنامج {pkg.destination || pkg.country}</p>
          <div className="flex flex-wrap gap-2 text-[12.5px] font-bold text-[#185045]">
            {pkg.trip_nights ? <Chip>{pkg.trip_nights} ليالٍ</Chip> : null}
            <Chip>{pkg.adults} كبير · {pkg.children} صغير</Chip>
            {pkg.arrival_date ? <Chip><DirText dir="ltr">{pkg.arrival_date}</DirText></Chip> : null}
          </div>

          {pkg.cities.length > 0 ? (
            <div>
              <p className="mb-1 text-[11px] font-extrabold text-[#93aaa3]">{t("rp.field.cities")}</p>
              <ul className="space-y-1 text-[13px] text-[#0f3d38]">
                {pkg.cities.map((c, i) => {
                  const h = pkg.hotels.find((x) => x.city_name === c.city_name) ?? pkg.hotels[i];
                  return <li key={i}>• {c.city_name}{c.nights ? ` — ${c.nights} ليالٍ` : ""}{h?.hotel_name ? ` — ${h.hotel_name}` : ""}</li>;
                })}
              </ul>
            </div>
          ) : null}

          {pkg.includes.length > 0 ? (
            <div>
              <p className="mb-1 text-[11px] font-extrabold text-[#93aaa3]">{t("rp.field.includes")}</p>
              <ul className="grid gap-1 text-[12.5px] text-[#0f3d38] sm:grid-cols-2">{pkg.includes.map((s, i) => <li key={i}>✓ {s}</li>)}</ul>
            </div>
          ) : null}

          <div className="flex items-center justify-between rounded-[12px] bg-[#e3f6ee] px-4 py-3">
            <span className="text-[14px] font-extrabold text-[#0f7a52]">الإجمالي</span>
            <DirText dir="ltr"><span className="tv-tnum text-[18px] font-extrabold text-[#0f7a52]">{data.final_total ?? "—"} {data.final_currency}</span></DirText>
          </div>
        </div>
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

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-[#f0f7f4] px-3 py-1">{children}</span>;
}
