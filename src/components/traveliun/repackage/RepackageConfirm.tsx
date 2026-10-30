"use client";

import Link from "next/link";
import { CheckCircle2, ExternalLink, Info } from "lucide-react";
import { confirmRepackageOrder, repackageAgreementContext, type RepackageFileView } from "@/lib/data/repackage-order";
import { ClientConfirmedButton } from "../basic/ClientConfirmedButton";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { sectionClass } from "./stage-props";

/**
 * «تأكيد الطلب» — the client said yes to the issued programme. The same
 * confirmation as Basic's «العميل أكّد» and the kanban's (confirmOffer: the case
 * opens in «العمليات» with the file's bookings), asked the same way — Basic's own
 * button with its channel choice — and answered on this screen: once the case
 * exists it says so and links to it, and the button is gone (never twice).
 */
export function RepackageConfirm({
  draftId,
  file,
  onConfirmed,
}: {
  draftId: string;
  file: RepackageFileView;
  onConfirmed: () => void;
}) {
  const { t } = useTraveliunUI();
  const cancelled = file.state === "cancelled";
  const confirmed = file.operationId != null;
  return (
    <section className={sectionClass}>
      <h3 className="flex items-center gap-2 text-[14px] font-extrabold text-[#0f3d38]">
        <CheckCircle2 className="size-4 text-[#0f7a52]" />
        {t("rp.confirm.title")}
      </h3>
      {cancelled ? (
        <p className="mt-2 flex items-center gap-2 text-[12.5px] font-bold text-[#c22850]">
          <Info className="size-4 shrink-0" />
          {t("rp.confirm.cancelled")}
        </p>
      ) : confirmed ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[#bfe5d4] bg-[#e9f7f0] px-3 py-2.5">
          <p className="flex items-center gap-2 text-[13px] font-extrabold text-[#0f7a52]">
            <CheckCircle2 className="size-4 shrink-0" />
            {t("rp.confirm.done")}
          </p>
          {file.canOpenCase ? (
            <Link
              href={`/operations/${file.operationId}`}
              className="inline-flex h-9 items-center gap-2 rounded-[9px] bg-[#185045] px-4 text-[12.5px] font-bold text-white hover:bg-[#0f4439]"
            >
              <ExternalLink className="size-4" />
              {t("rp.confirm.open")}
            </Link>
          ) : null}
        </div>
      ) : (
        <>
          <p className="mb-3 mt-1 text-[12px] font-semibold text-[#557d78]">{t("rp.confirm.hint")}</p>
          {file.canAct ? (
            <div className="flex">
              <ClientConfirmedButton
                draftId={draftId}
                expired={file.state === "expired"}
                confirm={confirmRepackageOrder}
                context={repackageAgreementContext}
                onConfirmed={onConfirmed}
              />
            </div>
          ) : (
            <p className="text-[12px] font-bold text-[#a86a10]">{t("rp.confirm.notYours")}</p>
          )}
        </>
      )}
    </section>
  );
}
