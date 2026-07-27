"use client";

import { useMemo, useState } from "react";
import { Check, ListPlus, Plus, X } from "lucide-react";
import { DirText } from "@/components/DirText";
import type { DraftServices, TermLibraryItem } from "@/lib/offer/draft-types";
import type { TranslationKey } from "@/lib/i18n";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import {
  addButtonClass,
  fieldClass,
  removeButtonClass,
  sectionClass,
  type StageFormProps,
} from "../stage-props";

type ListVariant = "includes" | "excludes" | "terms";

type ListEditorProps = {
  titleKey: TranslationKey;
  variant: ListVariant;
  items: string[];
  /** the company's approved wording for this list (from the `terms` table). */
  library: TermLibraryItem[];
  onChange: (next: string[]) => void;
};

function Bullet({ variant, index }: { variant: ListVariant; index: number }) {
  if (variant === "includes") {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#e4f6ef]">
        <Check className="size-3.5 text-[#0f7a52]" />
      </span>
    );
  }
  if (variant === "excludes") {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#fdeeee]">
        <X className="size-3.5 text-[#c43d3d]" />
      </span>
    );
  }
  return (
    <span className="tv-tnum flex size-6 shrink-0 items-center justify-center rounded-full bg-[#eef4f1] text-[11px] font-bold text-[#185045]">
      <DirText dir="ltr">{index + 1}</DirText>
    </span>
  );
}

/** One editable string list (includes / excludes / terms) with add + remove. */
function ListEditor({ titleKey, variant, items, library, onChange }: ListEditorProps) {
  const { t } = useTraveliunUI();
  const [value, setValue] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  // approved lines the agent has not used yet — the only ones worth offering
  const unused = useMemo(
    () => library.filter((entry) => !items.includes(entry.text)),
    [library, items],
  );

  function addItem() {
    const trimmed = value.trim();
    if (!trimmed) return;
    onChange([...items, trimmed]);
    setValue("");
  }

  function removeItem(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  return (
    <div className="flex h-full flex-col rounded-[12px] border border-[#e2ebe7] bg-[#f8fbf9] p-4">
      <h3 className="mb-3 text-[13px] font-extrabold text-[#185045]">{t(titleKey)}</h3>

      {items.length === 0 ? (
        <p className="mb-3 rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-6 text-center text-sm text-[#93aaa3]">
          {t("pg.docNoContent")}
        </p>
      ) : (
        <ul className="mb-3 space-y-2">
          {items.map((item, index) => (
            <li
              key={index}
              className="flex items-center gap-2.5 rounded-[10px] border border-[#e2ebe7] bg-white px-3 py-2"
            >
              <Bullet variant={variant} index={index} />
              <span className="min-w-0 flex-1 break-words text-sm text-[#185045]">{item}</span>
              <button type="button" onClick={() => removeItem(index)} className={removeButtonClass}>
                {t("pg.removeRow")}
              </button>
            </li>
          ))}
        </ul>
      )}

      {unused.length > 0 ? (
        <div className="mb-3">
          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            className="inline-flex items-center gap-1.5 text-[12px] font-bold text-[#185045] hover:underline"
          >
            <ListPlus className="size-4" />
            {t("pg.fromLibrary", { count: String(unused.length) })}
          </button>
          {pickerOpen ? (
            <ul className="mt-2 max-h-[180px] space-y-1 overflow-y-auto rounded-[10px] border border-[#e2ebe7] bg-white p-2">
              {unused.map((entry) => (
                <li key={entry.text}>
                  <button
                    type="button"
                    onClick={() => onChange([...items, entry.text])}
                    className="w-full rounded-[8px] px-2 py-1.5 text-start text-[12.5px] text-[#41615b] hover:bg-[#f4f8f6]"
                  >
                    <Plus className="me-1 inline size-3.5 text-[#0f7a52]" />
                    {entry.text}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          addItem();
        }}
        className="mt-auto flex items-center gap-2"
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("pg.itemPlaceholder")}
          className={fieldClass}
        />
        <button type="submit" className={`${addButtonClass} shrink-0`}>
          <Plus className="size-4" />
          {t("pg.addItem")}
        </button>
      </form>
    </div>
  );
}

/**
 * Stage 7 — included / excluded services + terms. Edits ONLY data.services.
 *
 * The three lists mirror the company's approved wording, administered at
 * /offers/offer-includes, /offers/offer-not-includes and
 * /offers/terms-and-conditions: a new draft opens with the ticked rows already
 * in place, and «اختر من القائمة المعتمدة» adds any of the rest. Free text stays
 * available for the one-off line a particular offer needs.
 */
export function ServicesStage({ data, patch, lookups }: StageFormProps) {
  const { t } = useTraveliunUI();
  const services = data.services;
  const library = lookups.termLibrary;

  function update(slice: Partial<DraftServices>) {
    patch({ services: { ...services, ...slice } });
  }

  return (
    <section className={sectionClass}>
      <h2 className="mb-4 text-base font-extrabold text-[#003c3a]">{t("pg.servicesTitle")}</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <ListEditor
          titleKey="pg.includes"
          variant="includes"
          items={services.includes}
          library={library.includes}
          onChange={(next) => update({ includes: next })}
        />
        <ListEditor
          titleKey="pg.excludes"
          variant="excludes"
          items={services.excludes}
          library={library.excludes}
          onChange={(next) => update({ excludes: next })}
        />
        <div className="md:col-span-2">
          <ListEditor
            titleKey="pg.terms"
            variant="terms"
            items={services.terms}
            library={library.terms}
            onChange={(next) => update({ terms: next })}
          />
        </div>
      </div>
    </section>
  );
}
