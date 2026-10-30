"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, ChevronDown, Loader2, MapPin, Search, Star, XCircle } from "lucide-react";
import { DirText } from "@/components/DirText";
import {
  trySupplierCities,
  trySupplierHotel,
  trySupplierSearch,
  type HotelTryResult,
  type SearchTryCall,
  type SearchTryHotel,
  type SearchTryResult,
} from "@/lib/data/suppliers";
import type { SupplierListedHotel } from "@/lib/providers/hotel-supplier";
import type { TranslationKey } from "@/lib/i18n";
import { useTraveliunUI } from "./TraveliunUIProvider";
import { TraveliunShell } from "./TraveliunShell";

const fieldClass =
  "tv-field h-10 rounded-[9px] border px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus disabled:opacity-60";
const labelClass = "grid gap-1 text-[12px] font-bold text-[#185045]";

const NATIONALITIES = [
  { code: "SA", name: "السعودية" },
  { code: "AE", name: "الإمارات" },
  { code: "KW", name: "الكويت" },
  { code: "QA", name: "قطر" },
  { code: "BH", name: "البحرين" },
  { code: "OM", name: "عُمان" },
];

const METHOD_LABEL: Record<string, TranslationKey> = {
  CityList: "settings.supplierTry.m.CityList",
  TBOHotelCodeList: "settings.supplierTry.m.TBOHotelCodeList",
  search: "settings.supplierTry.m.search",
  Hoteldetails: "settings.supplierTry.m.Hoteldetails",
};

const BOARD_LABEL: Record<string, TranslationKey> = {
  RO: "pg.board.RO",
  BB: "pg.board.BB",
  HB: "pg.board.HB",
  FB: "pg.board.FB",
  AI: "pg.board.AI",
};

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** «تجربة البحث» — a real, read-only availability search at one supplier (TBO today). */
export function SupplierSearchTry({ code, countries }: { code: string; countries: { name: string; iso2: string }[] }) {
  const { t } = useTraveliunUI();
  const [country, setCountry] = useState("");
  const [cities, setCities] = useState<{ code: string; name: string }[]>([]);
  const [cityState, setCityState] = useState<{ loading: boolean; error?: string; calls?: SearchTryCall[] }>({ loading: false });
  const [city, setCity] = useState("");
  const [checkIn, setCheckIn] = useState(() => day(30));
  const [checkOut, setCheckOut] = useState(() => day(32));
  const [rooms, setRooms] = useState(1);
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [ages, setAges] = useState<number[]>([8, 8, 8, 8]);
  const [nationality, setNationality] = useState("SA");
  const [hotelName, setHotelName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<(SearchTryResult & { at: string }) | null>(null);

  async function pickCountry(iso2: string) {
    setCountry(iso2);
    setCity("");
    setCities([]);
    if (!iso2) return setCityState({ loading: false });
    setCityState({ loading: true });
    const res = await trySupplierCities(code, iso2).catch(() => ({ ok: false as const, message: t("err.db"), calls: [] }));
    if (res.ok) {
      setCities(res.cities);
      setCityState({ loading: false });
    } else {
      setCityState({ loading: false, error: res.message, calls: res.calls });
    }
  }

  async function search() {
    setBusy(true);
    const at = new Date().toISOString().slice(0, 19).replace("T", " ");
    const res: SearchTryResult = await trySupplierSearch({
      code,
      country_code: country,
      country_name: countries.find((c) => c.iso2 === country)?.name ?? "",
      city,
      check_in: checkIn,
      check_out: checkOut,
      rooms,
      adults,
      children,
      children_ages: ages.slice(0, children),
      nationality,
      hotel_name: hotelName,
    }).catch(() => ({ ok: false, message: t("err.db"), calls: [] }));
    setResult({ ...res, at });
    setBusy(false);
  }

  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

  return (
    <TraveliunShell title="settings.supplierTry.title">
      <div className="tv-fade-up mx-auto max-w-[960px]">
        <Link href="/settings/suppliers" className="mb-2 inline-flex items-center gap-1 text-[12px] font-bold text-[#557d78] hover:text-[#185045]">
          <ArrowRight className="size-3.5 ltr:rotate-180" />
          {t("settings.supplierTry.back")}
        </Link>
        <h1 className="text-lg font-extrabold text-[#003c3a]">{t("settings.supplierTry.title")}</h1>
        <p className="mt-1 mb-5 text-[12.5px] font-semibold text-tv-text-faint">{t("settings.supplierTry.subtitle")}</p>

        <section className="rounded-2xl border border-[#e2ebe7] bg-white p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className={labelClass}>
              {t("settings.supplierTry.country")}
              <select value={country} onChange={(e) => void pickCountry(e.target.value)} className={fieldClass}>
                <option value="">{t("settings.supplierTry.pickCountry")}</option>
                {countries.map((c) => (
                  <option key={c.iso2} value={c.iso2}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              {t("settings.supplierTry.city")}
              <select value={city} onChange={(e) => setCity(e.target.value)} disabled={!cities.length} className={fieldClass} dir="ltr">
                <option value="">{cityState.loading ? t("settings.supplierTry.citiesLoading") : t("settings.supplierTry.pickCity")}</option>
                {cities.map((c) => (
                  <option key={c.code} value={c.name}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className={labelClass}>
              {t("settings.supplierTry.checkIn")}
              <input type="date" value={checkIn} min={day(1)} onChange={(e) => setCheckIn(e.target.value)} className={`${fieldClass} tv-tnum`} />
            </label>
            <label className={labelClass}>
              {t("settings.supplierTry.checkOut")}
              <input type="date" value={checkOut} min={checkIn} onChange={(e) => setCheckOut(e.target.value)} className={`${fieldClass} tv-tnum`} />
            </label>
            <label className={labelClass}>
              {t("settings.supplierTry.rooms")}
              <select value={rooms} onChange={(e) => setRooms(Number(e.target.value))} className={`${fieldClass} tv-tnum`}>
                {range(1, 4).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className={labelClass}>
              {t("settings.supplierTry.adults")}
              <select value={adults} onChange={(e) => setAdults(Number(e.target.value))} className={`${fieldClass} tv-tnum`}>
                {range(1, 8).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className={labelClass}>
              {t("settings.supplierTry.children")}
              <select value={children} onChange={(e) => setChildren(Number(e.target.value))} className={`${fieldClass} tv-tnum`}>
                {range(0, 4).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className={labelClass}>
              {t("settings.supplierTry.nationality")}
              <select value={nationality} onChange={(e) => setNationality(e.target.value)} className={fieldClass}>
                {NATIONALITIES.map((n) => <option key={n.code} value={n.code}>{n.name}</option>)}
              </select>
            </label>
            {range(1, children).map((n) => (
              <label key={n} className={labelClass}>
                {t("settings.supplierTry.childAge", { n })}
                <select
                  value={ages[n - 1]}
                  onChange={(e) => setAges((prev) => prev.map((a, i) => (i === n - 1 ? Number(e.target.value) : a)))}
                  className={`${fieldClass} tv-tnum`}
                >
                  {range(0, 17).map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </label>
            ))}
            <label className={`${labelClass} sm:col-span-2`}>
              {t("settings.supplierTry.hotelName")}
              <input dir="ltr" value={hotelName} onChange={(e) => setHotelName(e.target.value)} className={`${fieldClass} text-start`} />
            </label>
          </div>

          {cityState.error ? <Refusal message={cityState.error} calls={cityState.calls ?? []} /> : null}

          <button
            type="button"
            onClick={() => void search()}
            disabled={busy || !country || !city || checkOut <= checkIn}
            className="mt-4 inline-flex h-10 items-center gap-2 rounded-[9px] bg-[#185045] px-5 text-[13px] font-bold text-white transition-colors hover:bg-[#0f4439] disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            {busy ? t("settings.supplierTry.searching") : t("settings.supplierTry.search")}
          </button>
        </section>

        {result ? <Outcome code={code} result={result} query={hotelName} /> : null}
      </div>
    </TraveliunShell>
  );
}

/** What came back: the supplier's refusal in its own words, or the hotels — then every call. */
function Outcome({ code, result, query }: { code: string; result: SearchTryResult & { at: string }; query: string }) {
  const { t } = useTraveliunUI();
  const failed = result.calls.find((c) => !c.ok);
  const priced = new Set(result.ok ? result.hotels.map((h) => h.id) : []);
  return (
    <div className="mt-5 space-y-4">
      {!result.ok ? (
        <p className="rounded-[12px] border border-[#f2c9d3] bg-[#fdf3f5] px-4 py-3 text-[13px] font-bold text-[#c22850]">{result.message}</p>
      ) : failed ? (
        <Refusal message="" calls={[failed]} />
      ) : result.hotels.length === 0 ? (
        <p className="rounded-[12px] border border-dashed border-[#cfe0d9] px-4 py-6 text-center text-[13px] font-bold text-[#557d78]">{t("settings.supplierTry.none")}</p>
      ) : (
        <>
          <p className="text-[13px] font-extrabold text-[#185045]">
            {t("settings.supplierTry.found", { count: result.hotels.length, nights: result.nights })}
          </p>
          {result.hotels.map((h) => <HotelRow key={h.id} hotel={h} />)}
        </>
      )}

      {result.listed?.length ? <ListedHotels code={code} hotels={result.listed} priced={priced} initial={query} /> : null}

      {result.calls.length ? (
        <section className="rounded-[12px] border border-[#e7f0ec] bg-[#f8fbf9] p-3">
          <p className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[12.5px] font-extrabold text-[#185045]">
            {t("settings.supplierTry.calls")}
            <DirText dir="ltr" className="tv-tnum text-[11px] font-bold text-tv-text-faint">{result.at} UTC</DirText>
          </p>
          <ul className="space-y-1.5">
            {result.calls.map((c, i) => <CallLine key={i} call={c} />)}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/**
 * The city's hotels as TBO sent them (TBOHotelCodeList) — no prices, shown whatever Search answered; a press opens
 * one hotel's own details (Hoteldetails).
 */
function ListedHotels({ code, hotels, priced, initial }: { code: string; hotels: SupplierListedHotel[]; priced: Set<string>; initial: string }) {
  const { t } = useTraveliunUI();
  const [query, setQuery] = useState(initial);
  const [stars, setStars] = useState(0);
  const [shown, setShown] = useState(50);
  const [open, setOpen] = useState<string | null>(null);
  const wanted = query.trim().toLowerCase();
  const list = hotels.filter((h) => (!wanted || h.name.toLowerCase().includes(wanted) || h.code === wanted) && (!stars || h.stars === stars));
  return (
    <section className="rounded-2xl border border-[#e2ebe7] bg-white p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[14.5px] font-extrabold text-[#003c3a]">{t("settings.supplierTry.listed.title")}</h2>
        <span className="tv-tnum text-[12px] font-bold text-[#557d78]">{t("settings.supplierTry.listed.count", { shown: list.length, total: hotels.length })}</span>
      </div>
      <p className="mb-3 text-[12px] font-semibold text-tv-text-faint">{t("settings.supplierTry.listed.hint")}</p>
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          dir="ltr"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setShown(50); }}
          placeholder={t("settings.supplierTry.listed.search")}
          aria-label={t("settings.supplierTry.listed.search")}
          className={`${fieldClass} min-w-[220px] flex-1 text-start`}
        />
        <select value={stars} onChange={(e) => { setStars(Number(e.target.value)); setShown(50); }} className={`${fieldClass} tv-tnum`} aria-label={t("settings.supplierTry.listed.allStars")}>
          <option value={0}>{t("settings.supplierTry.listed.allStars")}</option>
          {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{t("settings.supplierTry.stars", { n })}</option>)}
        </select>
      </div>
      {list.length === 0 ? (
        <p className="py-4 text-center text-[13px] font-bold text-tv-text-faint">{t("settings.supplierTry.listed.none")}</p>
      ) : (
        <ul className="divide-y divide-[#eef4f1]">
          {list.slice(0, shown).map((h) => (
            <li key={h.code}>
              <button
                type="button"
                onClick={() => setOpen(open === h.code ? null : h.code)}
                aria-expanded={open === h.code}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 py-2 text-start hover:bg-[#f8fbf9]"
              >
                <ChevronDown className={`size-4 shrink-0 text-tv-text-faint transition-transform ${open === h.code ? "rotate-180" : ""}`} aria-hidden />
                <DirText dir="ltr" className="text-[13px] font-bold text-[#0f3d38]">{h.name}</DirText>
                {h.stars ? (
                  <span className="inline-flex items-center gap-0.5 text-[11.5px] font-bold text-[#b7791f]">
                    <Star className="size-3 fill-current" aria-hidden />
                    {h.stars}
                  </span>
                ) : null}
                {priced.has(h.code) ? <span className="rounded-full bg-[#e6f4ee] px-2 text-[11px] font-bold text-[#0f7a52]">{t("settings.supplierTry.listed.priced")}</span> : null}
                <DirText dir="ltr" className="tv-tnum ms-auto text-[11px] font-bold text-tv-text-faint">#{h.code}</DirText>
              </button>
              {open === h.code ? <HotelDetails code={code} hotelCode={h.code} /> : null}
            </li>
          ))}
        </ul>
      )}
      {list.length > shown ? (
        <button type="button" onClick={() => setShown(shown + 50)} className="mt-2 text-[12.5px] font-bold text-[#2aa87a] hover:text-[#185045]">
          {t("settings.supplierTry.listed.more")}
        </button>
      ) : null}
    </section>
  );
}

function HotelDetails({ code, hotelCode }: { code: string; hotelCode: string }) {
  const { t } = useTraveliunUI();
  const [state, setState] = useState<HotelTryResult | null>(null);
  useEffect(() => {
    let live = true;
    trySupplierHotel(code, hotelCode)
      .then((r) => { if (live) setState(r); })
      .catch(() => { if (live) setState({ ok: false, message: t("err.db"), calls: [] }); });
    return () => { live = false; };
  }, [code, hotelCode, t]);
  if (!state) {
    return (
      <p className="flex items-center gap-2 pb-3 ps-7 text-[12px] font-semibold text-tv-text-faint">
        <Loader2 className="size-3.5 animate-spin" aria-hidden /> {t("settings.supplierTry.details.loading")}
      </p>
    );
  }
  if (!state.ok) return <div className="pb-3 ps-7"><Refusal message={state.message} calls={state.calls} /></div>;
  const h = state.hotel;
  return (
    <div className="grid gap-2 pb-4 ps-7 text-[12.5px] text-[#0f3d38]">
      {h.images.length ? (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {h.images.map((src) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={src} src={src} alt="" loading="lazy" className="h-24 w-36 shrink-0 rounded-lg bg-[#eef4f1] object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />
          ))}
        </div>
      ) : null}
      {h.address ? <DirText dir="ltr" className="font-semibold text-[#557d78]">{h.address}</DirText> : null}
      {h.lat !== null && h.lng !== null ? (
        <a href={`https://www.google.com/maps?q=${h.lat},${h.lng}`} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 font-bold text-[#2aa87a] hover:text-[#185045]">
          <MapPin className="size-3.5" aria-hidden /> {t("settings.supplierTry.details.map")}
        </a>
      ) : null}
      {h.facilities.length ? (
        <div>
          <p className="mb-1 text-[11.5px] font-bold text-tv-text-faint">{t("settings.supplierTry.details.facilities")}</p>
          <div dir="ltr" className="flex flex-wrap gap-1">
            {h.facilities.map((f) => <span key={f} className="rounded-full bg-[#f4f8f6] px-2 py-0.5 text-[11px] font-semibold text-[#557d78]">{f}</span>)}
          </div>
        </div>
      ) : null}
      {h.description ? <p dir="ltr" className="line-clamp-6 whitespace-pre-line text-start text-[12px] text-[#557d78]">{h.description}</p> : null}
    </div>
  );
}

function Refusal({ message, calls }: { message: string; calls: SearchTryCall[] }) {
  const { t } = useTraveliunUI();
  const failed = calls.find((c) => !c.ok);
  return (
    <div className="mt-3 rounded-[12px] border border-[#f2c9d3] bg-[#fdf3f5] px-4 py-3 text-[13px] font-bold text-[#c22850]">
      {message ? <p>{message}</p> : null}
      {failed ? (
        <>
          <p>
            {t("settings.supplierTry.refused", {
              method: METHOD_LABEL[failed.method] ? t(METHOD_LABEL[failed.method]) : failed.method,
              code: failed.code ?? failed.http ?? "—",
              description: failed.description ?? "",
            })}
          </p>
          <p className="mt-1 text-[12px] font-semibold text-[#8a5a66]">
            {t(
              failed.code === 401 || failed.http === 401
                ? "settings.supplierTry.hintCreds"
                : failed.timeout
                  ? "settings.supplierTry.hintTimeout"
                  : failed.http === null
                  ? "settings.supplierTry.hintNetwork"
                  : "settings.supplierTry.hintServer",
            )}
          </p>
        </>
      ) : null}
    </div>
  );
}

function CallLine({ call }: { call: SearchTryCall }) {
  const { t } = useTraveliunUI();
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] font-semibold text-[#557d78]">
      {call.ok ? <CheckCircle2 className="size-4 text-[#0f7a52]" /> : <XCircle className="size-4 text-[#c22850]" />}
      <span className="font-bold text-[#185045]">{METHOD_LABEL[call.method] ? t(METHOD_LABEL[call.method]) : call.method}</span>
      <DirText dir="ltr" className="tv-tnum text-[11.5px]">
        {call.method} · HTTP {call.http ?? "—"} · {call.code ?? "—"} {call.description ?? ""} · {(call.ms / 1000).toFixed(1)}s
      </DirText>
      {call.count !== null ? <span className="tv-tnum">{t("settings.supplierTry.rows", { n: call.count })}</span> : null}
    </li>
  );
}

function HotelRow({ hotel }: { hotel: SearchTryHotel }) {
  const { t } = useTraveliunUI();
  const [all, setAll] = useState(false);
  const shown = all ? hotel.rates : hotel.rates.slice(0, 4);
  return (
    <section className="rounded-2xl border border-[#e2ebe7] bg-white p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <DirText dir="ltr" className="text-[14.5px] font-extrabold text-[#003c3a]">{hotel.name}</DirText>
        <span className="flex items-center gap-2 text-[11.5px] font-bold text-tv-text-faint">
          {hotel.stars ? (
            <span className="inline-flex items-center gap-1 text-[#b7791f]">
              <Star className="size-3.5 fill-current" />
              {t("settings.supplierTry.stars", { n: hotel.stars })}
            </span>
          ) : null}
          <DirText dir="ltr" className="tv-tnum">#{hotel.id}</DirText>
        </span>
      </div>
      <ul className="text-[12.5px]">
        {shown.map((r, i) => (
          <li key={i} className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-[#eef4f1] py-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1.2fr)_auto_auto]">
            <div>
              <DirText dir="ltr" className="font-bold text-[#0f3d38]">{r.room}</DirText>
              <div className="text-[11.5px] font-semibold text-tv-text-faint">{BOARD_LABEL[r.board] ? t(BOARD_LABEL[r.board]) : r.board}</div>
            </div>
            <div>
              <span className={`text-[11.5px] font-bold ${r.refundable ? "text-[#0f7a52]" : "text-[#c22850]"}`}>
                {t(r.refundable ? "settings.supplierTry.refundable" : "settings.supplierTry.nonRefundable")}
              </span>
              {r.refundable ? <div className="tv-tnum text-[11px] text-tv-text-faint">{r.policy}</div> : null}
            </div>
            {r.net !== null ? (
              <div className="whitespace-nowrap">
                <div className="text-[11px] font-bold text-tv-text-faint">{t("settings.supplierTry.net")}</div>
                <DirText dir="ltr" className="tv-tnum font-bold text-[#557d78]">{money(r.net)} {r.currency}</DirText>
              </div>
            ) : null}
            <div className="whitespace-nowrap">
              <div className="text-[11px] font-bold text-tv-text-faint">{t("settings.supplierTry.sell")}</div>
              {r.sell !== null ? (
                <>
                  <DirText dir="ltr" className={`tv-tnum font-extrabold ${r.blocked ? "text-[#c22850]" : "text-[#185045]"}`}>{money(r.sell)} SAR</DirText>
                  {r.blocked ? <div className="text-[11px] font-bold text-[#c22850]" title={t("pg.supplier.blocked")}>{t("settings.supplierTry.blocked")}</div> : null}
                </>
              ) : (
                <span className="text-[11.5px] font-bold text-[#b7791f]">{t("settings.supplierTry.noSell")}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
      {hotel.rates.length > 4 && !all ? (
        <button type="button" onClick={() => setAll(true)} className="mt-2 text-[12px] font-bold text-[#2aa87a] hover:text-[#185045]">
          {t("settings.supplierTry.allRooms", { n: hotel.rates.length })}
        </button>
      ) : null}
    </section>
  );
}
