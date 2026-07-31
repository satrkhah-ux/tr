"use client";

import { useEffect, useMemo, useState } from "react";
import { Lock, Plus, Wand2 } from "lucide-react";
import { DirText } from "@/components/DirText";
import { EmptyState } from "@/components/ui/EmptyState";
import { getRates } from "@/lib/data/rates-actions";
import { computeOfferPricing, type CurrencyRates, type LinePricing } from "@/lib/offer/pricing";
import {
  CURRENCIES,
  deriveCityDates,
  deriveHotelStays,
  pricingRefFor,
  type DraftPricingItem,
} from "@/lib/offer/draft-types";
import { itineraryStartDate } from "@/lib/offer/schedule";
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

  /**
   * How many nights a hotel line covers — for «سعر الليلة».
   *
   * Matched by the stay id where the item has one, and by the old
   * «المدينة — الفندق» description otherwise, so items written before a city
   * could hold two hotels still find their stay.
   */
  const stays = deriveHotelStays(
    deriveCityDates(itineraryStartDate(data.trip, data.flights), data.cities),
    data.hotels,
  );
  function nightsFor(item: DraftPricingItem): number {
    if (item.item_type !== "hotel") return 0;
    const stay = stays.find(
      (s) => (item.ref ? pricingRefFor(s) === item.ref : `${s.city_name} — ${s.line.hotel_name}` === item.description),
    );
    return stay?.nights ?? 0;
  }

  /** Seed one line per hotel / flight leg / transfer / visa already in the draft. */
  function suggestItems() {
    const existing = new Set(pricing.items.map((item) => item.description));
    const suggestions: DraftPricingItem[] = [
      // One suggestion per STAY: two hotels in a city are two lines to price,
      // and suggesting one of them silently drops the other's cost.
      ...stays.map((s) => ({
        item_type: "hotel" as const,
        description: `${s.city_name} — ${s.line.hotel_name || t("pg.hotel")}`,
        ref: pricingRefFor(s),
        quantity: s.line.rooms_count > 0 ? s.line.rooms_count : 1,
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

        {/*
          One CARD per line, not a seven-column table.
          The table version had to live in the same column as a preview pane, so
          every numeric field collapsed to a few pixels and could not be typed
          into. Cards give each field a full-height input and a label of its own,
          and — more importantly — put each line's buy/sell/profit next to the
          numbers that produce it, which is the decision the agent is actually
          making on this screen.
        */}
        {pricing.items.length === 0 ? (
          <p className="rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-6 text-center text-sm text-[#93aaa3]">
            {t("pg.warn.noPricing")}
          </p>
        ) : (
          <div className="space-y-3">
            {pricing.items.map((item, index) => (
              <PricingCard
                key={index}
                item={item}
                line={summary.lines[index]}
                canInternal={canInternal}
                nights={nightsFor(item)}
                onChange={(slice) => updateItem(index, slice)}
                onRemove={() => setItems(pricing.items.filter((_, i) => i !== index))}
              />
            ))}
          </div>
        )}

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

const cardLabelClass = "grid gap-1.5 text-[11.5px] font-bold text-[#557d78]";

/**
 * One pricing line. Prices are PER UNIT; the strip underneath shows what the
 * quantity multiplies them into, so an agent typing 600 against qty 2 sees 1200
 * without doing the arithmetic — and sees the profit turn red the moment the
 * sell drops under the buy.
 */
function PricingCard({
  item,
  line,
  canInternal,
  nights,
  onChange,
  onRemove,
}: {
  item: DraftPricingItem;
  line: LinePricing | undefined;
  canInternal: boolean;
  /** nights this line covers, for hotel lines — 0 for everything else. */
  nights: number;
  onChange: (slice: Partial<DraftPricingItem>) => void;
  onRemove: () => void;
}) {
  const { t } = useTraveliunUI();
  const profit = line?.profit_base ?? null;
  const losing = profit != null && profit < 0;
  const manual = item.profit_pct != null || item.profit_amount != null;
  const perNight = nights > 0 && line?.total_sell != null ? line.total_sell / nights : null;

  return (
    <div className="rounded-[12px] border border-[#e2ebe7] bg-[#f8fbf9] p-3">
      <div className="grid gap-3 sm:grid-cols-[170px_minmax(0,1fr)_auto] sm:items-end">
        <label className={cardLabelClass}>
          {t("pg.itemType")}
          <select
            value={item.item_type}
            onChange={(e) => onChange({ item_type: e.target.value as PricingItemType })}
            className={fieldClass}
          >
            {ITEM_TYPES.map((type) => (
              <option key={type} value={type}>{t(ITEM_TYPE_KEYS[type])}</option>
            ))}
          </select>
        </label>
        <label className={cardLabelClass}>
          {t("pg.desc")}
          <input value={item.description} onChange={(e) => onChange({ description: e.target.value })} className={fieldClass} />
        </label>
        <button type="button" onClick={onRemove} className={`${removeButtonClass} h-11`}>
          {t("pg.removeRow")}
        </button>
      </div>

      <div className={`mt-3 grid gap-3 ${canInternal ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
        <label className={cardLabelClass}>
          {t("pg.qty")}
          <input
            type="number" min={1} dir="ltr"
            value={item.quantity}
            onChange={(e) => onChange({ quantity: Math.max(Number(e.target.value) || 1, 1) })}
            className={`${fieldClass} tv-tnum text-center`}
          />
        </label>
        {canInternal ? (
          <label className={cardLabelClass}>
            {t("pg.buyPrice")}
            <input
              type="number" min={0} dir="ltr"
              value={item.buy_price ?? ""}
              onChange={(e) => onChange({ buy_price: e.target.value === "" ? null : Number(e.target.value) })}
              className={`${fieldClass} tv-tnum text-center`}
              placeholder="0"
            />
          </label>
        ) : null}
        <label className={cardLabelClass}>
          {t("pg.sellPrice")}
          <input
            type="number" min={0} dir="ltr"
            value={item.sell_price ?? ""}
            onChange={(e) =>
              // Typing a sell price directly is an answer, so it clears any
              // profit rule — otherwise the rule would immediately overwrite it
              // and the number the agent typed would vanish as they looked at it.
              onChange({
                sell_price: e.target.value === "" ? null : Number(e.target.value),
                profit_pct: null,
                profit_amount: null,
              })
            }
            disabled={manual}
            className={`${fieldClass} tv-tnum text-center disabled:bg-[#f1f5f3] disabled:text-[#93aaa3]`}
            placeholder="0"
          />
        </label>
        <label className={cardLabelClass}>
          {t("pg.currencyCol")}
          <select
            value={item.sell_currency}
            onChange={(e) => onChange({ sell_currency: e.target.value, buy_currency: e.target.value })}
            className={fieldClass}
          >
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>{code}</option>
            ))}
          </select>
        </label>
      </div>

      {/* Profit on top of the buy price — the fast way to price a line without
          computing the sell by hand. Internal only: it is stated as margin. */}
      {canInternal && item.buy_price != null ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className={cardLabelClass}>
            نسبة ربح ٪
            <input
              type="number" min={0} dir="ltr"
              value={item.profit_pct ?? ""}
              onChange={(e) =>
                onChange({
                  profit_pct: e.target.value === "" ? null : Number(e.target.value),
                  profit_amount: null,
                })
              }
              className={`${fieldClass} tv-tnum h-9 w-24 text-center`}
              placeholder="—"
            />
          </label>
          <label className={cardLabelClass}>
            أو مبلغ ربح
            <input
              type="number" min={0} dir="ltr"
              value={item.profit_amount ?? ""}
              onChange={(e) =>
                onChange({
                  profit_amount: e.target.value === "" ? null : Number(e.target.value),
                  profit_pct: null,
                })
              }
              className={`${fieldClass} tv-tnum h-9 w-28 text-center`}
              placeholder="—"
            />
          </label>
          {manual ? (
            <button
              type="button"
              onClick={() => onChange({ profit_pct: null, profit_amount: null })}
              className="h-9 rounded-[9px] border border-[#dbe6e1] px-2.5 text-[11.5px] font-bold text-[#557d78] hover:bg-[#f4f8f6]"
            >
              إلغاء الربح اليدوي
            </button>
          ) : null}
        </div>
      ) : null}

      {/* what the quantity multiplies those unit prices into */}
      {line ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[#e7f0ec] pt-2.5 text-[11.5px] font-bold">
          {/* The number a hotel is judged by. Shown for hotel lines only —
              a per-night visa fee would be meaningless. */}
          {perNight != null ? (
            <LineFigure label="سعر الليلة" value={`${formatMoney(perNight)} ${line.sell_currency ?? ""}`} tone="brand" />
          ) : null}
          {canInternal && line.total_buy != null ? (
            <LineFigure label={t("pg.totalBuy")} value={`${formatMoney(line.total_buy)} ${line.buy_currency ?? ""}`} tone="muted" />
          ) : null}
          {line.total_sell != null ? (
            <LineFigure label={t("pg.totalSell")} value={`${formatMoney(line.total_sell)} ${line.sell_currency ?? ""}`} tone="brand" />
          ) : null}
          {canInternal && profit != null ? (
            <LineFigure
              label={t("pg.profitCol")}
              value={`${formatMoney(profit)} SAR`}
              tone={losing ? "bad" : "good"}
            />
          ) : null}
          {canInternal && line.margin_pct != null ? (
            <LineFigure label={t("pg.marginCol")} value={`${line.margin_pct}%`} tone={losing ? "bad" : "good"} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function LineFigure({ label, value, tone }: { label: string; value: string; tone: "brand" | "good" | "bad" | "muted" }) {
  const toneClass =
    tone === "brand" ? "text-[#185045]" : tone === "good" ? "text-[#0f7a52]" : tone === "bad" ? "text-[#c22850]" : "text-[#93aaa3]";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-[#93aaa3]">{label}</span>
      <span className={`tv-tnum ${toneClass}`}>
        <DirText dir="ltr">{value}</DirText>
      </span>
    </span>
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
