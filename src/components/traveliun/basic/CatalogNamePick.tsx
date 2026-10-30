"use client";

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { addCatalogName, getMyCatalogAdditions } from "@/lib/data/catalog-additions";
import { suggestName, uniqueNames, type CatalogAddition } from "@/lib/catalog/additions";

/**
 * The additions an employee sees (everyone's approved, their own pending) —
 * loaded once per page and shared by every picker on it; an add refreshes it.
 */
let cache: Promise<CatalogAddition[]> | null = null;
const listeners = new Set<(rows: CatalogAddition[]) => void>();
const load = () => (cache ??= getMyCatalogAdditions().catch(() => []));
function refresh() {
  cache = null;
  void load().then((rows) => listeners.forEach((fn) => fn(rows)));
}

export function useCatalogAdditions(kind: "room" | "view"): string[] {
  const [rows, setRows] = useState<CatalogAddition[]>([]);
  useEffect(() => {
    let live = true;
    void load().then((r) => live && setRows(r));
    const fn = (r: CatalogAddition[]) => setRows(r);
    listeners.add(fn);
    return () => {
      live = false;
      listeners.delete(fn);
    };
  }, []);
  return rows.filter((r) => r.kind === kind).map((r) => r.name);
}

const OTHER = "__other__";

/**
 * «اكتب اسماً آخر»: the employee types; the spelling is checked as they type
 * (suggestName) — a known name is offered as «هل تقصد …؟» and taken with one
 * click, a new one is added as typed, on the employee's responsibility, and
 * goes to the data team. Nothing here ever blocks the programme.
 */
export function CatalogTextAdd({
  kind,
  known,
  onDone,
  onCancel,
  fieldClass,
  placeholder,
}: {
  kind: "room" | "view";
  known: string[];
  /** the confirmed name, and whether it is one the lists already hold */
  onDone: (name: string, isKnown: boolean) => void;
  onCancel: () => void;
  fieldClass: string;
  placeholder: string;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const hint = suggestName(kind, text, known);
  const addNew = async () => {
    const typed = text.trim();
    if (!typed) return;
    setBusy(true);
    const res = await addCatalogName(kind, typed, typed).catch(() => ({ ok: false, name: typed }));
    setBusy(false);
    refresh();
    // added or not (the review table may not be on yet), the employee's own name stands
    onDone(res.name || typed, false);
  };
  return (
    <span className="grid gap-1">
      <span className="flex gap-1">
        <input
          autoFocus
          type="text"
          dir="auto"
          value={text}
          maxLength={80}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
            if (e.key === "Enter") {
              e.preventDefault();
              if (hint.kind === "exact") onDone(hint.name, true);
              else if (hint.kind === "new") void addNew();
            }
          }}
          className={`${fieldClass} min-w-0 flex-1`}
        />
        <button type="button" onClick={onCancel} aria-label="إلغاء" title="إلغاء" className="rounded-[7px] px-1 text-tv-text-faint hover:text-[#c22850]">
          <X className="size-3.5" />
        </button>
      </span>
      {text.trim() ? (
        hint.kind === "new" ? (
          <button type="button" disabled={busy} onClick={() => void addNew()} className="inline-flex items-center gap-1 rounded-[8px] border border-dashed border-[#2aa87a] px-2 py-1 text-start text-[11.5px] font-bold text-[#0f7a52] disabled:opacity-60">
            <Check className="size-3.5" /> أضف «{text.trim()}» — يُرسل لقسم البيانات للمراجعة
          </button>
        ) : (
          <span className="flex flex-wrap items-center gap-1 text-[11.5px] font-bold text-[#185045]">
            {hint.kind === "close" ? <span className="text-tv-text-faint">هل تقصد:</span> : null}
            <button type="button" onClick={() => onDone(hint.name, true)} className="rounded-[8px] bg-[#e3efe9] px-2 py-1 text-[#0f7a52]">
              {hint.name}
            </button>
            {hint.kind === "close" ? (
              <button type="button" disabled={busy} onClick={() => void addNew()} className="rounded-[8px] px-2 py-1 text-[#557d78] underline disabled:opacity-60">
                لا، أضف «{text.trim()}»
              </button>
            ) : null}
          </span>
        )
      ) : null}
    </span>
  );
}

/** «الإطلالة»: the catalogue's views and the added ones, or a new one typed. */
export function RoomViewPick({
  value,
  catalogue,
  onChange,
  fieldClass,
  label,
}: {
  value: string;
  catalogue: string[];
  onChange: (view: string) => void;
  fieldClass: string;
  label: string;
}) {
  const added = useCatalogAdditions("view");
  const [typing, setTyping] = useState(false);
  const options = uniqueNames([...catalogue, ...added, ...(value ? [value] : [])]);
  if (typing) {
    return (
      <CatalogTextAdd
        kind="view"
        known={uniqueNames([...catalogue, ...added])}
        fieldClass={fieldClass}
        placeholder="مثلاً: إطلالة على البحر"
        onCancel={() => setTyping(false)}
        onDone={(name) => {
          setTyping(false);
          onChange(name);
        }}
      />
    );
  }
  return (
    <select aria-label={label} value={value} onChange={(e) => (e.target.value === OTHER ? setTyping(true) : onChange(e.target.value))} className={fieldClass}>
      <option value="">{label}</option>
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
      <option value={OTHER}>✎ إطلالة أخرى…</option>
    </select>
  );
}
