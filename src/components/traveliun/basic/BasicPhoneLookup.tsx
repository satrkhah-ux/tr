"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Search, Tag, UserRound } from "lucide-react";
import { DirText } from "@/components/DirText";
import { searchCustomersFromTeletel, type TeletelCustomerHit } from "@/lib/data/teletel-actions";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { basicField, basicLabel } from "./styles";

/**
 * The phone box IS the Teletel search: a few digits of the customer's number
 * bring up the matching contacts, and one tap fills the phone and the name.
 * Typed by hand, the number is simply the number — Teletel only suggests.
 */
export function BasicPhoneLookup({
  label,
  phone,
  onPhone,
  onPick,
  invalid = false,
}: {
  label: string;
  phone: string;
  onPhone: (phone: string) => void;
  onPick: (hit: TeletelCustomerHit) => void;
  /** a required number left empty — drawn in the generator's red (the repackage's client card). */
  invalid?: boolean;
}) {
  const { t } = useTraveliunUI();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<TeletelCustomerHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);

  // debounced, and a late answer to an older query is dropped
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const mine = ++seq.current;
    const id = window.setTimeout(async () => {
      setSearching(true);
      const res = await searchCustomersFromTeletel(q);
      if (seq.current !== mine) return;
      setSearching(false);
      if (!res.ok) return;
      setProblem(
        !res.configured
          ? t("tl.notConfigured")
          : !res.reachable
            ? t(res.reason === "blocked" ? "tl.blocked" : res.reason === "down" ? "tl.down" : "tl.unreachable")
            : null,
      );
      setHits(res.hits);
      setOpen(true);
    }, 350);
    return () => window.clearTimeout(id);
  }, [query, t]);

  return (
    <label className={`relative ${basicLabel}`}>
      {label}
      <span className="relative">
        {searching ? (
          <Loader2 className="absolute left-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-[#8aa29b]" />
        ) : (
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8aa29b]" />
        )}
        <input
          dir="ltr"
          inputMode="tel"
          value={phone}
          onChange={(e) => {
            onPhone(e.target.value);
            setQuery(e.target.value);
            if (e.target.value.trim().length < 2) setOpen(false);
          }}
          onFocus={() => hits.length > 0 && setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          placeholder="05…"
          // the number is left to right whatever the page's direction: the icon and its room both on the left
          className={`${basicField} pl-9${invalid ? " border-[#e0879b] focus:border-[#c22850]" : ""}`}
        />
      </span>
      {open && query.trim().length >= 2 ? (
        <span className="absolute inset-x-0 top-full z-30 mt-1 block max-h-72 overflow-y-auto rounded-[11px] border border-[#e2ebe7] bg-white shadow-lg">
          {problem ? (
            <span className="block px-3 py-2.5 text-[11.5px] font-semibold text-[#c22850]">{problem}</span>
          ) : hits.length === 0 ? (
            <span className="block px-3 py-2.5 text-[12px] font-semibold text-[#93aaa3]">{t("tl.noResults")}</span>
          ) : (
            hits.map((hit) => (
              <button
                key={hit.id}
                type="button"
                // mousedown, not click: the input's blur would close the list first
                onMouseDown={(e) => {
                  e.preventDefault();
                  onPick(hit);
                  setQuery("");
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 border-b border-[#f1f5f3] px-3 py-2 text-start last:border-b-0 hover:bg-[#f4f8f6]"
              >
                <UserRound className="size-4 shrink-0 text-[#185045]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-extrabold text-[#0f3d38]">{hit.name || t("tl.unnamed")}</span>
                  <span className="block truncate text-[11.5px] font-semibold text-[#8aa29b]">
                    <DirText>{hit.phone || hit.email}</DirText>
                  </span>
                </span>
                {hit.labels[0] ? (
                  <span className="hidden shrink-0 items-center gap-1 rounded-full bg-[#fff4dd] px-2 py-0.5 text-[10px] font-bold text-[#8a5a0c] xl:inline-flex">
                    <Tag className="size-3" /> {hit.labels[0]}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </span>
      ) : null}
    </label>
  );
}
