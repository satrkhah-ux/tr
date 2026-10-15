"use client";

import { useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { DirText } from "@/components/DirText";
import { getPriceGrid, savePriceCell, type GridCity, type GridMode, type PriceGrid as Grid } from "@/lib/data/price-grid";
import { TraveliunShell } from "./TraveliunShell";
import { useTraveliunUI } from "./TraveliunUIProvider";

const field =
  "h-10 rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-[13px] text-[#185045] outline-none focus:border-[#2aa87a]";

/**
 * «أسعار التوصيل والجولات» — a city × the fleet, typed once (data orders 6, 7).
 * A cell saves when it loses focus; an emptied cell removes its price.
 */
export function PriceGrid({ cities }: { cities: GridCity[] }) {
  const { t } = useTraveliunUI();
  const [mode, setMode] = useState<GridMode>("transfers");
  const [cityId, setCityId] = useState("");
  const [currency, setCurrency] = useState("SAR");
  const [grid, setGrid] = useState<Grid | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cellState, setCellState] = useState<Record<string, "saving" | "saved" | "failed">>({});

  const byCountry = useMemo(() => {
    const groups = new Map<string, GridCity[]>();
    for (const c of cities) groups.set(c.country, [...(groups.get(c.country) ?? []), c]);
    return [...groups];
  }, [cities]);

  // the last city / tab asked wins — an older answer arriving late is dropped
  const asked = useRef("");
  async function load(nextMode: GridMode, nextCity: string) {
    setMode(nextMode);
    setCityId(nextCity);
    setCellState({});
    if (!nextCity) return setGrid(null);
    const ticket = `${nextMode}|${nextCity}`;
    asked.current = ticket;
    setLoading(true);
    setError(null);
    const result = await getPriceGrid(nextMode, nextCity);
    if (asked.current !== ticket) return;
    setLoading(false);
    setGrid(result.ok ? result.grid : null);
    setError(result.ok ? null : t(result.error));
  }

  async function save(rowId: string, car: string, raw: string) {
    const key = `${rowId}|${car}`;
    const price = raw.trim() === "" ? null : Number(raw);
    const was = grid?.cells[key];
    if (price !== null && !Number.isFinite(price)) return;
    if ((was?.price ?? null) === price && (price === null || was?.currency === currency)) return;
    setCellState((s) => ({ ...s, [key]: "saving" }));
    const result = await savePriceCell({ mode, cityId, rowId, car, price, currency });
    setCellState((s) => ({ ...s, [key]: result.ok ? "saved" : "failed" }));
    if (result.ok) {
      setGrid((g) => {
        if (!g) return g;
        const cells = { ...g.cells };
        if (price === null) delete cells[key];
        else cells[key] = { price, currency };
        return { ...g, cells };
      });
    }
  }

  const rowLabel = mode === "transfers" ? t("data.model.grid.rowTransfers") : t("data.model.grid.rowTours");
  const empty = mode === "transfers" ? t("data.model.grid.emptyTransfers") : t("data.model.grid.emptyTours");

  return (
    <TraveliunShell title="data.model.grid.title">
      <section className="rounded-[14px] border border-[#cfe0d9] bg-white p-4">
        <div role="tablist" className="mb-3 inline-flex overflow-hidden rounded-[11px] bg-[#e2ede9] p-1 text-[13px]">
          {(["transfers", "tours"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => void load(m, cityId)}
              className={`rounded-lg px-5 py-2 font-bold ${mode === m ? "bg-white text-[#185045] shadow-[0_1px_3px_rgba(0,60,58,0.12)]" : "text-[#6f8f88]"}`}
            >
              {t(`data.model.grid.mode.${m}`)}
            </button>
          ))}
        </div>
        <p className="mb-3 text-[12px] font-semibold text-[#6d8a84]">{t(`data.model.grid.hint.${mode}`)} {t("data.model.grid.clearHint")}</p>

        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-[12px] font-bold text-[#185045]">
            {t("data.model.grid.city")}
            <select
              value={cityId}
              onChange={(e) => {
                const next = e.target.value;
                const city = cities.find((c) => c.id === next);
                if (city?.currency && /^[A-Z]{3}$/.test(city.currency)) setCurrency(city.currency);
                void load(mode, next);
              }}
              className={`${field} min-w-64`}
            >
              <option value="">{t("data.model.grid.chooseCity")}</option>
              {byCountry.map(([country, list]) => (
                <optgroup key={country} label={country}>
                  {list.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-[12px] font-bold text-[#185045]">
            {t("data.model.grid.currency")}
            <input
              dir="ltr"
              maxLength={3}
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              className={`${field} w-24 text-center`}
            />
          </label>
          {loading ? <Loader2 className="mb-2.5 size-4 animate-spin text-[#2aa87a]" aria-hidden /> : null}
        </div>

        {error ? <p role="alert" className="rounded-[10px] bg-[#fdeef2] px-4 py-2.5 text-[13px] font-semibold text-[#c22850]">{error}</p> : null}

        {grid && !error ? (
          grid.cars.length === 0 ? (
            <p className="text-[13px] font-semibold text-[#93aaa3]">{t("data.model.grid.noCars")}</p>
          ) : grid.rows.length === 0 ? (
            <p className="text-[13px] font-semibold text-[#93aaa3]">{empty}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-1 text-[13px]">
                <thead>
                  <tr>
                    <th className="min-w-56 text-start font-bold text-[#93aaa3]">{rowLabel}</th>
                    {grid.cars.map((car) => (
                      <th key={car} className="min-w-28 text-center font-bold text-[#557d78]">{car}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.rows.map((row) => (
                    <tr key={row.id}>
                      <th scope="row" className="text-start font-bold text-[#0f3d38]"><DirText>{row.label}</DirText></th>
                      {grid.cars.map((car) => {
                        const key = `${row.id}|${car}`;
                        const cell = grid.cells[key];
                        const state = cellState[key];
                        return (
                          <td key={car} className="align-top">
                            <input
                              type="number"
                              min={0}
                              dir="ltr"
                              // keyed by the stored price, so a reload or a save shows what is there
                              key={`${key}:${cell?.price ?? ""}`}
                              defaultValue={cell?.price ?? ""}
                              aria-label={t("data.model.grid.cell", { row: row.label, car })}
                              onBlur={(e) => void save(row.id, car, e.target.value)}
                              className={`${field} tv-tnum w-full text-center ${state === "failed" ? "border-[#c43d5a]" : ""}`}
                            />
                            <span className="block min-h-4 text-center text-[10.5px] font-semibold text-[#93aaa3]">
                              {state === "saving" ? "…" : state === "failed" ? t("data.model.grid.failed") : cell && cell.currency !== currency ? cell.currency : state === "saved" ? t("data.model.grid.saved") : ""}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}
      </section>
    </TraveliunShell>
  );
}
