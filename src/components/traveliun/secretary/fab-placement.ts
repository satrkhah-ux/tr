/**
 * Where مُراد's floating button may stand (the owner, 2026-10-26: «لا اريد ازالة مراد كزر عائم بل يتم تنقيته وتنسيقه من الظهور
 * امام الازرار والمدخلات»): the free spots along the page's end edge, and the first of them that covers no button, link or
 * field. Pure — the component measures the page and asks.
 */

export type Box = { left: number; top: number; right: number; bottom: number };
export type Spot = { left: number; top: number };

export const FAB_SIZE = 52;
const MARGIN = 8;
const STEP = 60;

/** do the two boxes touch (with `pad` of air around the second)? */
export function intersects(a: Box, b: Box, pad = 0): boolean {
  return a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad;
}

/**
 * The spots along the end edge, from the bottom up: the button's own corner first, then every `STEP` pixels up to the bar
 * at the top. `bottomReserve` keeps the phone's tab bar clear. `rtl`: the end edge is the left one.
 */
export function candidateSpots(view: { width: number; height: number }, rtl: boolean, topReserve = 70, bottomReserve = 20): Spot[] {
  const left = rtl ? MARGIN : view.width - FAB_SIZE - MARGIN;
  const spots: Spot[] = [];
  for (let top = view.height - bottomReserve - FAB_SIZE; top >= topReserve; top -= STEP) spots.push({ left, top });
  return spots;
}

/** the first spot whose button would sit over nothing; null when the whole edge is busy (the button then docks) */
export function pickSpot(spots: Spot[], busy: Box[], pad = 6): Spot | null {
  return spots.find((s) => !busy.some((b) => intersects({ left: s.left, top: s.top, right: s.left + FAB_SIZE, bottom: s.top + FAB_SIZE }, b, pad))) ?? null;
}

/** keep the current spot while it is still free (no jumping about), else take the first free one */
export function settleSpot(current: Spot | null, spots: Spot[], busy: Box[], pad = 6): Spot | null {
  if (current && !busy.some((b) => intersects({ left: current.left, top: current.top, right: current.left + FAB_SIZE, bottom: current.top + FAB_SIZE }, b, pad))) return current;
  return pickSpot(spots, busy, pad);
}
