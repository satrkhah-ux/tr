"use client";

import { useEffect, useMemo, useState } from "react";
import { Lock, Plus, Wand2 } from "lucide-react";
import { DirText } from "@/components/DirText";
import { EmptyState } from "@/components/ui/EmptyState";
import { getRates } from "@/lib/data/rates-actions";
import { computeOfferPricing, type CurrencyRates } from "@/lib/offer/pricing";
import { CURRENCIES, type DraftPricingItem } from "@/lib/offer/draft-types";
import type { PricingItemType } from "@/lib/types";
import type { TranslationKey } from "@/lib/i18n";
import { useRole } from "@/lib/roles/RoleContext";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import {
  addButtonClass,
  fieldClass,
  labelClass,
  removeButtonClass,
  sectionClass,
  type StageFormProps,
} from "../stage-props";

const ITEM_TYPES: PricingItemType[] = ["hotel", "flight", "visa", "service", "transport", "other"];
const ITEM_TYPE_KEYS: Record<PricingItemType, TranslationKey> = {
  hotel: "pg.item.hotel",
  flight: "pg.item.flight",
  visa: "pg.item.visa",
  service: "pg.item.service",
  transport: "pg.item.transport",
  other: "pg.item.other",
};

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

/**
 * Stage 9 — dual pricing (INTERNAL). Gated twice:
 * - pricing.view  → may open this stage at all (rail also hides it).
 * - pricing.internal → may see buy price / profit / margin columns.
 * Buy-side data never reaches the client document regardless (OfferDocument
 * renders sell-side only; ClientOfferDTO strips it structurally).
 */
export function PricingStage({ data, patch }: StageFormProps) {
  const { t } = useTraveliunUI();
  const { can } = useRole();
  const canView = can("pricing.view");
  const canInternal = can("pricing.internal");

  const [rates, setRates] = useState<CurrencyRates>({ SAR: 1 });
  useEffect(() => {
    let active = true;
    getRates().then((result) => {
      if (active) setRates(result.sarPer);
    });
    return () => {
      active = false;
    };
  }, []);

  const pricing = data.pricing;
  const summary = useMemo(
    () =>
      computeOfferPricing(
        pricing.items.map((item) => ({
          item_type: item.item_type,
          description: item.description,
          quantity: item.quantity,
          buy_price: item.buy_price,
          buy_currency: item.buy_currency || null,
          sell_price: item.sell_price,
          sell_currency: item.sell_currency || null,
        })),
        rates,
        "SAR",
      ),
    [pricing.items, rates],
  );

  if (!canView) {
    return (
      <section className={sectionClass}>
        <EmptyState icon={Lock} title={t("pg.noPricingAccess")} description="" />
      </section>
    );
  }

  function setItems(items: DraftPricingItem[]) {
    patch({ pricing: { ...pricing, items } });
  }

  function updateItem(index: number, slice: Partial<DraftPricingItem>) {
    setItems(pricing.items.map((item, i) => (i === index ? { ...item, ...slice } : item)));
  }

  function addItem(seed?: Partial<DraftPricingItem>) {
    setItems([
      ...pricing.items,
      {
        item_type: "other",
        description: "",
        quantity: 1,
        buy_price: null,
        buy_currency: pricing.display_currency,
        sell_price: null,
        sell_currency: pricing.display_currency,
        ...seed,
      },
    ]);
  }

  /** Seed one line per hotel / flight leg / transfer / visa already in the draft. */
  function suggestItems() {
    const existing = new Set(pricing.items.map((item) => item.description));
    const suggestions: DraftPricingItem[] = [
      ...data.hotels.map((h) => ({
        item_type: "hotel" as const,
        description: `${h.city_name} — ${h.hotel_name || t("pg.hotel")}`,
        quantity: h.rooms_count > 0 ? h.rooms_count : 1,
      })),
      ...data.flights.map((f) => ({
        item_type: "flight" as const,
        description: `${f.airline || t("pg.airline")} ${f.flight_no}`.trim(),
        quantity: 1,
      })),
      ...data.transport.map((tr) => ({
        item_type: "transport" as const,
        description: `${tr.from_place} ← ${tr.to_place}`,
        quantity: 1,
      })),
      ...data.visas.map((v) => ({
        item_type: "visa" as const,
        description: v.visa_type || v.country,
        quantity: v.count > 0 ? v.count : 1,
      })),
    ]
      .filter((s) => s.description.trim() !== "" && !existing.has(s.description))
      .map((s) => ({
        ...s,
        buy_price: null,
        buy_currency: pricing.display_currency,
        sell_price: null,
        sell_currency: pricing.display_currency,
      }));
    if (suggestions.length > 0) setItems([...pricing.items, ...suggestions]);
  }

  const th = "px-2 py-2.5 text-[11px] font-bold text-white whitespace-nowrap";
  const tdField = `${fieldClass} h-9 rounded-[8px] px-2 text-[12.5px]`;

  return (
    <div className="space-y-4">
      <section className={sectionClass}>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-extrabold text-[#003c3a]">{t("pg.pricingTitle")}</h2>
          <div className="flex gap-2">
            <button type="button" onClick={suggestItems} className={addButtonClass}>
              <Wand2 className="size-4" />
              {t("pg.suggestItems")}
            </button>
            <button type="button" onClick={() => addItem()} className={addButtonClass}>
              <Plus className="size-4" />
              {t("pg.addPricingItem")}
            </button>
          </div>
        </div>
        {canInternal ? (
          <p className="mb-4 rounded-[10px] border border-[#f2e2b4] bg-[#fff8e8] px-4 py-2.5 text-[12px] font-bold text-[#a86a10]">
            {t("pg.pricingNote")}
          </p>
        ) : null}

        <div className="overflow-x-auto">
          <table className="min-w-[760px] w-full border-collapse text-start text-sm">
            <thead>
              <tr className="bg-[#185045]">
                <th className={th}>{t("pg.itemType")}</th>
                <th className={`${th} w-full`}>{t("pg.desc")}</th>
                <th className={th}>{t("pg.qty")}</th>
                {canInternal ? <th className={th}>{t("pg.buyPrice")}</th> : null}
                <th className={th}>{t("pg.sellPrice")}</th>
                <th className={th}>{t("pg.currencyCol")}</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {pricing.items.map((item, index) => (
                <tr key={index} className="border-b border-[#eef2f0] align-middle">
                  <td className="px-2 py-2">
                    <select
                      value={item.item_type}
                      onChange={(e) => updateItem(index, { item_type: e.target.value as PricingItemType })}
                      className={tdField}
                    >
                      {ITEM_TYPES.map((type) => (
                        <option key={type} value={type}>{t(ITEM_TYPE_KEYS[type])}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <input value={item.description} onChange={(e) => updateItem(index, { description: e.target.value })} className={tdField} />
                  </td>
                  <td className="px-2 py-2 w-[72px]">
                    <input
                      type="number"
                      min={1}
                      dir="ltr"
                      value={item.quantity}
                      onChange={(e) => updateItem(index, { quantity: Math.max(Number(e.target.value) || 1, 1) })}
                      className={`${tdField} tv-tnum w-[64px] text-center`}
                    />
                  </td>
                  {canInternal ? (
                    <td className="px-2 py-2 w-[108px]">
                      <input
                        type="number"
                        min={0}
                        dir="ltr"
                        value={item.buy_price ?? ""}
                        onChange={(e) => updateItem(index, { buy_price: e.target.value === "" ? null : Number(e.target.value) })}
                        className={`${tdField} tv-tnum w-[100px] text-center`}
                      />
                    </td>
                  ) : null}
                  <td className="px-2 py-2 w-[108px]">
                    <input
                      type="number"
                      min={0}
                      dir="ltr"
                      value={item.sell_price ?? ""}
                      onChange={(e) => updateItem(index, { sell_price: e.target.value === "" ? null : Number(e.target.value) })}
                      className={`${tdField} tv-tnum w-[100px] text-center`}
                    />
                  </td>
                  <td className="px-2 py-2 w-[92px]">
                    <select
                      value={item.sell_currency}
                      onChange={(e) => updateItem(index, { sell_currency: e.target.value, buy_currency: e.target.value })}
                      className={tdField}
                    >
                      {CURRENCIES.map((code) => (
                        <option key={code} value={code}>{code}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <button type="button" onClick={() => setItems(pricing.items.filter((_, i) => i !== index))} className={removeButtonClass}>
                      {t("pg.removeRow")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {summary.missing_rates.length > 0 ? (
          <p className="mt-3 rounded-[10px] border border-[#f2e2b4] bg-[#fff8e8] px-4 py-2 text-[12px] font-bold text-[#a86a10]">
            {t("pg.missingRatesWarn", { codes: summary.missing_rates.join(", ") })}
          </p>
        ) : null}
      </section>

      {/* totals */}
      <section className={sectionClass}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {canInternal ? (
            <Total label={t("pg.totalBuy")} value={`${formatMoney(summary.total_buy)} SAR`} tone="muted" />
          ) : null}
          <Total label={t("pg.totalSell")} value={`${formatMoney(summary.total_sell)} SAR`} tone="brand" />
          {canInternal ? <Total label={t("pg.profitCol")} value={`${formatMoney(summary.profit)} SAR`} tone="good" /> : null}
          {canInternal ? (
            <Total label={t("pg.marginCol")} value={summary.margin_pct != null ? `${summary.margin_pct}%` : "—"} tone="good" />
          ) : null}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className={labelClass}>
            {t("pg.displayCurrency")}
            <select
              value={pricing.display_currency}
              onChange={(e) => patch({ pricing: { ...pricing, display_currency: e.target.value } })}
              className={fieldClass}
            >
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>{code}</option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            {t("pg.finalTotal")}
            <input
              type="number"
              min={0}
              dir="ltr"
              value={pricing.final_total ?? ""}
              onChange={(e) => patch({ pricing: { ...pricing, final_total: e.target.value === "" ? null : Number(e.target.value) } })}
              className={`${fieldClass} tv-tnum text-center`}
              placeholder={formatMoney(summary.total_sell)}
            />
          </label>
        </div>
      </section>
    </div>
  );
}

function Total({ label, value, tone }: { label: string; value: string; tone: "brand" | "good" | "muted" }) {
  const toneClass = tone === "brand" ? "text-[#185045]" : tone === "good" ? "text-[#0f7a52]" : "text-[#557d78]";
  return (
    <div className="rounded-[12px] bg-[#f4f8f6] px-4 py-3">
      <p className="text-[11px] font-bold text-[#93aaa3]">{label}</p>
      <p className={`tv-tnum mt-1 text-[17px] font-extrabold ${toneClass}`}>
        <DirText dir="ltr">{value}</DirText>
      </p>
    </div>
  );
}
