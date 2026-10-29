"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeftRight, CheckCircle2, Plane, Plus, Sparkles, Trash2, TrendingUp } from "lucide-react";
import { DirText } from "@/components/DirText";
import { suggestSellPrice } from "@/lib/data/repackage";
import {
  DEFAULT_EXCLUDES,
  DEFAULT_INCLUDES,
  DEFAULT_TERMS,
  addedFlights,
  additionLine,
  additionsTotal,
  clientTotal,
  printableAdditions,
  stageHref,
  type ExtractedFlight,
  type ExtractedPackage,
  type RepackageAddition,
} from "@/lib/repackage/repackage-types";
import { useRole } from "@/lib/roles/RoleContext";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { addButtonClass, fieldClass, labelClass, removeButtonClass, sectionClass } from "../stage-props";
import type { RepackageStageProps } from "../stage-props";
import { AUTO_ADVANCE_KEY } from "./ImportStage";

export function EditStage({ draftId, data, patch }: RepackageStageProps) {
  const router = useRouter();
  const { t } = useTraveliunUI();
  const { can } = useRole();
  const canInternal = can("pricing.internal");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestErr, setSuggestErr] = useState<string | null>(null);
  const [autoAdvanced, setAutoAdvanced] = useState(false);

  // One-line confirmation when the import jumped straight here (high confidence).
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(AUTO_ADVANCE_KEY) === draftId) {
        setAutoAdvanced(true);
        window.sessionStorage.removeItem(AUTO_ADVANCE_KEY);
      }
    } catch { /* ignore */ }
  }, [draftId]);

  const pkg = data.extracted;
  if (!pkg) {
    return <div className={sectionClass}><p className="text-[13px] text-[#557d78]">{t("rp.err.noFile")}</p></div>;
  }
  const before = data.before;

  const updatePkg = (partial: Partial<ExtractedPackage>) => patch({ extracted: { ...pkg, ...partial } });
  const setPrice = (v: number | null) => patch({ final_total: v, markup_applied: false });

  const applyMarkup = async () => {
    setSuggestErr(null);
    setSuggesting(true);
    try {
      const res = await suggestSellPrice(draftId);
      if (!res.ok) { setSuggestErr(t(res.error)); return; }
      patch({ final_total: res.sell, final_currency: pkg.supplier_currency, markup_applied: true });
    } finally {
      setSuggesting(false);
    }
  };

  // what the client pays: the package's price and the priced additions on top of it
  const total = clientTotal(data);
  const extras = additionsTotal(data);
  const profit = total != null && pkg.supplier_total != null ? Number((total - pkg.supplier_total).toFixed(2)) : null;
  const margin = profit != null && total ? Number(((profit / total) * 100).toFixed(1)) : null;

  // before→after diff
  const added = (after: string[], base: string[]) => after.filter((x) => !base.includes(x));
  const removed = (after: string[], base: string[]) => base.filter((x) => !after.includes(x));
  const incAdded = before ? added(pkg.includes, before.includes) : [];
  const incRemoved = before ? removed(pkg.includes, before.includes) : [];
  const termsAdded = before ? added(pkg.terms, before.terms) : [];
  const priceChanged = before && before.supplier_total !== total;
  // what the agent added beside the supplier's file: lines (priced or not) and flights
  const addedLines = printableAdditions(data);
  const addedLegs = addedFlights(pkg);

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-extrabold text-[#0f3d38]">{t("rp.edit.title")}</h2>
        <p className="mt-1 text-[13px] text-[#557d78]">{t("rp.edit.hint")}</p>
      </header>

      {autoAdvanced ? (
        <p className="flex items-center gap-2 rounded-[10px] border border-[#bfe5d4] bg-[#e9f7f0] px-3 py-2 text-[12.5px] font-bold text-[#0f7a52]">
          <CheckCircle2 className="size-4 shrink-0" />
          {t("rp.import.autoAdvanced")}
        </p>
      ) : null}

      {/* pricing */}
      <div className={sectionClass}>
        <p className="mb-3 text-[13px] font-extrabold text-[#0f3d38]">{t("rp.edit.priceSection")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {canInternal ? (
            <div className="rounded-[10px] bg-[#f6faf8] px-3 py-2 text-[13px]">
              <span className="text-[#557d78]">{t("rp.edit.supplierCost")}: </span>
              <DirText dir="ltr"><span className="tv-tnum font-extrabold text-[#0f3d38]">{pkg.supplier_total ?? "—"} {pkg.supplier_currency}</span></DirText>
            </div>
          ) : <span />}
          <label className={labelClass}>
            {t("rp.edit.yourPrice")}
            <div className="flex gap-2">
              <input type="number" min={0} className={fieldClass} value={data.final_total ?? ""} onChange={(e) => setPrice(e.target.value === "" ? null : Number(e.target.value))} />
              <input className={`${fieldClass} w-24`} value={data.final_currency} onChange={(e) => patch({ final_currency: e.target.value })} />
            </div>
          </label>
        </div>
        {extras > 0 ? (
          <p className="mt-2 text-[12.5px] font-bold text-[#185045]">
            {t("rp.add.totalLine", { extras: extras.toLocaleString("en-US"), total: (total ?? 0).toLocaleString("en-US"), currency: data.final_currency })}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={applyMarkup} disabled={suggesting} className={addButtonClass}>
            <Sparkles className="size-4" />{suggesting ? "…" : t("rp.edit.applyMarkup")}
          </button>
          {data.markup_applied ? <span className="text-[12px] font-bold text-[#0f7a52]">{t("rp.edit.markupApplied")}</span> : null}
          {canInternal && profit != null ? (
            <span className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-[#185045]">
              <TrendingUp className="size-4 text-[#0f7a52]" />
              {t("rp.edit.profit")}: <DirText dir="ltr"><span className="tv-tnum">{profit} {data.final_currency}</span></DirText>
              {margin != null ? <span className="text-[#557d78]">· {t("rp.edit.margin")} <DirText dir="ltr"><span className="tv-tnum">{margin}%</span></DirText></span> : null}
            </span>
          ) : null}
          {suggestErr ? <span className="text-[12px] font-bold text-[#c22850]">{suggestErr}</span> : null}
        </div>
      </div>

      {/* services + terms */}
      <div className={sectionClass}>
        <p className="mb-3 text-[13px] font-extrabold text-[#0f3d38]">{t("rp.edit.servicesSection")}</p>
        <div className="grid gap-4 lg:grid-cols-3">
          <ListEditor label={t("rp.edit.includes")} items={pkg.includes} presets={DEFAULT_INCLUDES} onChange={(includes) => updatePkg({ includes })} addLabel={t("rp.edit.add")} placeholder={t("rp.edit.addPlaceholder")} />
          <ListEditor label={t("rp.edit.excludes")} items={pkg.excludes} presets={DEFAULT_EXCLUDES} onChange={(excludes) => updatePkg({ excludes })} addLabel={t("rp.edit.add")} placeholder={t("rp.edit.addPlaceholder")} />
          <ListEditor label={t("rp.edit.terms")} items={pkg.terms} presets={DEFAULT_TERMS} onChange={(terms) => updatePkg({ terms })} addLabel={t("rp.edit.add")} placeholder={t("rp.edit.addPlaceholder")} />
        </div>
      </div>

      {/* additions — what the supplier's file did not hold */}
      <AdditionsEditor
        additions={data.additions}
        currency={data.final_currency}
        flights={pkg.flights}
        onAdditions={(additions) => patch({ additions })}
        onFlights={(flights) => updatePkg({ flights })}
      />

      {/* before → after diff */}
      <div className={`${sectionClass} border-[#cfe3db] bg-[#f6faf8]`}>
        <p className="mb-2 flex items-center gap-2 text-[13px] font-extrabold text-[#0f3d38]"><ArrowLeftRight className="size-4" />{t("rp.diff.title")}</p>
        {!priceChanged && incAdded.length === 0 && incRemoved.length === 0 && termsAdded.length === 0 && addedLines.length === 0 && addedLegs.length === 0 ? (
          <p className="text-[12.5px] text-[#557d78]">{t("rp.diff.noChanges")}</p>
        ) : (
          <ul className="space-y-1.5 text-[12.5px] font-bold text-[#0f3d38]">
            {priceChanged ? (
              <li className="flex items-center gap-2">
                <span className="text-[#557d78]">{t("rp.diff.price")}:</span>
                <DirText dir="ltr"><span className="tv-tnum text-[#a86a10]">{before?.supplier_total ?? "—"}</span></DirText>
                <ArrowLeftRight className="size-3 text-[#93aaa3]" />
                <DirText dir="ltr"><span className="tv-tnum text-[#0f7a52]">{total ?? "—"} {data.final_currency}</span></DirText>
              </li>
            ) : null}
            {incAdded.map((x, i) => <li key={`a${i}`} className="text-[#0f7a52]">＋ {t("rp.diff.added")}: {x}</li>)}
            {incRemoved.map((x, i) => <li key={`r${i}`} className="text-[#c22850]">－ {t("rp.diff.removed")}: {x}</li>)}
            {termsAdded.map((x, i) => <li key={`t${i}`} className="text-[#185045]">＋ {t("rp.diff.termAdded")}: {x}</li>)}
            {addedLines.map((a) => (
              <li key={a.id} className="text-[#0f7a52]">
                ＋ {t("rp.diff.addition")}: {additionLine(a)}
                {a.sell_price != null ? <DirText dir="ltr"> <span className="tv-tnum">(+{a.sell_price.toLocaleString("en-US")} {data.final_currency})</span></DirText> : null}
              </li>
            ))}
            {addedLegs.map((f, i) => (
              <li key={`f${i}`} className="text-[#0f7a52]">＋ {t("rp.diff.flight")}: {flightLabel(f)}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex justify-end">
        <button type="button" onClick={() => router.push(stageHref(draftId, "preview"))} className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-[#185045] px-5 text-sm font-bold text-white transition-colors hover:bg-[#0f4439]">
          {t("rp.stage.preview")}
        </button>
      </div>
    </div>
  );
}

function ListEditor({ label, items, presets, onChange, addLabel, placeholder }: { label: string; items: string[]; presets: string[]; onChange: (items: string[]) => void; addLabel: string; placeholder: string }) {
  const [draft, setDraft] = useState("");
  const add = (value: string) => {
    const v = value.trim();
    if (v && !items.includes(v)) onChange([...items, v]);
  };
  const remaining = presets.filter((p) => !items.includes(p));
  return (
    <div>
      <p className="mb-1.5 text-[12px] font-bold text-[#185045]">{label}</p>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-2 rounded-[8px] bg-white px-2.5 py-1.5 text-[12.5px] text-[#0f3d38] ring-1 ring-[#e2ebe7]">
            <span className="flex-1">{item}</span>
            <button type="button" className={removeButtonClass} onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 className="size-3.5" /></button>
          </li>
        ))}
      </ul>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); add(draft); setDraft(""); }}>
        <input className={fieldClass} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} />
        <button type="submit" className={addButtonClass}><Plus className="size-4" />{addLabel}</button>
      </form>
      {remaining.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {remaining.map((p) => (
            <button key={p} type="button" onClick={() => add(p)} className="rounded-full border border-dashed border-[#b7d0c7] px-2.5 py-1 text-[11.5px] font-bold text-[#185045] hover:bg-[#f0f7f4]">＋ {p}</button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** «SV123 RUH → TBS · 2026-10-19» — one flight line as the diff and the list print it. */
function flightLabel(f: ExtractedFlight): string {
  const route = [f.from_airport, f.to_airport].filter(Boolean).join(" → ");
  const day = f.departure_at ? f.departure_at.slice(0, 10) : "";
  return [[f.airline, f.flight_no].filter(Boolean).join(" "), route, day].filter(Boolean).join(" · ") || "—";
}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `add-${Date.now()}`);

/**
 * «إضافات» — what the supplier's file did not hold, typed by the agent: a line
 * (title, a short detail, optionally a price the client pays on top) and flights.
 * Lines close the client's «يشمل» list; a price adds to the client's total. SELL
 * only — there is no cost field here. A hotel night is not added here: nights
 * move the dates, the cities and the departure, which the review owns.
 */
function AdditionsEditor({
  additions,
  currency,
  flights,
  onAdditions,
  onFlights,
}: {
  additions: RepackageAddition[];
  currency: string;
  flights: ExtractedFlight[];
  onAdditions: (additions: RepackageAddition[]) => void;
  onFlights: (flights: ExtractedFlight[]) => void;
}) {
  const { t } = useTraveliunUI();
  const setLine = (id: string, partial: Partial<RepackageAddition>) => onAdditions(additions.map((a) => (a.id === id ? { ...a, ...partial } : a)));
  const setLeg = (index: number, partial: Partial<ExtractedFlight>) => onFlights(flights.map((f, i) => (i === index ? { ...f, ...partial } : f)));
  const mine = flights.map((f, index) => ({ f, index })).filter(({ f }) => f.added === true);
  return (
    <div className={sectionClass}>
      <p className="text-[13px] font-extrabold text-[#0f3d38]">{t("rp.add.title")}</p>
      <p className="mb-3 mt-0.5 text-[12px] text-[#557d78]">{t("rp.add.hint")}</p>

      <ul className="space-y-2">
        {additions.map((a) => (
          <li key={a.id} className="grid gap-2 rounded-[10px] bg-[#f8fbfa] p-2.5 ring-1 ring-[#e2ebe7] md:grid-cols-[1.2fr_1.6fr_9rem_auto]">
            <input className={fieldClass} value={a.title} placeholder={t("rp.add.itemTitle")} aria-label={t("rp.add.itemTitle")} onChange={(e) => setLine(a.id, { title: e.target.value })} />
            <input className={fieldClass} value={a.detail} placeholder={t("rp.add.itemDetail")} aria-label={t("rp.add.itemDetail")} onChange={(e) => setLine(a.id, { detail: e.target.value })} />
            <label className="flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                dir="ltr"
                className={`${fieldClass} tv-tnum`}
                value={a.sell_price ?? ""}
                placeholder={t("rp.add.itemPrice")}
                aria-label={t("rp.add.itemPrice")}
                onChange={(e) => setLine(a.id, { sell_price: e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0) })}
              />
              <span className="text-[11px] font-bold text-[#78948f]">{currency}</span>
            </label>
            <button type="button" className={removeButtonClass} aria-label={t("rp.delete")} onClick={() => onAdditions(additions.filter((x) => x.id !== a.id))}>
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className={`${addButtonClass} mt-2`} onClick={() => onAdditions([...additions, { id: newId(), title: "", detail: "", sell_price: null }])}>
        <Plus className="size-4" />
        {t("rp.add.addLine")}
      </button>

      <div className="mt-4 border-t border-[#eef3f1] pt-3">
        <p className="mb-2 flex items-center gap-1.5 text-[12px] font-bold text-[#185045]">
          <Plane className="size-3.5" />
          {t("rp.add.flights")}
        </p>
        <ul className="space-y-2">
          {mine.map(({ f, index }) => (
            <li key={index} className="grid gap-2 rounded-[10px] bg-[#f8fbfa] p-2.5 ring-1 ring-[#e2ebe7] md:grid-cols-[1fr_1fr_1fr_1fr_auto]">
              <input className={fieldClass} value={f.airline} placeholder={t("rp.add.airline")} aria-label={t("rp.add.airline")} onChange={(e) => setLeg(index, { airline: e.target.value })} />
              <input dir="ltr" className={`${fieldClass} tv-tnum`} value={f.flight_no} placeholder={t("rp.add.flightNo")} aria-label={t("rp.add.flightNo")} onChange={(e) => setLeg(index, { flight_no: e.target.value })} />
              <input dir="ltr" className={fieldClass} value={f.from_airport} placeholder={t("rp.add.from")} aria-label={t("rp.add.from")} onChange={(e) => setLeg(index, { from_airport: e.target.value })} />
              <input dir="ltr" className={fieldClass} value={f.to_airport} placeholder={t("rp.add.to")} aria-label={t("rp.add.to")} onChange={(e) => setLeg(index, { to_airport: e.target.value })} />
              <button type="button" className={removeButtonClass} aria-label={t("rp.delete")} onClick={() => onFlights(flights.filter((_, i) => i !== index))}>
                <Trash2 className="size-3.5" />
              </button>
              <label className="grid gap-1 text-[10.5px] font-bold text-[#557d78] md:col-span-2">
                {t("rp.add.departs")}
                <input type="datetime-local" dir="ltr" className={fieldClass} value={(f.departure_at ?? "").slice(0, 16)} onChange={(e) => setLeg(index, { departure_at: e.target.value || null })} />
              </label>
              <label className="grid gap-1 text-[10.5px] font-bold text-[#557d78] md:col-span-2">
                {t("rp.add.arrives")}
                <input type="datetime-local" dir="ltr" className={fieldClass} value={(f.arrival_at ?? "").slice(0, 16)} onChange={(e) => setLeg(index, { arrival_at: e.target.value || null })} />
              </label>
            </li>
          ))}
        </ul>
        <button
          type="button"
          className={`${addButtonClass} mt-2`}
          onClick={() => onFlights([...flights, { airline: "", flight_no: "", from_airport: "", to_airport: "", departure_at: null, arrival_at: null, added: true }])}
        >
          <Plus className="size-4" />
          {t("rp.add.addFlight")}
        </button>
        <p className="mt-2 text-[11.5px] font-semibold text-[#93aaa3]">{t("rp.add.nightsNote")}</p>
      </div>
    </div>
  );
}
