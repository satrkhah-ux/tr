"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Copy, Loader2, Package, Plus, Zap } from "lucide-react";
import { DirText } from "@/components/DirText";
import { createDraft, duplicateDraft, type DraftSummary } from "@/lib/data/drafts";
import { startDraftFromReadyOffer } from "@/lib/data/ready-offers";
import type { ReadyOfferRecord } from "@/lib/ready-offers/types";
import { TraveliunShell } from "../TraveliunShell";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { useBasicLabels } from "./labels";

/** «النظام بيسك» home: start a file, or reopen one — every draft opens here as well as in the generator. */
export function BasicHome({ drafts, readyOffers }: { drafts: DraftSummary[]; readyOffers: ReadyOfferRecord[] }) {
  const tx = useBasicLabels();
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showReady, setShowReady] = useState(false);

  /** A new file from another: «نسخ» on a file, or a ready offer — opened here when made. */
  async function openNew(key: string, make: () => Promise<{ ok: true; id: string } | { ok: false; error: string }>) {
    setBusy(key);
    setError(null);
    try {
      const result = await make();
      if (!result.ok) {
        setError(t(result.error as Parameters<typeof t>[0]));
        return setBusy(null);
      }
      router.push(`/basic/${result.id}`);
    } catch {
      setError(tx("serverLost"));
      setBusy(null);
    }
  }

  async function onCreate() {
    setCreating(true);
    setError(null);
    // The company's flow asks no visa and no domestic flight up front; both are one switch away.
    const result = await createDraft({
      scope: { hotels: true, flights_intl: true, flights_domestic: false, transport: true, services: true, visas: false },
    });
    if (!result.ok) {
      setError(t(result.error));
      setCreating(false);
      return;
    }
    router.push(`/basic/${result.id}`);
  }

  return (
    <TraveliunShell title="nav.basic">
      <div className="tv-fade-up space-y-4">
        <section className="rounded-[16px] border border-[#d8e6e0] bg-white p-5">
          <h1 className="inline-flex items-center gap-2 text-lg font-extrabold text-[#003c3a]">
            <Zap className="size-5 text-[#e0a92a]" />
            {t("nav.basic")}
          </h1>
          <p className="mt-1 mb-4 max-w-3xl text-[12.5px] font-semibold leading-6 text-[#78948f]">{tx("homeHint")}</p>
          <button
            type="button"
            onClick={() => void onCreate()}
            disabled={creating}
            className="inline-flex h-11 items-center gap-2 rounded-[11px] bg-[#185045] px-5 text-[13.5px] font-extrabold text-white disabled:opacity-60"
          >
            {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {tx("newFile")}
          </button>
          {readyOffers.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowReady((v) => !v)}
              aria-expanded={showReady}
              className="ms-2 inline-flex h-11 items-center gap-2 rounded-[11px] border border-[#185045] px-5 text-[13.5px] font-extrabold text-[#185045] hover:bg-[#f0f7f4]"
            >
              <Package className="size-4" />
              {tx("fromReady")}
            </button>
          ) : null}
          {showReady ? (
            <div className="mt-3 rounded-[12px] border border-[#e2ebe7] bg-[#f8fbf9] p-3">
              <p className="mb-2 text-[11.5px] font-semibold text-[#78948f]">{tx("readyHint")}</p>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {readyOffers.map((o) => (
                  <li key={o.id} className="flex items-center gap-2 rounded-[10px] border border-[#dbe6e1] bg-white px-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-bold text-[#185045]">{o.title}</span>
                      <span className="tv-tnum block text-[11px] font-semibold text-[#78948f]">
                        {[o.country, o.nights ? `${o.nights} ${t("pg.nightsShort")}` : "", o.price ? `${Number(o.price).toLocaleString("en-US")} ${o.currency ?? ""}` : ""]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void openNew(`r-${o.id}`, () => startDraftFromReadyOffer(o.id))}
                      className="inline-flex h-8 items-center gap-1 rounded-[8px] bg-[#185045] px-3 text-[12px] font-bold text-white disabled:opacity-60"
                    >
                      {busy === `r-${o.id}` ? <Loader2 className="size-3.5 animate-spin" /> : null}
                      {tx("startReady")}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {error ? <p role="alert" className="mt-2 text-[12px] font-bold text-[#c22850]">{error}</p> : null}
        </section>

        <section className="rounded-[16px] border border-[#d8e6e0] bg-white p-5">
          <h2 className="mb-3 text-[14px] font-extrabold text-[#003c3a]">{tx("recent")}</h2>
          {drafts.length === 0 ? (
            <p className="text-[12.5px] font-semibold text-[#93aaa3]">{tx("emptyList")}</p>
          ) : (
            <ul className="divide-y divide-[#edf3f0]">
              {drafts.slice(0, 30).map((d) => (
                <li key={d.id} className="flex items-center gap-2">
                  <Link href={`/basic/${d.id}`} className="flex min-w-0 flex-1 flex-wrap items-center gap-3 py-2.5 hover:bg-[#f7fbf9]">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-[#185045]">
                      {d.title || d.destination || "—"}
                      {d.customer_name ? <span className="text-[#93aaa3]"> · {d.customer_name}</span> : null}
                    </span>
                    <span className="tv-tnum text-[11.5px] font-bold text-[#78948f]">
                      {d.travel_date ? <DirText>{d.travel_date}</DirText> : null}
                      {d.nights ? ` · ${d.nights} ${t("pg.nightsShort")}` : ""}
                    </span>
                    {d.produced_serial ? (
                      <span className="rounded-full bg-[#e9f7f0] px-2 py-0.5 text-[10.5px] font-bold text-[#0f7a52]">
                        <DirText>{d.produced_serial}</DirText>
                      </span>
                    ) : null}
                    <span className="text-[11.5px] font-bold text-[#2aa87a]">{tx("open")}</span>
                  </Link>
                  {/* the same programme for the next client */}
                  <button
                    type="button"
                    title={tx("copyHint")}
                    disabled={busy !== null}
                    onClick={() => void openNew(`c-${d.id}`, () => duplicateDraft(d.id, { freshClient: true }))}
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-[8px] border border-[#cfe0d9] px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f4f8f6] disabled:opacity-60"
                  >
                    {busy === `c-${d.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <Copy className="size-3.5" />}
                    {tx("copy")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </TraveliunShell>
  );
}
