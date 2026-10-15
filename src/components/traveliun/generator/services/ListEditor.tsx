"use client";

import { useMemo, useState } from "react";
import { Check, ListPlus, Plus, X } from "lucide-react";
import { DirText } from "@/components/DirText";
import type { TermLibraryItem } from "@/lib/offer/draft-types";
import type { TranslationKey } from "@/lib/i18n";
import { useTraveliunUI } from "../../TraveliunUIProvider";
import { addButtonClass, fieldClass } from "../stage-props";

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
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#e4f6ef]">
        <Check className="size-3 text-[#0f7a52]" />
      </span>
    );
  }
  if (variant === "excludes") {
    return (
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#fdeeee]">
        <X className="size-3 text-[#c43d3d]" />
      </span>
    );
  }
  return (
    <span className="tv-tnum flex size-5 shrink-0 items-center justify-center rounded-full bg-[#eef4f1] text-[10.5px] font-bold text-[#185045]">
      <DirText dir="ltr">{index + 1}</DirText>
    </span>
  );
}

/**
 * The two marks the agent works with: ✓ puts a line in, ✗ takes it out.
 * Squares of one size and place, so a list reads as a checklist rather than
 * a row of words to aim at.
 */
function MarkButton({ kind, label, onClick }: { kind: "add" | "remove"; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex size-7 shrink-0 items-center justify-center rounded-[6px] border-[1.5px] transition-colors ${
        kind === "add"
          ? "border-[#2aa87a] bg-white text-[#0f7a52] hover:bg-[#e9f7f0]"
          : "border-[#e6a3a3] bg-white text-[#c43d3d] hover:bg-[#fdeeee]"
      }`}
    >
      {kind === "add" ? <Check className="size-3.5" strokeWidth={3} /> : <X className="size-3.5" strokeWidth={3} />}
    </button>
  );
}

/** The ready lines not used yet, each with its ✓. Open by default — they are the fast path. */
function Picker({ label, entries, onPick }: { label: string; entries: string[]; onPick: (text: string) => void }) {
  const { t } = useTraveliunUI();
  const [open, setOpen] = useState(true);
  if (entries.length === 0) return null;
  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 text-[12px] font-bold text-[#185045] hover:underline"
      >
        <ListPlus className="size-4" />
        {label}
      </button>
      {open ? (
        <ul className="mt-1.5 max-h-[180px] divide-y divide-[#eef3f1] overflow-y-auto rounded-[10px] border border-[#e2ebe7] bg-white">
          {entries.map((text) => (
            <li key={text} className="flex items-center gap-2 px-2 py-1 hover:bg-[#f4f8f6]">
              <MarkButton kind="add" label={t("pg.addLine")} onClick={() => onPick(text)} />
              <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-[#41615b]">{text}</span>
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
    <div className="flex h-full flex-col rounded-[12px] border border-[#e2ebe7] bg-[#f8fbf9] p-3">
      <h3 className="mb-2 text-[13px] font-extrabold text-[#185045]">{t(titleKey)}</h3>

      {items.length === 0 ? (
        <p className="mb-2 rounded-[10px] border border-dashed border-[#cfe0d9] px-3 py-3 text-center text-[12.5px] text-[#93aaa3]">
          {t("pg.docNoContent")}
        </p>
      ) : (
        <ul className="mb-2 divide-y divide-[#eef3f1] overflow-hidden rounded-[10px] border border-[#e2ebe7] bg-white">
          {items.map((item, index) => (
            <li key={index} className="flex items-center gap-2 px-2.5 py-1.5">
              <Bullet variant={variant} index={index} />
              <span className="min-w-0 flex-1 break-words text-[13px] leading-snug text-[#185045]">{item}</span>
              <MarkButton kind="remove" label={t("pg.removeRow")} onClick={() => removeItem(index)} />
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
