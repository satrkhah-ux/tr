"use client";

import { useMemo, useRef, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { DirText } from "@/components/DirText";
import { normAr } from "@/lib/catalog/norm";
import type { TransferPointKind } from "@/lib/types";
import {
  addTransportCountry,
  addTransportPlace,
  deleteTransportRoad,
  getTransportCountry,
  saveTransportRoad,
  type TransportCountry,
  type TransportPlace,
} from "@/lib/data/transport-prices";
import { TraveliunShell } from "./TraveliunShell";
import { useTraveliunUI } from "./TraveliunUIProvider";

const field = "h-10 rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-[13px] text-[#185045] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus focus:border-[#2aa87a]";
const KIND_LABEL: Record<TransferPointKind, string> = { city: "مدينة", airport: "مطار", port: "ميناء", station: "محطة" };

/**
 * «إدارة أسعار المواصلات» (the owner, 2026-10-26): country ← the line's two end
 * KINDS ← the two places from the country's lists (adding what they lack) ← a
 * price per vehicle ← save. One page, step by step, no training needed; what is
 * saved shows underneath with search and delete, a press loads it back to edit.
 */
export function TransportPricesAdmin({ countries }: { countries: { id: string; name: string; currency: string | null }[] }) {
  const { t } = useTraveliunUI();
  const [allCountries, setAllCountries] = useState(countries);
  const [countryId, setCountryId] = useState("");
  const [countryQuery, setCountryQuery] = useState("");
  const [data, setData] = useState<TransportCountry | null>(null);
  const [loading, setLoading] = useState(false);
  const [fromKind, setFromKind] = useState<TransferPointKind>("airport");
  const [toKind, setToKind] = useState<TransferPointKind>("city");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [currency, setCurrency] = useState("SAR");
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [roadQuery, setRoadQuery] = useState("");
  const asked = useRef("");

  async function loadCountry(id: string) {
    setCountryId(id);
    setFromId(""); setToId(""); setPrices({}); setMessage(null);
    setData(null);
    if (!id) return;
    const c = allCountries.find((x) => x.id === id);
    if (c?.currency && /^[A-Z]{3}$/.test(c.currency)) setCurrency(c.currency);
    asked.current = id;
    setLoading(true);
    const result = await getTransportCountry(id);
    if (asked.current !== id) return;
    setLoading(false);
    if (result.ok) setData(result);
    else setMessage({ tone: "bad", text: t(result.error) });
  }

  const placesOf = (kind: TransferPointKind): TransportPlace[] =>
    kind === "city" ? (data?.cities ?? []) : (data?.points ?? []).filter((p) => p.kind === kind);

  const kindsAvailable = useMemo(() => {
    const kinds: TransferPointKind[] = ["city"];
    for (const k of ["airport", "port", "station"] as const) if ((data?.points ?? []).some((p) => p.kind === k)) kinds.push(k);
    return kinds;
  }, [data]);

  // picking a saved road loads it into the form
  function loadRoad(road: TransportCountry["roads"][number]) {
    setFromKind(road.from.kind); setToKind(road.to.kind);
    setFromId(road.from.id); setToId(road.to.id);
    setCurrency(road.prices[0]?.currency ?? currency);
    setPrices(Object.fromEntries(road.prices.map((p) => [p.car, String(p.price)])));
    setMessage(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save() {
    if (!data || !countryId || !fromId || !toId || saving) return;
    const list = data.cars.map((c) => {
      const raw = (prices[c.name] ?? "").trim();
      return { car: c.name, price: raw === "" ? null : Number(raw) };
    });
    if (list.some((p) => p.price !== null && (!Number.isFinite(p.price) || p.price < 0))) {
      setMessage({ tone: "bad", text: t("tp.badPrice") });
      return;
    }
    if (!list.some((p) => p.price !== null)) {
      setMessage({ tone: "bad", text: t("tp.noPrices") });
      return;
    }
    setSaving(true);
    setMessage(null);
    const result = await saveTransportRoad({
      countryId,
      from: { kind: fromKind, id: fromId },
      to: { kind: toKind, id: toId },
      currency,
      prices: list,
    });
    setSaving(false);
    if (!result.ok) return setMessage({ tone: "bad", text: t(result.error) });
    setMessage({ tone: "ok", text: t("tp.saved") });
    void loadCountryKeepForm();
  }

  // reload the saved table without clearing the form
  async function loadCountryKeepForm() {
    const result = await getTransportCountry(countryId);
    if (result.ok) setData(result);
  }

  async function removeRoad(road: TransportCountry["roads"][number]) {
    if (!window.confirm(t("tp.deleteConfirm"))) return;
    const result = await deleteTransportRoad({ from: { kind: road.from.kind, id: road.from.id }, to: { kind: road.to.kind, id: road.to.id } });
    if (result.ok) void loadCountryKeepForm();
  }

  async function addPlace(kind: TransferPointKind) {
    const name = window.prompt(t("tp.newPlaceName", { kind: KIND_LABEL[kind] }));
    if (!name?.trim() || !countryId) return;
    let cityId: string | null = null;
    if (kind !== "city" && data && data.cities.length > 0) {
      const city = window.prompt(t("tp.newPlaceCity", { cities: data.cities.map((c) => c.name).join("، ") }))?.trim();
      cityId = data.cities.find((c) => c.name === city)?.id ?? null;
    }
    const result = await addTransportPlace({ countryId, kind: kind === "city" ? "city" : kind, name, cityId });
    if (!result.ok) return setMessage({ tone: "bad", text: t(result.error) });
    await loadCountryKeepForm();
    (kind === fromKind ? setFromId : setToId)(result.id);
  }

  async function addCountry() {
    const name = window.prompt(t("tp.newCountryName"));
    if (!name?.trim()) return;
    const result = await addTransportCountry(name);
    if (!result.ok) return setMessage({ tone: "bad", text: t(result.error) });
    setAllCountries((prev) => [...prev, { id: result.id, name: name.trim(), currency: null }]);
    void loadCountry(result.id);
  }

  const folded = normAr(countryQuery);
  const shownCountries = allCountries.filter((c) => c.id === countryId || !folded || normAr(c.name).includes(folded));
  const roadFolded = normAr(roadQuery);
  const shownRoads = (data?.roads ?? []).filter(
    (r) => !roadFolded || normAr(`${r.from.name} ${r.to.name}`).includes(roadFolded),
  );

  return (
    <TraveliunShell title="nav.transportPrices">
      <section className="space-y-4">
        <div className="rounded-[14px] border border-[#cfe0d9] bg-white p-4">
          {/* ١ الدولة */}
          <h2 className="mb-2 text-[15px] font-extrabold text-[#185045]">{t("tp.step1")}</h2>
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1 text-[12px] font-bold text-[#185045]">
              {t("filter.country")}
              <input type="search" value={countryQuery} onChange={(e) => setCountryQuery(e.target.value)} placeholder={t("data.tools.refSearch")} className={`${field} h-9 min-w-56`} />
              <select value={countryId} onChange={(e) => void loadCountry(e.target.value)} className={`${field} min-w-56`}>
                <option value="">{t("chooseOption")}</option>
                {shownCountries.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </select>
            </label>
            <button type="button" onClick={() => void addCountry()} className="mb-0.5 inline-flex h-9 items-center gap-1 rounded-[9px] border border-[#2aa87a] px-3 text-[12px] font-bold text-[#185045] hover:bg-[#eef7f3]">
              <Plus className="size-3.5" /> {t("tp.addCountry")}
            </button>
            {loading ? <Loader2 className="mb-2 size-4 animate-spin text-[#2aa87a]" aria-hidden /> : null}
          </div>

          {data ? (
            <>
              {/* ٢ نوع الخط */}
              <h2 className="mb-2 mt-5 text-[15px] font-extrabold text-[#185045]">{t("tp.step2")}</h2>
              <div className="flex flex-wrap gap-6">
                {([["from", fromKind, setFromKind, setFromId], ["to", toKind, setToKind, setToId]] as const).map(([side, kind, setKind, setId]) => (
                  <div key={side} className="grid gap-1 text-[12px] font-bold text-[#185045]">
                    {side === "from" ? t("col.from") : t("col.to")}
                    <div role="radiogroup" className="inline-flex overflow-hidden rounded-[10px] bg-[#e2ede9] p-1">
                      {kindsAvailable.map((k) => (
                        <button key={k} type="button" role="radio" aria-checked={kind === k}
                          onClick={() => { setKind(k); setId(""); }}
                          className={`rounded-lg px-4 py-1.5 text-[12.5px] font-bold ${kind === k ? "bg-white text-[#185045] shadow-[0_1px_3px_rgba(0,60,58,0.12)]" : "text-tv-text-faint"}`}>
                          {KIND_LABEL[k]}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* ٣ النقطتان */}
              <h2 className="mb-2 mt-5 text-[15px] font-extrabold text-[#185045]">{t("tp.step3")}</h2>
              <div className="flex flex-wrap items-end gap-3">
                {([["from", fromKind, fromId, setFromId], ["to", toKind, toId, setToId]] as const).map(([side, kind, value, setId]) => (
                  <label key={side} className="grid gap-1 text-[12px] font-bold text-[#185045]">
                    {(side === "from" ? t("col.from") : t("col.to")) + ` (${KIND_LABEL[kind]})`}
                    <span className="flex items-center gap-2">
                      <select value={value} onChange={(e) => setId(e.target.value)} className={`${field} min-w-64`}>
                        <option value="">{t("chooseOption")}</option>
                        {placesOf(kind).map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
                      </select>
                      <button type="button" onClick={() => void addPlace(kind)} title={t("tp.addPlace")} className="inline-flex h-9 items-center gap-1 rounded-[9px] border border-[#2aa87a] px-2.5 text-[12px] font-bold text-[#185045] hover:bg-[#eef7f3]">
                        <Plus className="size-3.5" />
                      </button>
                    </span>
                  </label>
                ))}
                <label className="grid gap-1 text-[12px] font-bold text-[#185045]">
                  {t("data.model.grid.currency")}
                  <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={`${field} w-28`}>
                    {[...new Set([data.currency, "SAR", currency].filter((c): c is string => Boolean(c && /^[A-Z]{3}$/.test(c))))].map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </div>

              {/* ٤ السيارات وأسعارها */}
              {fromId && toId ? (
                <>
                  <h2 className="mb-2 mt-5 text-[15px] font-extrabold text-[#185045]">{t("tp.step4")}</h2>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {data.cars.map((car) => (
                      <label key={car.name} className="flex items-center justify-between gap-3 rounded-[10px] border border-[#e2ebe7] px-3 py-2 text-[13px] font-bold text-[#185045]">
                        <span>{car.name}{car.pax ? <span className="font-normal text-tv-text-faint"> ({car.pax})</span> : null}</span>
                        <input type="number" min={0} dir="ltr" value={prices[car.name] ?? ""} placeholder="—"
                          onChange={(e) => setPrices((prev) => ({ ...prev, [car.name]: e.target.value }))}
                          className={`${field} tv-tnum w-28 text-center`} />
                      </label>
                    ))}
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    <button type="button" disabled={saving} onClick={() => void save()} className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-[#185045] px-6 text-sm font-bold text-white hover:bg-[#0f4439] disabled:opacity-70">
                      {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                      {t("tp.save")}
                    </button>
                    {message ? (
                      <p role="status" className={`text-[13px] font-bold ${message.tone === "ok" ? "text-[#1d7a4f]" : "text-[#c22850]"}`}>{message.text}</p>
                    ) : null}
                  </div>
                </>
              ) : null}
            </>
          ) : null}
          {message && !data ? <p role="alert" className="mt-3 text-[13px] font-bold text-[#c22850]">{message.text}</p> : null}
        </div>

        {/* المحفوظ لهذه الدولة */}
        {data ? (
          <div className="rounded-[14px] border border-[#cfe0d9] bg-white p-4">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <h2 className="flex-1 text-[15px] font-extrabold text-[#185045]">{t("tp.savedTitle")}</h2>
              <input type="search" value={roadQuery} onChange={(e) => setRoadQuery(e.target.value)} placeholder={t("searchPlaceholder")} className={`${field} h-9 w-56`} />
            </div>
            {shownRoads.length === 0 ? (
              <p className="text-[13px] font-semibold text-tv-text-faint">{t("tp.savedEmpty")}</p>
            ) : (
              <ul className="grid gap-2">
                {shownRoads.map((road) => (
                  <li key={`${road.from.kind}${road.from.id}${road.to.kind}${road.to.id}`} className="flex flex-wrap items-center gap-2 rounded-[10px] border border-[#e2ebe7] px-3 py-2">
                    <button type="button" onClick={() => loadRoad(road)} className="min-w-0 flex-1 text-start text-[13px] font-bold text-[#185045] hover:underline">
                      <DirText>{`${KIND_LABEL[road.from.kind]} ${road.from.name} ← ${KIND_LABEL[road.to.kind]} ${road.to.name}`}</DirText>
                    </button>
                    <span className="flex flex-wrap gap-1.5">
                      {road.prices.map((p) => (
                        <span key={p.car} className="tv-tnum rounded-full bg-[#eef5f2] px-2.5 py-0.5 text-[11.5px] font-bold text-[#2a7d66]">
                          {p.car}: {p.price.toLocaleString("en-US")} {p.currency}
                        </span>
                      ))}
                    </span>
                    <button type="button" onClick={() => void removeRoad(road)} aria-label={t("delete")} className="rounded-lg p-1.5 text-[#c43d5a] hover:bg-[#fdeef2]">
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </section>
    </TraveliunShell>
  );
}
