"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { checkHotelIssueGuard, type GuardResult } from "@/lib/data/quality-actions";
import { PROBLEM_LABEL } from "@/lib/data/quality";
import { useSafeTransition } from "./useSafeTransition";
import { useTraveliunUI } from "./TraveliunUIProvider";

/**
 * «حارس الإصدار» (data order 11.1) on the issue screens — a WARNING only since
 * the owner's order of 2026-10-18: a Latin printed name, no city, no address or
 * phone are listed, and the offer is issued all the same. Each line links to the record
 * (new tab — the draft stays open) and is checked again when the agent comes
 * back to this tab.
 *
 * Where (the owner, 2026-10-22: «هذه لا يفضل أن تظهر في الإصدار بينما تظهر بالعمليات»):
 * `only="blocking"` on the sales screens says only what stops the issue (a Latin
 * printed name, no city); the missing address, phone or English name is an
 * operations job — `only="voucher"` on the case's hotels step, as «أكمل بيانات
 * الفندق», for the data team only since 2026-10-23. Neither blocks anything new.
 */
export function IssueGuardNotice({
  hotels,
  onBlocked,
  className = "",
  compact = false,
  only,
}: {
  hotels: readonly { hotel_id: string | null; hotel_name: string }[];
  onBlocked?: (blocked: boolean) => void;
  className?: string;
  /** an issued file: one line that opens — a warning that blocks nothing takes no room (the owner, 2026-10-18) */
  compact?: boolean;
  /** «blocking»: only what stops the issue (sales); «voucher»: only what the voucher lacks (operations) */
  only?: "blocking" | "voucher";
}) {
  const [open, setOpen] = useState(!compact);
  const { t } = useTraveliunUI();
  const [result, setResult] = useState<GuardResult>({ issues: [], canFix: false });
  const [pending, run] = useSafeTransition();
  // the request, as a string: re-check when a hotel or its printed name changes, not on every render
  const request = JSON.stringify(hotels.map((h) => ({ hotel_id: h.hotel_id, hotel_name: h.hotel_name })));

  const check = useCallback(
    () =>
      run(async () => {
        const next = await checkHotelIssueGuard(JSON.parse(request) as { hotel_id: string | null; hotel_name: string }[]);
        setResult(next);
        onBlocked?.(next.issues.some((i) => i.blocking));
      }),
    [request, run, onBlocked],
  );

  useEffect(() => {
    check();
    // back from fixing the record in the other tab
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [check]);

  const shown = result.issues.filter((i) => (only === "blocking" ? i.blocking : only === "voucher" ? !i.blocking : true));
  // the case's hotels: a hotel's data is the data team's, asked of them with the voucher
  // (hotel-data-request.ts) — the booking agent is not shown it (the owner, 2026-10-23)
  if (shown.length === 0 || (only === "voucher" && !result.canFix)) return null;
  if (compact && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex w-full items-center gap-2 rounded-[10px] border border-[#f3dfb0] bg-[#fff8e6] px-3 py-1.5 text-start text-[12px] font-bold text-[#8a5a00] hover:bg-[#fdf0d2] ${className}`}
      >
        <AlertTriangle className="size-3.5 shrink-0" />
        {t("data.quality.guard.oneLine", { n: new Set(shown.map((i) => i.hotelId)).size })}
        <span className="ms-auto text-[11.5px] underline">{t("data.quality.guard.show")}</span>
      </button>
    );
  }
  const blocking = shown.filter((i) => i.blocking);
  const voucher = shown.filter((i) => !i.blocking);

  const item = (issue: GuardResult["issues"][number]) => (
    <li key={`${issue.hotelId}-${issue.problem}`} className="flex flex-wrap items-center gap-x-2">
      <span>• {issue.name} — {t(PROBLEM_LABEL[issue.problem])}</span>
      {result.canFix ? (
        <Link href={`/hotels?id=${issue.hotelId}`} target="_blank" className="font-bold text-[#185045] underline">
          {t("data.quality.fix")}
        </Link>
      ) : null}
    </li>
  );

  return (
    <section className={`rounded-2xl border border-[#f3dfb0] bg-[#fff8e6] p-4 text-[12.5px] font-semibold text-[#8a5a00] ${className}`}>
      <div className="mb-2 flex items-center gap-2">
        <AlertTriangle className="size-4" />
        <p className="font-extrabold">{t(only === "voucher" ? "data.quality.guard.opsTitle" : "data.quality.guard.title")}</p>
        <button
          type="button"
          onClick={check}
          disabled={pending}
          title={t("refresh")}
          className="ms-auto rounded-md p-1 text-[#8a5a00] hover:bg-[#fdeec8] disabled:opacity-50"
        >
          <RefreshCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} />
        </button>
      </div>
      {blocking.length > 0 ? (
        <>
          <p className="mb-1 font-bold text-[#c22850]">{t("data.quality.guard.blocked")}</p>
          <ul className="mb-2 space-y-0.5 text-[#8f2140]">{blocking.map(item)}</ul>
        </>
      ) : null}
      {voucher.length > 0 ? (
        <>
          <p className="mb-1 font-bold">{t(only === "voucher" ? "data.quality.guard.opsVoucher" : "data.quality.guard.voucher")}</p>
          <ul className="space-y-0.5">{voucher.map(item)}</ul>
        </>
      ) : null}
      <p className="mt-2 text-[11.5px] text-[#a86a10]">
        {result.canFix
          ? blocking.some((i) => i.problem === "latin_name")
            ? t("data.quality.guard.reselect")
            : null
          : t("data.quality.guard.askData")}
      </p>
    </section>
  );
}
