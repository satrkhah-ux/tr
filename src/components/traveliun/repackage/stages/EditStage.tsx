"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeftRight, CheckCircle2, Plus, Sparkles, Trash2, TrendingUp } from "lucide-react";
import { DirText } from "@/components/DirText";
import { suggestSellPrice } from "@/lib/data/repackage";
import {
  DEFAULT_EXCLUDES,
  DEFAULT_INCLUDES,
  DEFAULT_TERMS,
  stageHref,
  type ExtractedPackage,
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

  const profit = data.final_total != null && pkg.supplier_total != null ? Number((data.final_total - pkg.supplier_total).toFixed(2)) : null;
  const margin = profit != null && data.final_total ? Number(((profit / data.final_total) * 100).toFixed(1)) : null;

  // before→after diff
  const added = (after: string[], base: string[]) => after.filter((x) => !base.includes(x));
  const removed = (after: string[], base: string[]) => base.filter((x) => !after.includes(x));
  const incAdded = before ? added(pkg.includes, before.includes) : [];
  const incRemoved = before ? removed(pkg.includes, before.includes) : [];
  const termsAdded = before ? added(pkg.terms, before.terms) : [];
  const priceChanged = before && before.supplier_total !== data.final_total;

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

      {/* before → after diff */}
      <div className={`${sectionClass} border-[#cfe3db] bg-[#f6faf8]`}>
        <p className="mb-2 flex items-center gap-2 text-[13px] font-extrabold text-[#0f3d38]"><ArrowLeftRight className="size-4" />{t("rp.diff.title")}</p>
        {!priceChanged && incAdded.length === 0 && incRemoved.length === 0 && termsAdded.length === 0 ? (
          <p className="text-[12.5px] text-[#557d78]">{t("rp.diff.noChanges")}</p>
        ) : (
          <ul className="space-y-1.5 text-[12.5px] font-bold text-[#0f3d38]">
            {priceChanged ? (
              <li className="flex items-center gap-2">
                <span className="text-[#557d78]">{t("rp.diff.price")}:</span>
                <DirText dir="ltr"><span className="tv-tnum text-[#a86a10]">{before?.supplier_total ?? "—"}</span></DirText>
                <ArrowLeftRight className="size-3 text-[#93aaa3]" />
                <DirText dir="ltr"><span className="tv-tnum text-[#0f7a52]">{data.final_total ?? "—"} {data.final_currency}</span></DirText>
              </li>
            ) : null}
            {incAdded.map((x, i) => <li key={`a${i}`} className="text-[#0f7a52]">＋ {t("rp.diff.added")}: {x}</li>)}
            {incRemoved.map((x, i) => <li key={`r${i}`} className="text-[#c22850]">－ {t("rp.diff.removed")}: {x}</li>)}
            {termsAdded.map((x, i) => <li key={`t${i}`} className="text-[#185045]">＋ {t("rp.diff.termAdded")}: {x}</li>)}
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
