"use client";

import { useMemo, useState } from "react";
import { Check, ListPlus, Plus, X } from "lucide-react";
import { DirText } from "@/components/DirText";
import type { TermLibraryItem } from "@/lib/offer/draft-types";
import type { TranslationKey } from "@/lib/i18n";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { addButtonClass, fieldClass, removeButtonClass } from "../stage-props";

/**
 * One editable string list — «يشمل», «لا يشمل» and «الشروط» are the same
 * widget over three lists, so it lives out here rather than being copied into
 * the stage that needed it second.
 */
export type ListVariant = "includes" | "excludes" | "terms";

type ListEditorProps = {
  titleKey: TranslationKey;
  variant: ListVariant;
  items: string[];
  /** the company's approved wording for this list (from the `terms` table). */
  library: TermLibraryItem[];
  /**
   * «خدمات الدولة» — the trip country's services from /services, a second
   * source for «يشمل». Added by their exact name, which is what «اقتراح
   * التسعير» looks the price up by.
   */
  countryServices?: string[];
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

/** A collapsible list of ready lines; picking one appends it. Hidden when empty. */
function Picker({ label, entries, onPick }: { label: string; entries: string[]; onPick: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  if (entries.length === 0) return null;
  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 text-[12px] font-bold text-[#185045] hover:underline"
      >
        <ListPlus className="size-4" />
        {label}
      </button>
      {open ? (
        <ul className="mt-2 max-h-[180px] space-y-1 overflow-y-auto rounded-[10px] border border-[#e2ebe7] bg-white p-2">
          {entries.map((text) => (
            <li key={text}>
              <button
                type="button"
                onClick={() => onPick(text)}
                className="w-full rounded-[8px] px-2 py-1.5 text-start text-[12.5px] text-[#41615b] hover:bg-[#f4f8f6]"
              >
                <Plus className="me-1 inline size-3.5 text-[#0f7a52]" />
                {text}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** One editable string list (includes / excludes / terms) with add + remove. */
export function ListEditor({ titleKey, variant, items, library, countryServices, onChange }: ListEditorProps) {
  const { t } = useTraveliunUI();
  const [value, setValue] = useState("");

  // ready lines the agent has not used yet — the only ones worth offering
  const unused = useMemo(
    // (a set: a country's line may repeat a global one word for word)
    () => [...new Set(library.map((entry) => entry.text))].filter((text) => !items.includes(text)),
    [library, items],
  );
  const unusedServices = useMemo(
    () => (countryServices ?? []).filter((name) => !items.includes(name)),
    [countryServices, items],
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

      <Picker
        label={t("pg.fromLibrary", { count: String(unused.length) })}
        entries={unused}
        onPick={(text) => onChange([...items, text])}
      />
      <Picker
        label={t("pg.countryServices", { count: String(unusedServices.length) })}
        entries={unusedServices}
        onPick={(text) => onChange([...items, text])}
      />

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
