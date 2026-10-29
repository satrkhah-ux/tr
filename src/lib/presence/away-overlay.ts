import type { StatusKind } from "./excuse";

/**
 * The page covered while a status button is on (the owner, 2026-10-29: «عند الضغط على الصلاة يجب أن يتم تعميم الصفحة
 * بشيء يوحي إلى الصلاة، وكذلك إمكانية الإغلاق كي ينتهي العداد»; then «ليس فقط الصلاة حتى لو كان لديه عميل أو اجتماع»):
 * every status has its own cover, its minutes, and one button that ends it — and every one is full-page, nothing of
 * the system behind it (the owner: «لدي اتصال وعميل في المكتب يجب أن يكون باقي الأجزاء غير ظاهرة كي يبين له أنه خارج
 * النظام مؤقتاً، بدون تسجيل خروج، فقط إيقاف العداد»).
 * Pure: AwayOverlay.tsx draws it, StatusButtons.tsx decides when.
 */

export type AwayKind = StatusKind;

/** the cover while a status is on — none when nothing is */
export const awayKindOf = (
  active: { kind: StatusKind } | null | undefined,
): AwayKind | null => active?.kind ?? null;

export const AWAY_TEXT: Record<
  AwayKind,
  { title: string; sub: string; close: string }
> = {
  prayer: {
    title: "وقت الصلاة",
    sub: "تقبّل الله",
    close: "انتهيت — أغلق",
  },
  meeting: {
    title: "في اجتماع",
    sub: "لا تُحوَّل إليك طلبات ولا يُحسب عليك تأخير حتى تنهيه",
    close: "انتهى الاجتماع",
  },
  client: {
    title: "لدي عميل في المكتب",
    sub: "لا تُحوَّل إليك طلبات ولا يُحسب عليك تأخير حتى تنهي",
    close: "انتهيت من العميل",
  },
  call: {
    title: "في اتصال مع عميل",
    sub: "لا تُحوَّل إليك طلبات ولا يُحسب عليك تأخير حتى تنهي",
    close: "انتهى الاتصال",
  },
};

/** what the colleague typed in «لدي عميل / لدي اتصال»: the client's name, and the request in one line */
export function clientOf(
  details: Record<string, unknown> | null | undefined,
): { name: string; request: string } | null {
  const text = (k: string) =>
    typeof details?.[k] === "string" ? (details[k] as string).trim() : "";
  const name = text("name");
  const request = [text("want"), text("destination"), text("note")]
    .filter(Boolean)
    .join(" · ");
  return name || request ? { name, request } : null;
}

export const elapsedMinutes = (startedAt: string, nowMs: number) =>
  Math.max(0, Math.floor((nowMs - Date.parse(startedAt)) / 60_000));

/** 1 دقيقة, 2 دقيقتان, 3–10 دقائق, more دقيقة */
export function minutesText(n: number): string {
  if (n < 1) return "أقل من دقيقة";
  if (n === 1) return "دقيقة";
  if (n === 2) return "دقيقتان";
  return n <= 10 ? `${n} دقائق` : `${n} دقيقة`;
}

/**
 * The end button ends the status once: a second tap while the first is on its way, or after it succeeded, does
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
