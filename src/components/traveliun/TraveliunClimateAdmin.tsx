"use client";

import { useCallback, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { getClimateNotesForCity, upsertClimateNote, type ClimateCity } from "@/lib/data/climate-actions";
import type { ClimateLevel } from "@/lib/types";
import type { TranslationKey } from "@/lib/i18n";
import { TraveliunShell } from "./TraveliunShell";
import { useTraveliunUI } from "./TraveliunUIProvider";

type Row = {
  avg_high_c: string;
  avg_low_c: string;
  rain_level: "" | ClimateLevel;
  humidity_level: "" | ClimateLevel;
  advice_ar: string;
  advice_en: string;
};

const EMPTY_ROW: Row = { avg_high_c: "", avg_low_c: "", rain_level: "", humidity_level: "", advice_ar: "", advice_en: "" };
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const LEVELS: ClimateLevel[] = ["low", "medium", "high"];
const monthKey = (m: number): TranslationKey => `month.${m}` as TranslationKey;

export function TraveliunClimateAdmin({ cities }: { cities: ClimateCity[] }) {
  const { t, dir } = useTraveliunUI();
  const [cityId, setCityId] = useState("");
  const [rows, setRows] = useState<Record<number, Row>>({});
  const [loading, setLoading] = useState(false);
  const [savingMonth, setSavingMonth] = useState<number | null>(null);
  const [savedMonth, setSavedMonth] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (id: string) => {
    setCityId(id);
    if (!id) {
      setRows({});
      return;
    }
    setLoading(true);
    setError(null);
    const notes = await getClimateNotesForCity(id);
    const next: Record<number, Row> = {};
    for (const m of MONTHS) next[m] = { ...EMPTY_ROW };
    for (const n of notes) {
      next[n.month] = {
        avg_high_c: n.avg_high_c != null ? String(n.avg_high_c) : "",
        avg_low_c: n.avg_low_c != null ? String(n.avg_low_c) : "",
        rain_level: n.rain_level ?? "",
        humidity_level: n.humidity_level ?? "",
        advice_ar: n.advice_ar ?? "",
        advice_en: n.advice_en ?? "",
      };
    }
    setRows(next);
    setLoading(false);
  }, []);

  function update(month: number, patch: Partial<Row>) {
    setRows((prev) => ({ ...prev, [month]: { ...(prev[month] ?? EMPTY_ROW), ...patch } }));
    setSavedMonth(null);
  }

  async function save(month: number) {
    if (!cityId) return;
    const r = rows[month] ?? EMPTY_ROW;
    setSavingMonth(month);
    setError(null);
    const res = await upsertClimateNote({
      city_id: cityId,
      month,
      avg_high_c: r.avg_high_c === "" ? null : Number(r.avg_high_c),
      avg_low_c: r.avg_low_c === "" ? null : Number(r.avg_low_c),
      rain_level: r.rain_level === "" ? null : r.rain_level,
      humidity_level: r.humidity_level === "" ? null : r.humidity_level,
      advice_ar: r.advice_ar.trim() || null,
      advice_en: r.advice_en.trim() || null,
    });
    setSavingMonth(null);
    if (!res.ok) {
      setError(t(res.error ?? "err.db"));
      return;
    }
    setSavedMonth(month);
  }

  const numField =
    "tv-tnum h-10 w-full rounded-[8px] border border-[#dbe6e1] bg-white px-2 text-center text-sm text-[#185045] outline-none focus:border-[#2aa87a]";
  const selField = "h-10 w-full rounded-[8px] border border-[#dbe6e1] bg-white px-2 text-sm text-[#185045] outline-none focus:border-[#2aa87a]";
  const textField = "h-10 w-full rounded-[8px] border border-[#dbe6e1] bg-white px-3 text-sm text-[#185045] outline-none focus:border-[#2aa87a]";

  return (
    <TraveliunShell title="nav.climate">
      <div className="tv-fade-up space-y-4" dir={dir}>
        <section className="rounded-2xl border border-[#e2ebe7] bg-white p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
          <h1 className="text-lg font-extrabold text-[#003c3a]">{t("climate.title")}</h1>
          <p className="mt-1 text-[13px] font-medium text-[#6f8f88]">{t("climate.subtitle")}</p>
          <div className="mt-4 max-w-[420px]">
            <label className="grid gap-2 text-[13px] font-bold text-[#185045]">
              {t("climate.selectCity")}
              <select value={cityId} onChange={(e) => void load(e.target.value)} className={selField}>
                <option value="">{t("climate.selectCity")}</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.country ? `${c.name} — ${c.country}` : c.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error ? (
            <p role="alert" className="mt-3 rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] px-4 py-2.5 text-[13px] font-semibold text-[#c22850]">
              {error}
            </p>
          ) : null}
        </section>

        {!cityId ? (
          <section className="rounded-2xl border border-dashed border-[#cfe0d9] bg-white p-10 text-center text-sm font-semibold text-[#93aaa3]">
            {t("climate.pickCityFirst")}
          </section>
        ) : (
          <section className="overflow-x-auto rounded-2xl border border-[#e2ebe7] bg-white p-[15px] shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
            <table className="min-w-[980px] border-collapse text-start text-sm">
              <thead>
                <tr className="bg-[#185045] text-white">
                  <th className="px-3 py-3 text-[11.5px] font-bold">{t("climate.month")}</th>
                  <th className="px-3 py-3 text-[11.5px] font-bold">{t("climate.avgHigh")}</th>
                  <th className="px-3 py-3 text-[11.5px] font-bold">{t("climate.avgLow")}</th>
                  <th className="px-3 py-3 text-[11.5px] font-bold">{t("climate.rain")}</th>
                  <th className="px-3 py-3 text-[11.5px] font-bold">{t("climate.humidity")}</th>
                  <th className="px-3 py-3 text-[11.5px] font-bold">{t("climate.adviceAr")}</th>
                  <th className="px-3 py-3 text-[11.5px] font-bold">{t("climate.adviceEn")}</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {loading
                  ? MONTHS.map((m) => (
                      <tr key={m} className="border-b border-[#eef2f0]">
                        <td className="px-3 py-3" colSpan={8}>
                          <div className="tv-shimmer h-9 rounded-md" />
                        </td>
                      </tr>
                    ))
                  : MONTHS.map((m) => {
                      const r = rows[m] ?? EMPTY_ROW;
                      return (
                        <tr key={m} className="border-b border-[#eef2f0] align-middle">
                          <td className="px-3 py-2.5 font-bold text-[#185045]">{t(monthKey(m))}</td>
                          <td className="px-2 py-2.5 w-[92px]">
                            <input type="number" dir="ltr" value={r.avg_high_c} onChange={(e) => update(m, { avg_high_c: e.target.value })} className={numField} />
                          </td>
                          <td className="px-2 py-2.5 w-[92px]">
                            <input type="number" dir="ltr" value={r.avg_low_c} onChange={(e) => update(m, { avg_low_c: e.target.value })} className={numField} />
                          </td>
                          <td className="px-2 py-2.5 w-[120px]">
                            <select value={r.rain_level} onChange={(e) => update(m, { rain_level: e.target.value as "" | ClimateLevel })} className={selField}>
                              <option value="">{t("level.none")}</option>
                              {LEVELS.map((lv) => (
                                <option key={lv} value={lv}>{t(`level.${lv}` as TranslationKey)}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-2.5 w-[120px]">
                            <select value={r.humidity_level} onChange={(e) => update(m, { humidity_level: e.target.value as "" | ClimateLevel })} className={selField}>
                              <option value="">{t("level.none")}</option>
                              {LEVELS.map((lv) => (
                                <option key={lv} value={lv}>{t(`level.${lv}` as TranslationKey)}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-2.5 min-w-[200px]">
                            <input dir="rtl" value={r.advice_ar} onChange={(e) => update(m, { advice_ar: e.target.value })} className={textField} />
                          </td>
                          <td className="px-2 py-2.5 min-w-[200px]">
                            <input dir="ltr" value={r.advice_en} onChange={(e) => update(m, { advice_en: e.target.value })} className={`${textField} text-start`} />
                          </td>
                          <td className="px-2 py-2.5 w-[92px]">
                            <button
                              type="button"
                              onClick={() => save(m)}
                              disabled={savingMonth === m}
                              className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[8px] bg-[#185045] px-3 text-xs font-bold text-white transition-colors hover:bg-[#0f4439] disabled:opacity-70"
                            >
                              {savingMonth === m ? <Loader2 className="size-4 animate-spin" /> : savedMonth === m ? <Check className="size-4" /> : null}
                              {savedMonth === m ? t("climate.saved") : t("climate.saveRow")}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </TraveliunShell>
  );
}
