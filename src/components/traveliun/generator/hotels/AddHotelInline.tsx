"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
import { createHotelForCity, type CreatedHotel } from "@/lib/data/catalog-actions";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { fieldClass } from "../stage-props";

/**
 * Add the hotel the client asked for, from inside the package.
 *
 * The catalogue holds 2,406 hotels and still will not hold every one. Without
 * this the agent abandons a half-built programme, walks to «قسم البيانات»,
 * adds a row, walks back and hunts for their place — which is the scattering
 * this screen exists to end.
 *
 * Folded away until asked for: the search is the normal path, and a creation
 * form sitting open under every empty result invites a duplicate of a hotel
 * that is already there under a slightly different spelling.
 */
export function AddHotelInline({
  countryName,
  cityName,
  onCreated,
}: {
  countryName: string;
  cityName: string;
  onCreated: (hotel: CreatedHotel) => void;
}) {
  const { t } = useTraveliunUI();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [nameEn, setNameEn] = useState("");
  const [stars, setStars] = useState("");

  function submit() {
    if (!name.trim()) return;
    setError(null);
    startTransition(async () => {
      const input = {
        countryName,
        cityName,
        arabicName: name,
        englishName: nameEn,
        stars: stars ? Number(stars) : null,
      };
      let result = await createHotelForCity(input);
      if (!result.ok && result.error === "pg.err.didYouMean") {
        const suggestion = result.suggestion;
        result = window.confirm(t("pg.err.didYouMean", { name: suggestion.name, typed: name }))
          ? { ok: true, hotel: suggestion, cityCreated: false }
          : await createHotelForCity({ ...input, force: true });
      }
      if (!result.ok) {
        setError(t(result.error));
        return;
      }
      setName("");
      setNameEn("");
      setStars("");
      setOpen(false);
      onCreated(result.hotel);
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-dashed border-[#b7d0c7] px-3 text-[12px] font-bold text-[#185045] transition-colors hover:bg-[#f0f7f4]"
      >
        <Plus className="size-3.5" />
        {t("pg.addHotelHere", { city: cityName || "—" })}
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-[11px] border border-[#cfe0d9] bg-white p-3">
      <p className="mb-2 text-[12px] font-extrabold text-[#185045]">
        {t("pg.addHotelHere", { city: cityName || "—" })}
      </p>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_90px]">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("col.arabicName")}
          className={`${fieldClass} h-10`}
          autoFocus
        />
        <input
          value={nameEn}
          onChange={(e) => setNameEn(e.target.value)}
          dir="ltr"
          placeholder={t("col.englishName")}
          className={`${fieldClass} h-10`}
        />
        <input
          type="number"
          min={1}
          max={7}
          dir="ltr"
          value={stars}
          onChange={(e) => setStars(e.target.value)}
          placeholder={t("col.stars")}
          className={`${fieldClass} tv-tnum h-10 text-center`}
        />
      </div>
      {/* Said plainly: this is the agency's catalogue, not a note on one file. */}
      <p className="mt-2 text-[11px] font-semibold text-tv-text-faint">{t("pg.addHotelNote")}</p>
      {error ? <p className="mt-1.5 text-[11.5px] font-bold text-[#c22850]">{error}</p> : null}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || !name.trim()}
          className="inline-flex h-9 items-center gap-2 rounded-[9px] bg-[#185045] px-3.5 text-[12px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
          {t("add")}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="inline-flex h-9 items-center rounded-[9px] border border-[#dbe6e1] px-3.5 text-[12px] font-bold text-[#557d78] hover:bg-[#f4f8f6]"
        >
          {t("cancel")}
        </button>
      </div>
    </div>
  );
}
