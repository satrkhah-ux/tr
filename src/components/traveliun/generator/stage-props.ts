import type { DraftData, GeneratorLookups } from "@/lib/offer/draft-types";

/**
 * Contract between the GeneratorShell and every stage form.
 *
 * - `data` is the LIVE draft (shell state, already normalized).
 * - `patch(slice)` merges a top-level slice into the draft and schedules the
 *   debounced auto-save. Stages must only patch the slices they own.
 * - `replace(data)` swaps the whole local draft WITHOUT scheduling a save —
 *   used after server-side mutations (e.g. copying a previous program).
 * - `lookups` are the reference lists loaded by the stage's server page.
 */
export type StageFormProps = {
  draftId: string;
  data: DraftData;
  patch: (slice: Partial<DraftData>) => void;
  replace: (data: DraftData) => void;
  lookups: GeneratorLookups;
};

/** Shared field styles (Traveliun identity). */
export const fieldClass =
  "h-11 w-full rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-sm text-[#185045] outline-none transition-colors focus:border-[#2aa87a]";
export const labelClass = "grid gap-2 text-[13px] font-bold text-[#185045]";
export const sectionClass =
  "rounded-2xl border border-[#e2ebe7] bg-white p-5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]";
export const addButtonClass =
  "inline-flex h-10 items-center gap-2 rounded-[10px] border border-dashed border-[#b7d0c7] px-4 text-sm font-bold text-[#185045] transition-colors hover:bg-[#f0f7f4]";
export const removeButtonClass =
  "inline-flex h-9 items-center justify-center rounded-[8px] border border-[#f2c7c7] px-3 text-xs font-bold text-[#c43d3d] transition-colors hover:bg-[#fff1f1]";
