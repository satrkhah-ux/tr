"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { suggestPricingForDraft } from "@/lib/data/pricing-suggest";
import { mergeSuggestions } from "@/lib/offer/pricing-suggest";
import { Loader2, Lock, Plus, Wand2 } from "lucide-react";
import { DirText } from "@/components/DirText";
import { EmptyState } from "@/components/ui/EmptyState";
import { applyManualProfit, computeOfferPricing, rebase, type LinePricing } from "@/lib/offer/pricing";
import {
  currencyOptions,
  deriveCityDates,
  deriveHotelStays,
  pricingRefFor,
  type DraftPricingItem,
} from "@/lib/offer/draft-types";
import { itineraryStartDate } from "@/lib/offer/schedule";
import type { PricingItemType } from "@/lib/types";
import type { TranslationKey } from "@/lib/i18n";
import { useRole } from "@/lib/roles/RoleContext";
import { FieldIssue } from "../FieldIssue";
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
export function PricingStage({ draftId, data, patch, lookups }: StageFormProps) {
  const { t } = useTraveliunUI();
  const { can } = useRole();
  const canView = can("pricing.view");
  const canInternal = can("pricing.internal");

  const pricing = data.pricing;
  // Everything on this screen is in the currency the client is quoted in —
  // the same totals issuing computes (offerTotals), not a riyal sum labelled
  // with whatever the agent picked.
  const display = pricing.display_currency || "SAR";
  // An empty price field reads as "0" to a skimming eye; counting them is what
  // stops a half-priced offer going out as a cheap one. A buy with a profit rule
  // IS priced: its sell is derived, exactly as publishing derives it.
  const unpriced = pricing.items.filter(
    (item) => applyManualProfit(item.buy_price, item.sell_price, item.profit_pct, item.profit_amount) == null,
  ).length;
  const summary = useMemo(() => {
    const rates = rebase(lookups.sarPer ?? { SAR: 1 }, display);
    const computed = computeOfferPricing(
      pricing.items.map((item) => ({
        item_type: item.item_type,
        description: item.description,
        quantity: item.quantity,
        buy_price: item.buy_price,
        // no currency = the quote currency, exactly as issuing reads it
        buy_currency: item.buy_currency || display,
        sell_price: item.sell_price,
        sell_currency: item.sell_currency || display,
        // the same manual profit issuing applies — without it the screen
        // showed one total and the client was sent another
        profit_pct: item.profit_pct,
        profit_amount: item.profit_amount,
      })),
      rates ?? {},
      display,
    );
    // no rate for the quote currency itself: nothing but its own lines adds up
    return rates ? computed : { ...computed, missing_rates: [...new Set([display, ...computed.missing_rates])] };
  }, [pricing.items, lookups.sarPer, display]);
  const currencies = currencyOptions(lookups.countries, display);

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

  /**
   * Build the sheet from the agency's own price lists.
   *
   * Server-side: the lists are 879 transfer prices and the buy side of every
   * service, none of which belongs in a browser bundle — only the figures this
   * draft needs come back. A priced line is never touched, so a fare someone
   * negotiated an hour ago survives a re-run; a line with no price on either
   * side is filled, so a re-run can price what an earlier one left empty.
   */
  const [suggesting, setSuggesting] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);

  async function suggestItems() {
    setSuggesting(true);
    const result = await suggestPricingForDraft(draftId, { hotel: t("pg.hotel"), airline: t("pg.airline") });
    setSuggesting(false);
    if (!result.ok) return;
    const merged = mergeSuggestions(pricing.items, result.items);
    if (merged.added > 0 || merged.filled > 0) {
      setItems(merged.items);
      // Says how many arrived with a number, because the rest still need one
      // and an agent who assumes otherwise sends out a half-priced offer.
      setSuggestNote(t("pg.pricingSeeded", { added: String(merged.added), priced: String(merged.priced) }));
      window.setTimeout(() => setSuggestNote(null), 6000);
    }
  }

  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || pricing.items.length > 0) return;
    seeded.current = true;
    void suggestItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <section className={sectionClass}>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-extrabold text-[#003c3a]">{t("pg.pricingTitle")}</h2>
      <FieldIssue field="pricing" className="mb-3" />
          <div className="flex gap-2">
            <button type="button" onClick={() => void suggestItems()} disabled={suggesting} className={addButtonClass}>
              {suggesting ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
              {t("pg.suggestItems")}
            </button>
            <button type="button" onClick={() => addItem()} className={addButtonClass}>
              <Plus className="size-4" />
              {t("pg.addPricingItem")}
            </button>
          </div>
        </div>
        {suggestNote ? (
          <p className="mb-3 rounded-[10px] border border-[#bfe5d4] bg-[#e9f7f0] px-4 py-2.5 text-[12px] font-bold text-[#0f7a52]">
            {suggestNote}
          </p>
        ) : null}
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
                base={display}
                currencies={currencyOptions(lookups.countries, item.sell_currency, item.buy_currency)}
                canInternal={canInternal}
                nights={nightsFor(item)}
                onChange={(slice) => updateItem(index, slice)}
                onRemove={() => setItems(pricing.items.filter((_, i) => i !== index))}
              />
            ))}
          </div>
        )}

        {unpriced > 0 ? (
          <p className="mt-3 rounded-[10px] border border-[#f2e2b4] bg-[#fff8e8] px-4 py-2 text-[12px] font-bold text-[#a86a10]">
            {t("pg.unpricedCount", { count: String(unpriced) })}
          </p>
        ) : null}
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
            <Total label={t("pg.totalBuy")} value={`${formatMoney(summary.total_buy)} ${display}`} tone="muted" />
          ) : null}
          <Total label={t("pg.totalSell")} value={`${formatMoney(summary.total_sell)} ${display}`} tone="brand" />
          {canInternal ? <Total label={t("pg.profitCol")} value={`${formatMoney(summary.profit)} ${display}`} tone="good" /> : null}
          {canInternal ? (
            <Total label={t("pg.marginCol")} value={summary.margin_pct != null ? `${summary.margin_pct}%` : "—"} tone="good" />
          ) : null}
        </div>
        {/* Which rates the totals rest on. The fallback table is a dated copy —
            fine to sketch with, worth a second look before quoting. */}
        {lookups.ratesSource === "fallback" ? (
          <p className="mt-3 rounded-[10px] border border-[#f2e2b4] bg-[#fff8e8] px-4 py-2 text-[12px] font-bold text-[#a86a10]">
            {t("pg.ratesFallback")}
          </p>
        ) : lookups.ratesDate ? (
          <p className="mt-3 text-[11.5px] font-bold text-[#93aaa3]">
            {t("pg.ratesLive", { date: lookups.ratesDate.slice(0, 10) })}
          </p>
        ) : null}
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className={labelClass}>
            {t("pg.displayCurrency")}
            <select
              value={display}
              // A typed final total was in the OLD currency; kept, 4,500 SAR
              // would go out as 4,500 USD.
              onChange={(e) => patch({ pricing: { ...pricing, display_currency: e.target.value, final_total: null } })}
              className={fieldClass}
            >
              {currencies.map((code) => (
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
  base,
  currencies,
  canInternal,
  nights,
  onChange,
  onRemove,
}: {
  item: DraftPricingItem;
  line: LinePricing | undefined;
  /** the quote currency the line's profit is stated in. */
  base: string;
  currencies: string[];
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
              placeholder="—"
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
            placeholder="—"
          />
        </label>
        <label className={cardLabelClass}>
          {t("pg.currencyCol")}
          <select
            value={item.sell_currency || base}
            // The buy follows only when it was in the same currency: a 20 USD
            // buy under a 120 SAR sell is two currencies on purpose.
            onChange={(e) =>
              onChange(
                !item.buy_currency || item.buy_currency === item.sell_currency
                  ? { sell_currency: e.target.value, buy_currency: e.target.value }
                  : { sell_currency: e.target.value },
              )
            }
            className={fieldClass}
          >
            {currencies.map((code) => (
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
              value={`${formatMoney(profit)} ${base}`}
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
