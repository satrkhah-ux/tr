"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { produceOfferFromDraft, type ProduceResult } from "@/lib/data/drafts";
import { checkPriceUpdate } from "@/lib/data/price-update";
import { useTraveliunUI } from "../TraveliunUIProvider";

const money = (n: number | null, currency: string) => (n == null ? "—" : `${n.toLocaleString("en-US")} ${currency}`);

/**
 * «تطبيق تحديث السعر» (the owner, 2026-10-29): an issued file whose price no longer matches what the
 * client was sent — a hotel or a tour added, the margin raised, profit added — says so after each save,
 * with the issued and the new total, and one button issues it: new version, new PDF, the client link on
 * the new price, the old version kept in «سجل النسخ». Nothing goes to the client here.
 */
export function PriceUpdate({
  draftId,
  saved,
  refreshKey,
  blocked,
  flush,
  onIssued,
}: {
  draftId: string;
  /** changes every time the file finishes saving — the check runs after it */
  saved: unknown;
  refreshKey: number;
  blocked: boolean;
  flush: () => Promise<void>;
  onIssued: (result: Extract<ProduceResult, { ok: true }>) => void;
}) {
  const { t } = useTraveliunUI();
  const [state, setState] = useState<{ issued: number; next: number | null; currency: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ version: number; total: number | null; currency: string } | null>(null);
  const ticket = useRef(0);

  useEffect(() => {
    const mine = ++ticket.current;
    const timer = window.setTimeout(() => {
      void checkPriceUpdate(draftId)
        .then((r) => {
          if (mine !== ticket.current) return;
          setState(r.ok && r.changed ? { issued: r.issued, next: r.next, currency: r.currency } : null);
        })
        .catch(() => undefined);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [draftId, saved, refreshKey]);

  async function apply() {
    if (busy || blocked || !state) return;
    setBusy(true);
    setError(null);
    try {
      await flush();
      const result = await produceOfferFromDraft(draftId);
      if (!result.ok) return setError(t(result.error));
      setDone({ version: result.version ?? 0, total: state.next, currency: state.currency });
      setState(null);
      onIssued(result);
    } catch {
      setError(t("err.db"));
    } finally {
      setBusy(false);
    }
  }

  if (done && !state) {
    return (
      <div role="status" className="mb-3 rounded-[12px] border border-[#bfe5d4] bg-[#f3fbf7] px-3 py-2">
        <p className="text-[12.5px] font-extrabold text-[#0f7a52]">{t("pg.priceUpdate.done", { n: done.version, total: money(done.total, done.currency) })}</p>
        <p className="mt-0.5 text-[12px] font-semibold text-[#557d78]">{t("pg.priceUpdate.doneHint")}</p>
      </div>
    );
  }
  if (!state) return null;
  return (
    <div className="mb-3 rounded-[12px] border border-[#f0d9a8] bg-[#fff9ec] px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-extrabold text-[#8a5a00]">{t("pg.priceUpdate.title")}</p>
          <p className="mt-0.5 text-[12px] font-semibold text-[#5b4a1f]">
            {t("pg.priceUpdate.compare", { issued: money(state.issued, state.currency), next: money(state.next, state.currency) })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void apply()}
          disabled={busy || blocked}
          title={blocked ? t("pg.err.blockingLeft") : undefined}
          className="inline-flex h-9 items-center gap-2 rounded-[9px] bg-[#185045] px-3.5 text-[12.5px] font-extrabold text-white hover:bg-[#0f4439] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          {busy ? t("pg.reissuing") : t("pg.priceUpdate.button")}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-[12px] font-bold text-[#c22850]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

