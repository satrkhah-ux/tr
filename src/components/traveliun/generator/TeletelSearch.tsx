"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search, Tag, UserRound } from "lucide-react";
import { DirText } from "@/components/DirText";
import { searchCustomersFromTeletel, type TeletelCustomerHit } from "@/lib/data/teletel-actions";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { fieldClass } from "./stage-props";

/**
 * Find the client in Teletel (by name or phone) — one tap hands the contact to
 * `onPick`. Shared by the generator's customer card and the repackage review.
 */
export function TeletelSearch({ onPick }: { onPick: (hit: TeletelCustomerHit) => void }) {
  const { t } = useTraveliunUI();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<TeletelCustomerHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [configured, setConfigured] = useState(true);
  // Separate from `configured`: the token is set but Teletel refused it.
  const [reachable, setReachable] = useState(true);
  const [failure, setFailure] = useState<"token" | "blocked" | "down" | undefined>();
  const [open, setOpen] = useState(false);
  const seqRef = useRef(0);

  // debounced Teletel search (350ms); stale responses dropped via seq counter.
  // A query under 2 letters only invalidates what is in flight — the list is
  // hidden by `active` at render, not cleared here.
  const active = query.trim().length >= 2;
  useEffect(() => {
    const q = query.trim();
    const seq = ++seqRef.current;
    if (q.length < 2) return;
    const id = window.setTimeout(async () => {
      const res = await searchCustomersFromTeletel(q);
      if (seqRef.current !== seq) return;
      setSearching(false);
      if (!res.ok) return;
      setConfigured(res.configured);
      setReachable(res.reachable);
      setFailure(res.reason);
      setHits(res.hits);
      setOpen(true);
    }, 350);
    return () => window.clearTimeout(id);
  }, [query]);

  function pick(hit: TeletelCustomerHit) {
    onPick(hit);
    setQuery("");
    setHits([]);
    setSearching(false);
    setOpen(false);
  }

  return (
    <div className="relative mb-4">
      <span className="mb-1.5 block text-[12px] font-bold text-[#557d78]">{t("tl.search")}</span>
      <div className="relative">
        {searching && active ? (
          <Loader2 className="absolute end-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-tv-text-faint" />
        ) : (
          <Search className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-tv-text-faint" />
        )}
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSearching(e.target.value.trim().length >= 2);
          }}
          onFocus={() => active && hits.length > 0 && setOpen(true)}
          placeholder={t("tl.searchPlaceholder")}
          className={`${fieldClass} pe-10`}
        />
      </div>
      {!configured ? (
        <p className="mt-1.5 text-[11.5px] font-semibold text-[#a86a10]">{t("tl.notConfigured")}</p>
      ) : !reachable ? (
        // Said plainly, because the agent's next move depends on it: a
        // rejected token used to read as «لا يوجد عملاء مطابقون», so they
        // retyped a customer Teletel already had.
        <p className="mt-1.5 text-[11.5px] font-semibold text-[#c22850]">
          {t(failure === "blocked" ? "tl.blocked" : failure === "down" ? "tl.down" : "tl.unreachable")}
        </p>
      ) : null}
      {open && configured && reachable && active ? (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-[11px] border border-[#e2ebe7] bg-white shadow-lg dark:border-[#294039] dark:bg-[#0f1f1b]">
          {hits.length === 0 && !searching ? (
            <p className="px-4 py-3 text-[12.5px] font-semibold text-tv-text-faint">{t("tl.noResults")}</p>
          ) : (
            hits.map((hit) => (
              <button
                key={hit.id}
                type="button"
                onClick={() => pick(hit)}
                className="flex w-full items-center gap-3 border-b border-[#f1f5f3] px-4 py-2.5 text-start last:border-b-0 hover:bg-[#f4f8f6] dark:border-[#1c302a] dark:hover:bg-[#12352c]"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#eef4f1] text-[#185045] dark:bg-[#12352c] dark:text-[#7fd0b2]">
                  <UserRound className="size-4.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-extrabold text-[#0f3d38] dark:text-[#eaf3ef]">
                    {hit.name || t("tl.unnamed")}
                  </span>
                  <span className="block truncate text-[12px] font-semibold text-tv-text-faint">
                    <DirText dir="ltr">{hit.phone || hit.email}</DirText>
                  </span>
                </span>
                {hit.labels.length > 0 ? (
                  <span className="flex max-w-[45%] flex-wrap justify-end gap-1">
                    {hit.labels.slice(0, 2).map((label) => (
                      <span key={label} className="inline-flex items-center gap-1 rounded-full bg-[#fff4dd] px-2 py-0.5 text-[10.5px] font-bold text-[#8a5a0c]">
                        <Tag className="size-3" /> {label}
                      </span>
                    ))}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
