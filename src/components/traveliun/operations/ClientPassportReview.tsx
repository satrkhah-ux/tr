"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ExternalLink, FileCheck2, Loader2, X } from "lucide-react";
import {
  clientPassportScanUrl,
  listClientPassports,
  rejectClientPassport,
  reviewClientPassport,
  type PendingClientPassport,
} from "@/lib/data/client-passports";
import type { MrzPassport } from "@/lib/operations/mrz";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { useSafeTransition } from "../useSafeTransition";

const smallBtn =
  "inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#dbe6e1] bg-white px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f4f8f6] disabled:opacity-60";

/**
 * The case's pending client uploads, per traveller. Re-read whenever the
 * travellers prop changes — every router.refresh hands a new list — so an
 * accept or a reject clears its row without a page reload.
 */
export function useClientPassports(operationId: string, travelers: unknown): Record<string, PendingClientPassport> {
  const [map, setMap] = useState<Record<string, PendingClientPassport>>({});
  useEffect(() => {
    let live = true;
    listClientPassports(operationId)
      .then((m) => live && setMap(m))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [operationId, travelers]);
  return map;
}

/** The fields the traveller form opens with — `cpass` makes its Save an accept. */
export type ClientPassportPrefill = {
  cpass: string;
  display_name?: string;
  full_name?: string;
  number?: string;
  nationality?: string;
  birth_date?: string;
  expiry?: string;
};

/**
 * «جواز مرفوع من العميل — للمراجعة». Review opens the traveller's own form,
 * prefilled from what was read (the passport gate, audited); Save there
 * accepts. Reject deletes the photo and the client is asked for another.
 */
export function ClientPassportReview({
  submission,
  displayName,
  onReview,
}: {
  submission: PendingClientPassport;
  displayName: string;
  onReview: (prefill: ClientPassportPrefill, read: MrzPassport | null) => void;
}) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useSafeTransition();

  const review = () =>
    start(async () => {
      setError(null);
      const res = await reviewClientPassport(submission.id);
      if (!res.ok) return setError(t(res.error));
      const p = res.passport;
      onReview(
        p
          ? {
              cpass: submission.id,
              display_name: displayName || p.full_name,
              full_name: p.full_name,
              number: p.number,
              nationality: p.nationality,
              birth_date: p.birth_date ?? "",
              expiry: p.expiry ?? "",
            }
          : { cpass: submission.id },
        p,
      );
    });

  const open = () =>
    start(async () => {
      setError(null);
      const res = await clientPassportScanUrl(submission.id);
      if (res.ok) window.open(res.url, "_blank", "noopener");
      else setError(t(res.error));
    });

  const reject = () =>
    start(async () => {
      setError(null);
      const res = await rejectClientPassport(submission.id);
      if (res.ok) router.refresh();
      else setError(t(res.error));
    });

  return (
    <div className="mt-2 grid gap-1.5 rounded-[9px] border border-[#f2e2b4] bg-[#fff8e8] px-3 py-2">
      <p className="text-[11.5px] font-bold text-[#a86a10]">
        {t("ops.cpass.pending")} · {submission.read ? t("ops.cpass.read") : t("ops.cpass.unread")}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" disabled={pending} onClick={review} className={smallBtn}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <FileCheck2 className="size-3.5" />}
          {t("ops.cpass.review")}
        </button>
        <button type="button" disabled={pending} onClick={open} className={smallBtn}>
          <ExternalLink className="size-3.5" />
          {t("ops.cpass.open")}
        </button>
        {confirm ? (
          <>
            <span className="text-[11.5px] font-bold text-[#c43d3d]">{t("ops.cpass.rejectConfirm")}</span>
            <button
              type="button"
              disabled={pending}
              onClick={reject}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#c43d3d] px-3 text-[11.5px] font-bold text-white hover:bg-[#a83232] disabled:opacity-60"
            >
              {t("ops.cpass.reject")}
            </button>
            <button type="button" disabled={pending} onClick={() => setConfirm(false)} className={smallBtn}>
              {t("cancel")}
            </button>
          </>
        ) : (
          <button type="button" disabled={pending} onClick={() => setConfirm(true)} className={`${smallBtn} text-[#c43d3d]`}>
            <X className="size-3.5" />
            {t("ops.cpass.reject")}
          </button>
        )}
      </div>
      <p className="text-[11px] font-semibold text-[#8a5a0c]">{t("ops.cpass.reviewHint")}</p>
      {error ? <p className="text-[11.5px] font-bold text-[#c22850]">{error}</p> : null}
    </div>
  );
}
