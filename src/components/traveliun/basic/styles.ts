/** The basic screen's compact fields — smaller than the generator's, so a whole file fits in one view. */
export const basicField =
  "h-9 w-full rounded-[8px] border border-[#dbe6e1] bg-white px-2.5 text-[12.5px] text-[#185045] outline-none transition-colors focus:border-[#2aa87a]";
export const basicLabel = "grid gap-1 text-[10.5px] font-bold text-[#557d78]";
export const basicCard = "rounded-[14px] border border-[#d8e6e0] bg-white p-3 shadow-[0_1px_2px_rgba(0,60,58,0.04)]";

/**
 * A typed number, without the leading zeros a «0» already in the field keeps:
 * typing 300 after it read «0300», and the browser left it on screen because
 * the number was the same. Null when the field is empty.
 */
export function typedNumber(el: HTMLInputElement): number | null {
  const v = el.value.replace(/^0+(?=\d)/, "");
  if (v !== el.value) el.value = v;
  return v === "" ? null : Number(v);
}
