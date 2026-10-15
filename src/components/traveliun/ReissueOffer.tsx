"use client";

import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { TranslationKey } from "@/lib/i18n";
import { produceOfferFromDraft, type ProduceResult } from "@/lib/data/drafts";
import type { OfferChange, OfferChangeKind } from "@/lib/offer/version-diff";
import { IssueGuardNotice } from "./IssueGuardNotice";
import { useTraveliunUI } from "./TraveliunUIProvider";

const KIND_KEY: Record<OfferChangeKind, TranslationKey> = {
  hotel: "pg.reissue.kind.hotel",
  room: "pg.reissue.kind.room",
  board: "pg.reissue.kind.board",
  rooms: "pg.reissue.kind.rooms",
  stayDates: "pg.reissue.kind.stayDates",
  dates: "pg.reissue.kind.dates",
  travellers: "pg.reissue.kind.travellers",
  flights: "pg.reissue.kind.flights",
  price: "pg.reissue.kind.price",
};

/**
 * «إصدار نسخة محدّثة» — on an issued file (Basic's last step, the generator's
 * preview and its issue bar). The server re-issues the SAVED draft as the next
 * version under the same serial (produceOfferFromDraft), so the agent's last
 * keystrokes are flushed first; then «ما تغيّر» against the version before.
 */
export function ReissueOffer({
  draftId,
  hotels,
  blocked,
  flush,
  onIssued,
  className = "",
}: {
  draftId: string;
  hotels: readonly { hotel_id: string | null; hotel_name: string }[];
  /** validateDraft has a blocking issue — the server would refuse anyway. */
  blocked: boolean;
  flush?: () => Promise<void>;
  onIssued?: (result: Extract<ProduceResult, { ok: true }>) => void;
  className?: string;
}) {
  const { t, language } = useTraveliunUI();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ version: number; changes: OfferChange[] } | null>(null);
  const [guardBlocked, setGuardBlocked] = useState(false);

  async function reissue() {
    if (busy || blocked || guardBlocked) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await flush?.();
      const result = await produceOfferFromDraft(draftId);
      if (!result.ok) return setError(t(result.error));
      setDone({ version: result.version ?? 0, changes: result.changes ?? [] });
      onIssued?.(result);
    } catch {
      setError(t("err.db"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11.5px] font-semibold text-[#93aaa3]">{t("pg.reissue.hint")}</p>
        <button
          type="button"
          onClick={() => void reissue()}
          disabled={busy || blocked || guardBlocked}
          title={blocked ? t("pg.err.blockingLeft") : undefined}
          className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-[#185045] bg-white px-3.5 text-[12.5px] font-bold text-[#185045] transition-colors hover:bg-[#f0f7f4] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {busy ? t("pg.reissuing") : t("pg.reissue.button")}
        </button>
      </div>
      <IssueGuardNotice hotels={hotels} onBlocked={setGuardBlocked} className="mt-2" />
      {error ? (
        <p role="alert" className="mt-2 text-[12px] font-bold text-[#c22850]">
          {error}
        </p>
      ) : null}
      {done ? (
        <div role="status" className="mt-2 rounded-[10px] border border-[#bfe5d4] bg-[#f3fbf7] px-3 py-2">
          <p className="text-[12.5px] font-extrabold text-[#0f7a52]">{t("pg.reissue.done", { n: done.version })}</p>
          {done.changes.length === 0 ? (
            <p className="mt-1 text-[12px] font-semibold text-[#557d78]">{t("pg.reissue.noChange")}</p>
          ) : (
            <>
              <p className="mt-1 text-[12px] font-bold text-[#185045]">{t("pg.reissue.changed")}</p>
              <ul className="mt-1 space-y-0.5 text-[12px] font-semibold text-[#3f5f59]">
                {done.changes.map((c, i) => (
                  <li key={i}>
                    • {t(KIND_KEY[c.kind])}
                    {c.where ? ` — ${c.where}` : ""}: <span dir="auto">{c.before}</span> {language === "ar" ? "←" : "→"} <span dir="auto">{c.after}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
