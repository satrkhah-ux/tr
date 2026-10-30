"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, GitMerge, Loader2, Search, X } from "lucide-react";
import { listRows } from "@/lib/data/actions";
import {
  findSimilarHotels,
  getHotelUsage,
  mergeHotels,
  previewHotelMerge,
  type HotelUsage,
  type MergePreview,
} from "@/lib/data/hotel-tools";
import type { SimilarHotel } from "@/lib/catalog/hotel-rules";
import type { DataRow, FilterOption } from "@/lib/data/types";
import { useTraveliunUI } from "./TraveliunUIProvider";
import { useSafeTransition } from "./useSafeTransition";

/**
 * The /hotels tools beside the generic table (TraveliunTable): «يوجد فندق
 * مشابه» in the form, what a hotel is used by, and «دمج». Server side:
 * src/lib/data/hotel-tools.ts and public.merge_hotels (0070).
 */

function cityLabel(cities: FilterOption[], id: unknown): string {
  return cities.find((c) => c.value === id)?.label ?? "—";
}

/** «/hotels?q=…» — the table opens filtered to that hotel. */
function hotelHref(name: string): string {
  return `/hotels?q=${encodeURIComponent(name)}`;
}

// ---------------------------------------------------------------- similar ----

export function SimilarHotelsHint({
  arabic,
  english,
  cityId,
  excludeId,
  cities,
}: {
  arabic: string;
  english: string;
  cityId: string;
  excludeId?: string;
  cities: FilterOption[];
}) {
  const { t } = useTraveliunUI();
  const [hits, setHits] = useState<SimilarHotel[]>([]);

  useEffect(() => {
    let live = true;
    const id = window.setTimeout(() => {
      findSimilarHotels({ arabic, english, cityId: cityId || null, excludeId: excludeId ?? null })
        .then((found) => live && setHits(found))
        .catch(() => live && setHits([]));
    }, 450);
    return () => {
      live = false;
      window.clearTimeout(id);
    };
  }, [arabic, english, cityId, excludeId]);

  if (hits.length === 0) return null;
  return (
    <div role="status" className="mt-4 rounded-[10px] border border-[#f1dca7] bg-[#fff8e6] p-3 text-[13px] text-[#7a5a12]">
      <p className="mb-2 flex items-center gap-2 font-bold">
        <AlertTriangle className="size-4 shrink-0" aria-hidden /> {t("data.tools.similar.title")}
      </p>
      <ul className="grid gap-1.5">
        {hits.map((h) => (
          <li key={h.id} className="flex flex-wrap items-center gap-2">
            <a href={hotelHref(h.arabic_name)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[#185045] underline">
              {h.arabic_name}
              <ExternalLink className="size-3.5" aria-hidden />
            </a>
            {h.english_name ? <span dir="ltr" className="text-[#8a7a52]">{h.english_name}</span> : null}
            <span className="rounded-full bg-white/70 px-2 text-[11.5px]">
              {h.sameCity ? t("data.tools.similar.sameCity") : cityLabel(cities, h.city_id)}
            </span>
            {h.exact ? <span className="rounded-full bg-[#f7d9a0] px-2 text-[11.5px] font-bold">{t("data.tools.similar.exact")}</span> : null}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[12px]">{t("data.tools.similar.hint")}</p>
    </div>
  );
}

// ---------------------------------------------------------------- usage ----

/** What uses this hotel; null while counting (or when it could not be counted). */
export function useHotelUsage(id: string | null): HotelUsage | null {
  const [usage, setUsage] = useState<{ id: string; usage: HotelUsage } | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    getHotelUsage(id)
      .then((r) => live && r.ok && setUsage({ id, usage: r.usage }))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id]);
  return usage && usage.id === id ? usage.usage : null;
}

export function usageTotal(usage: HotelUsage | null): number {
  return usage ? usage.offers + usage.drafts + usage.rates + usage.bookings : 0;
}

export function HotelUsageLine({ usage }: { usage: HotelUsage | null }) {
  const { t } = useTraveliunUI();
  if (!usage) return <span className="tv-shimmer inline-block h-[13px] w-40 rounded-md" aria-hidden />;
  return (
    <span>
      {t("data.tools.usage.line", { offers: usage.offers, drafts: usage.drafts, rates: usage.rates, bookings: usage.bookings })}
    </span>
  );
}

// ---------------------------------------------------------------- merge ----

const panel = "rounded-[10px] bg-[#f4f8f6] p-3";

/**
 * «دمج»: pick the hotel that stays (one of the selected rows, or any hotel by
 * search); the rest are merged into it. The preview counts what moves before
 * anything does.
 */
export function HotelMergeDialog({
  candidates,
  cities,
  onClose,
  onMerged,
}: {
  candidates: DataRow[];
  cities: FilterOption[];
  onClose: () => void;
  onMerged: (removed: number) => void;
}) {
  const { t, dir } = useTraveliunUI();
  const [target, setTarget] = useState<DataRow | null>(candidates.length > 1 ? candidates[0] : null);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<DataRow[]>([]);
  const [preview, setPreview] = useState<{ key: string; value: MergePreview } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [merging, start] = useSafeTransition();

  const sources = candidates.filter((c) => !target || c.id !== target.id);
  const sourceIds = sources.map((s) => String(s.id));
  const previewKey = target ? `${String(target.id)}:${sourceIds.join(",")}` : "";

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) return;
    let live = true;
    const id = window.setTimeout(() => {
      listRows({ table: "hotels", page: 1, pageSize: 8, search: term, searchColumns: ["arabic_name", "english_name", "address"], sort: { column: "arabic_name", ascending: true } })
        .then((r) => live && setFound(r.ok ? r.rows : []))
        .catch(() => live && setFound([]));
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(id);
    };
  }, [query]);

  useEffect(() => {
    const [keepId, dropList] = previewKey.split(":");
    if (!keepId || !dropList) return;
    let live = true;
    previewHotelMerge(keepId, dropList.split(","))
      .then((r) => {
        if (!live) return;
        if (r.ok) setPreview({ key: previewKey, value: r.preview });
        else setError(t(r.error));
      })
      .catch(() => live && setError(t("err.db")));
    return () => {
      live = false;
    };
  }, [previewKey, t]);

  function pick(row: DataRow) {
    setTarget(row);
    setError(null);
  }

  const shown = preview && preview.key === previewKey ? preview.value : null;

  function confirm() {
    if (!target || !shown) return;
    setError(null);
    start(async () => {
      const result = await mergeHotels(String(target.id), sourceIds);
      if (!result.ok) {
        setError(t(result.error));
        return;
      }
      onMerged(result.removed);
    });
  }

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/25 p-4" role="dialog" aria-modal="true" aria-labelledby="hotel-merge-title" dir={dir}>
      <div className="tv-card max-h-[calc(90vh/var(--tv-zoom))] w-full max-w-[720px] overflow-y-auto rounded-2xl border p-5 text-[#185045] shadow-[0_18px_48px_rgba(0,0,0,0.22)]">
        <div className="mb-4 flex items-center justify-between border-b border-[#e1e9e5] pb-4">
          <h2 id="hotel-merge-title" className="flex items-center gap-2 text-lg font-extrabold">
            <GitMerge className="size-5" aria-hidden /> {t("data.tools.merge.title")}
          </h2>
          <button type="button" onClick={onClose} className="rounded-md p-2 text-[#557d78] hover:bg-[#edf3f0]" aria-label={t("close")}>
            <X className="size-5" />
          </button>
        </div>

        <p className="mb-2 text-sm font-bold">{t("data.tools.merge.keepLabel")}</p>
        {candidates.length > 1 ? (
          <div className="mb-3 grid gap-1.5">
            {candidates.map((c) => (
              <label key={String(c.id)} className="flex cursor-pointer items-center gap-2 rounded-[10px] border border-[#e2ebe7] px-3 py-2 text-sm hover:bg-[#f6faf8]">
                <input type="radio" name="merge-keep" checked={target?.id === c.id} onChange={() => pick(c)} />
                <span className="font-semibold">{String(c.arabic_name ?? "")}</span>
                <span className="text-tv-text-faint">{cityLabel(cities, c.city_id)}</span>
              </label>
            ))}
          </div>
        ) : null}

        <div className="relative mb-2">
          <Search className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-tv-text-faint" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("data.tools.merge.searchTarget")}
            aria-label={t("data.tools.merge.searchTarget")}
            className="h-10 w-full rounded-[10px] border border-[#d8e3de] bg-[#f8fbf9] pe-9 ps-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus focus:border-[#185045]"
          />
        </div>
        {query.trim().length >= 2 && found.length > 0 ? (
          <ul className="mb-3 grid max-h-48 gap-1 overflow-y-auto">
            {found.map((h) => (
              <li key={String(h.id)}>
                <button
                  type="button"
                  onClick={() => {
                    pick(h);
                    setQuery("");
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-start text-sm hover:bg-[#eef5f2] ${target?.id === h.id ? "bg-[#e2ede9] font-bold" : ""}`}
                >
                  <span>{String(h.arabic_name ?? "")}</span>
                  <span className="text-tv-text-faint">{cityLabel(cities, h.city_id)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {target && sources.length === 0 ? <p className="mb-3 text-sm text-tv-text-faint">{t("data.tools.merge.pickOther")}</p> : null}

        {target && sources.length > 0 ? (
          shown ? (
            <div className="mb-4 grid gap-2 text-sm">
              <div className={panel}>
                <p className="text-xs font-bold text-tv-text-faint">{t("data.tools.merge.stays")}</p>
                <p className="font-extrabold">{shown.keep.arabic_name} <span className="font-normal text-tv-text-faint">· {cityLabel(cities, shown.keep.city_id)}</span></p>
                {shown.keep.english_name ? <p dir="ltr" className="text-start text-[#557d78]">{shown.keep.english_name}</p> : null}
              </div>
              <div className={panel}>
                <p className="text-xs font-bold text-tv-text-faint">{t("data.tools.merge.goes")}</p>
                <ul className="grid gap-0.5">
                  {shown.drops.map((d) => (
                    <li key={d.id}>
                      {d.arabic_name} <span className="text-tv-text-faint">· {cityLabel(cities, d.city_id)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className={panel}>
                <p className="text-xs font-bold text-tv-text-faint">{t("data.tools.merge.moves")}</p>
                <p>{t("data.tools.usage.line", { offers: shown.usage.offers, drafts: shown.usage.drafts, rates: shown.usage.rates, bookings: shown.usage.bookings })}</p>
                <p>{t("data.tools.merge.rooms", { moved: shown.rooms.moved, merged: shown.rooms.merged })}</p>
                {shown.usage.bookings > 0 ? <p className="text-[12px] text-tv-text-faint">{t("data.tools.merge.bookingsNote")}</p> : null}
              </div>
            </div>
          ) : error ? null : (
            <p className="mb-4 flex items-center gap-2 text-sm text-tv-text-faint">
              <Loader2 className="size-4 animate-spin" aria-hidden /> {t("data.tools.merge.counting")}
            </p>
          )
        ) : null}

        {error ? (
          <p role="alert" className="mb-4 rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] px-4 py-2.5 text-[13px] font-semibold text-[#c22850]">{error}</p>
        ) : null}

        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="h-10 rounded-[10px] border border-[#d8e3de] px-5 text-sm font-semibold hover:bg-[#f4f8f6]">
            {t("cancel")}
          </button>
          <button
            type="button"
            disabled={!shown || merging || sources.length === 0}
            onClick={confirm}
            className="tv-btn-primary flex h-10 items-center gap-2 rounded-[10px] px-6 text-sm font-bold disabled:opacity-50"
          >
            {merging ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <GitMerge className="size-4" aria-hidden />}
            {t("data.tools.merge.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
