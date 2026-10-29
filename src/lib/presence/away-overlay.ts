import type { StatusKind } from "./excuse";

/**
 * The page covered while the colleague is away (the owner, 2026-10-29: «عند الضغط على الصلاة يجب أن يتم تعميم الصفحة
 * بشيء يوحي إلى الصلاة، وكذلك إمكانية الإغلاق كي ينتهي العداد»): «صلاة» and «اجتماع» only — with a client or on a call
 * the colleague is still at the screen. Pure: AwayOverlay.tsx draws it, StatusButtons.tsx decides when.
 */

export type AwayKind = "prayer" | "meeting";

/** the overlay while one of these is on — nothing for any other button, or none */
export const awayKindOf = (
  active: { kind: StatusKind } | null | undefined,
): AwayKind | null =>
  active?.kind === "prayer" || active?.kind === "meeting" ? active.kind : null;

export const AWAY_TEXT: Record<
  AwayKind,
  { title: string; sub: string; close: string }
> = {
  prayer: { title: "وقت الصلاة", sub: "تقبّل الله", close: "انتهيت — أغلق" },
  meeting: {
    title: "في اجتماع",
    sub: "لا تُحوَّل إليك طلبات ولا يُحسب عليك تأخير حتى تنهيه",
    close: "انتهى الاجتماع",
  },
};

export const elapsedMinutes = (startedAt: string, nowMs: number) =>
  Math.max(0, Math.floor((nowMs - Date.parse(startedAt)) / 60_000));

/** «د» after a number, the way the buttons write it: 1 دقيقة, 2 دقيقتان, 3–10 دقائق, more دقيقة */
export function minutesText(n: number): string {
  if (n < 1) return "أقل من دقيقة";
  if (n === 1) return "دقيقة";
  if (n === 2) return "دقيقتان";
  return n <= 10 ? `${n} دقائق` : `${n} دقيقة`;
}

/**
 * The close button ends the status once: a second tap while the first is on its way, or after it succeeded, does
 * nothing; a failed one may be tried again.
 */
export function once<T extends { ok: boolean }>(
  fn: () => Promise<T>,
): () => Promise<T | null> {
  let state: "idle" | "busy" | "done" = "idle";
  return async () => {
    if (state !== "idle") return null;
    state = "busy";
    try {
      const r = await fn();
      state = r.ok ? "done" : "idle";
      return r;
    } catch (error) {
      state = "idle";
      throw error;
    }
  };
}
