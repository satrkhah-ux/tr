"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileUp, Loader2, Package, Plane, Plus, Zap } from "lucide-react";
import { DirText } from "@/components/DirText";
import { createDraft, duplicateDraft, type DraftSummary } from "@/lib/data/drafts";
import { startDraftFromReadyOffer } from "@/lib/data/ready-offers";
import type { ReadyOfferRecord } from "@/lib/ready-offers/types";
import { TraveliunShell } from "../TraveliunShell";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { useBasicLabels } from "./labels";
import { RecentFiles } from "./RecentFiles";
import type { FileStatusRow } from "@/lib/data/file-status-core";

/** «النظام بيسك» home: start a file, or reopen one — every draft opens here as well as in the generator. */
export function BasicHome({
  drafts,
  states,
  meId,
  allByDefault,
  initialTab = "all",
  readyOffers,
  tools,
}: {
  drafts: DraftSummary[];
  /** each issued file's state (file-status-core), by draft id */
  states?: Record<string, FileStatusRow>;
  /** the signed-in employee — «ملفاتي» (null for a partner) */
  meId: string | null;
  /** the administration: «آخر الملفات» opens on everyone's */
  allByDefault: boolean;
  /** the files list's tab to open on («العروض المصدرة» lands on «مُصدرة») */
  initialTab?: "all" | "draft" | "issued";
  readyOffers: ReadyOfferRecord[];
  /** the other ways to start: a supplier's package, a flight card (null/false: not for this role) */
  tools: { repackage: boolean; flightCard: string | null };
}) {
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
          <div className="flex flex-wrap items-center gap-2">
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
              className="inline-flex h-11 items-center gap-2 rounded-[11px] border border-[#185045] px-5 text-[13.5px] font-extrabold text-[#185045] hover:bg-[#f0f7f4]"
            >
              <Package className="size-4" />
              {tx("fromReady")}
            </button>
          ) : null}
          {tools.repackage ? (
            <Link
              href="/repackage"
              className="inline-flex h-11 items-center gap-2 rounded-[11px] border border-[#cfe0d9] px-5 text-[13.5px] font-extrabold text-[#185045] hover:bg-[#f0f7f4]"
            >
              <FileUp className="size-4" />
              {tx("repackageTool")}
            </Link>
          ) : null}
          {tools.flightCard ? (
            <Link
              href={tools.flightCard}
              className="inline-flex h-11 items-center gap-2 rounded-[11px] border border-[#cfe0d9] px-5 text-[13.5px] font-extrabold text-[#185045] hover:bg-[#f0f7f4]"
            >
              <Plane className="size-4" />
              {tx("flightCardTool")}
            </Link>
          ) : null}
          </div>
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
          <RecentFiles
            drafts={drafts}
            states={states}
            meId={meId}
            allByDefault={allByDefault}
            initialTab={initialTab}
            busy={busy}
            onCopy={(id) => void openNew(`c-${id}`, () => duplicateDraft(id, { freshClient: true }))}
          />
        </section>
      </div>
    </TraveliunShell>
  );
}
