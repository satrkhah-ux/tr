"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Loader2, Search, Star, XCircle } from "lucide-react";
import { DirText } from "@/components/DirText";
import {
  trySupplierCities,
  trySupplierSearch,
  type SearchTryCall,
  type SearchTryHotel,
  type SearchTryResult,
} from "@/lib/data/suppliers";
import type { TranslationKey } from "@/lib/i18n";
import { useTraveliunUI } from "./TraveliunUIProvider";
import { TraveliunShell } from "./TraveliunShell";

const fieldClass =
  "h-10 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[13px] text-[#0f3d38] outline-none focus:border-[#2aa87a] disabled:opacity-60";
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
        <p className="mt-1 mb-5 text-[12.5px] font-semibold text-[#93aaa3]">{t("settings.supplierTry.subtitle")}</p>

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

        {result ? <Outcome result={result} /> : null}
      </div>
    </TraveliunShell>
  );
}

/** What came back: the supplier's refusal in its own words, or the hotels — then every call. */
function Outcome({ result }: { result: SearchTryResult & { at: string } }) {
  const { t } = useTraveliunUI();
  const failed = result.calls.find((c) => !c.ok);
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

      {result.calls.length ? (
        <section className="rounded-[12px] border border-[#e7f0ec] bg-[#f8fbf9] p-3">
          <p className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[12.5px] font-extrabold text-[#185045]">
            {t("settings.supplierTry.calls")}
            <DirText dir="ltr" className="tv-tnum text-[11px] font-bold text-[#93aaa3]">{result.at} UTC</DirText>
          </p>
          <ul className="space-y-1.5">
            {result.calls.map((c, i) => <CallLine key={i} call={c} />)}
          </ul>
        </section>
      ) : null}
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
        <span className="flex items-center gap-2 text-[11.5px] font-bold text-[#93aaa3]">
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
              <div className="text-[11.5px] font-semibold text-[#93aaa3]">{BOARD_LABEL[r.board] ? t(BOARD_LABEL[r.board]) : r.board}</div>
            </div>
            <div>
              <span className={`text-[11.5px] font-bold ${r.refundable ? "text-[#0f7a52]" : "text-[#c22850]"}`}>
                {t(r.refundable ? "settings.supplierTry.refundable" : "settings.supplierTry.nonRefundable")}
              </span>
              {r.refundable ? <div className="tv-tnum text-[11px] text-[#93aaa3]">{r.policy}</div> : null}
            </div>
            {r.net !== null ? (
              <div className="whitespace-nowrap">
                <div className="text-[11px] font-bold text-[#93aaa3]">{t("settings.supplierTry.net")}</div>
                <DirText dir="ltr" className="tv-tnum font-bold text-[#557d78]">{money(r.net)} {r.currency}</DirText>
              </div>
            ) : null}
            <div className="whitespace-nowrap">
              <div className="text-[11px] font-bold text-[#93aaa3]">{t("settings.supplierTry.sell")}</div>
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
