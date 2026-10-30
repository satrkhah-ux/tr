"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Loader2, Search } from "lucide-react";
import { DirText } from "@/components/DirText";
import type { TranslationKey } from "@/lib/i18n";
import { searchData, type DataSearch } from "@/lib/data/data-search";
import { useTraveliunUI } from "./TraveliunUIProvider";

const chip = "inline-flex items-center gap-1.5 rounded-[9px] border border-[#dbe6e1] bg-white px-2.5 py-1.5 text-[12px] font-bold text-[#185045] hover:bg-[#f0f7f4]";

/** One figure, a link to its page filtered — a zero is said, not linked. */
function Figure({ label, n, href }: { label: TranslationKey; n: number; href: string }) {
  const { t } = useTraveliunUI();
  const body = (
    <>
      {t(label)} <DirText className="tv-tnum">{String(n)}</DirText>
    </>
  );
  return n > 0 ? (
    <Link href={href} className={chip}>
      {body}
    </Link>
  ) : (
    <span className={`${chip} pointer-events-none opacity-50`}>{body}</span>
  );
}

/**
 * «ابحث عن دولة أو خدمة» (the owner, 2026-10-22): a country, a city or a
 * service — «تركيا», «turkey», «اسطنبول», «استقبال بالورد» — and what the data
 * holds for it, each figure opening its page filtered (data-search.ts).
 */
export function DataSearchBox() {
  const { t } = useTraveliunUI();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<DataSearch | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let live = true;
    const timer = setTimeout(() => {
      setBusy(true);
      searchData(q)
        .then((r) => live && setResult(r))
        .catch(() => live && setResult({ places: [], services: [] }))
        .finally(() => live && setBusy(false));
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  const shown = query.trim().length >= 2 ? result : null;
  const q = encodeURIComponent(query.trim());
  return (
    <div className="tv-fade-up mx-auto max-w-3xl space-y-3">
      <section className="rounded-2xl border border-[#e2ebe7] bg-white p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
        <h1 className="mb-2 text-[15px] font-extrabold text-[#003c3a]">{t("data.search.title")}</h1>
        <div className="relative">
          <Search className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-tv-text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("data.search.hint")}
            autoFocus
            className="h-11 w-full rounded-[10px] border border-[#dbe6e1] bg-white px-3 pe-9 text-[14px] text-[#185045] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus focus:border-[#2aa87a]"
          />
        </div>
      </section>

      {busy ? (
        <p className="flex items-center gap-1.5 text-[12px] font-bold text-[#557d78]">
          <Loader2 className="size-3.5 animate-spin" />
          {t("data.search.searching")}
        </p>
      ) : null}

      {shown && shown.places.length === 0 && shown.services.length === 0 && !busy ? (
        <p className="rounded-[12px] border border-dashed border-[#cfe0d9] px-4 py-5 text-center text-[13px] text-tv-text-faint">{t("data.search.none")}</p>
      ) : null}

      {shown?.places.map((p) =>
        p.kind === "country" ? (
          <section key={`c${p.id}`} className="rounded-2xl border border-[#e2ebe7] bg-white p-4">
            <h2 className="mb-2 text-[14px] font-extrabold text-[#185045]">{p.name}</h2>
            <div className="flex flex-wrap gap-2">
              <Figure label="data.search.cities" n={p.counts.cities} href={`/cities?country_id=${p.id}`} />
              <Figure label="data.search.hotels" n={p.counts.hotels} href={`/hotels?country_id=${p.id}`} />
              <Figure label="data.search.tours" n={p.counts.tours} href={`/cars/tours?country_id=${p.id}`} />
              <Figure label="data.search.transfers" n={p.counts.transfers} href={`/cars/transfers?country_id=${p.id}`} />
              <Figure label="data.search.services" n={p.counts.services} href={`/services?country_id=${p.id}`} />
              <Figure label="data.search.visas" n={p.counts.visas} href={`/visas?country_id=${p.id}`} />
              <span className={`${chip} pointer-events-none`}>{t(p.counts.guide ? "data.search.guideYes" : "data.search.guideNo")}</span>
            </div>
          </section>
        ) : (
          <section key={`t${p.id}`} className="rounded-2xl border border-[#e2ebe7] bg-white p-4">
            <h2 className="mb-2 text-[14px] font-extrabold text-[#185045]">
              {p.name} <span className="text-[12px] font-bold text-tv-text-faint">· {p.country}</span>
            </h2>
            <div className="flex flex-wrap gap-2">
              <Figure label="data.search.hotels" n={p.counts.hotels} href={`/hotels?country_id=${p.countryId ?? ""}&city_id=${p.id}`} />
              <Figure label="data.search.tours" n={p.counts.tours} href={`/cars/tours?country_id=${p.countryId ?? ""}&city_id=${p.id}`} />
            </div>
          </section>
        ),
      )}

      {shown && shown.services.length > 0 ? (
        <section className="rounded-2xl border border-[#e2ebe7] bg-white p-4">
          <h2 className="mb-2 text-[14px] font-extrabold text-[#185045]">{t("data.search.servicesNamed")}</h2>
          <div className="flex flex-wrap gap-2">
            {shown.services.map((s) => (
              <Link key={s.countryId ?? "none"} href={`/services?${s.countryId ? `country_id=${s.countryId}&` : ""}q=${q}`} className={chip}>
                {s.country} <DirText className="tv-tnum">{String(s.count)}</DirText>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
