"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Plus, Zap } from "lucide-react";
import { DirText } from "@/components/DirText";
import { createDraft, type DraftSummary } from "@/lib/data/drafts";
import { TraveliunShell } from "../TraveliunShell";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { useBasicLabels } from "./labels";

/** «النظام بيسك» home: start a file, or reopen one — every draft opens here as well as in the generator. */
export function BasicHome({ drafts }: { drafts: DraftSummary[] }) {
  const tx = useBasicLabels();
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          {error ? <p role="alert" className="mt-2 text-[12px] font-bold text-[#c22850]">{error}</p> : null}
        </section>

        <section className="rounded-[16px] border border-[#d8e6e0] bg-white p-5">
          <h2 className="mb-3 text-[14px] font-extrabold text-[#003c3a]">{tx("recent")}</h2>
          {drafts.length === 0 ? (
            <p className="text-[12.5px] font-semibold text-[#93aaa3]">{tx("emptyList")}</p>
          ) : (
            <ul className="divide-y divide-[#edf3f0]">
              {drafts.slice(0, 30).map((d) => (
                <li key={d.id}>
                  <Link href={`/basic/${d.id}`} className="flex flex-wrap items-center gap-3 py-2.5 hover:bg-[#f7fbf9]">
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
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </TraveliunShell>
  );
}
