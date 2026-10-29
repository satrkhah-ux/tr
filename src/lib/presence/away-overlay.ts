import type { StatusKind } from "./excuse";

/**
 * The page covered while a status button is on (the owner, 2026-10-29: «عند الضغط على الصلاة يجب أن يتم تعميم الصفحة
 * بشيء يوحي إلى الصلاة، وكذلك إمكانية الإغلاق كي ينتهي العداد»; then «ليس فقط الصلاة حتى لو كان لديه عميل أو اجتماع»):
 * every status has its own cover, its minutes, and one button that ends it. With a client or on a call the colleague
 * may need the system, so those two fold into a slim bar on demand; prayer and a meeting stay full-page.
 * Pure: AwayOverlay.tsx draws it, StatusButtons.tsx decides when.
 */

export type AwayKind = StatusKind;

/** the cover while a status is on — none when nothing is */
export const awayKindOf = (
  active: { kind: StatusKind } | null | undefined,
): AwayKind | null => active?.kind ?? null;

export const AWAY_TEXT: Record<
  AwayKind,
  { title: string; sub: string; close: string; bar: string }
> = {
  prayer: {
    title: "وقت الصلاة",
    sub: "تقبّل الله",
    close: "انتهيت — أغلق",
    bar: "صلاة",
  },
  meeting: {
    title: "في اجتماع",
    sub: "لا تُحوَّل إليك طلبات ولا يُحسب عليك تأخير حتى تنهيه",
    close: "انتهى الاجتماع",
    bar: "اجتماع",
  },
  client: {
    title: "لدي عميل في المكتب",
    sub: "لا تُحوَّل إليك طلبات ولا يُحسب عليك تأخير حتى تنهي",
    close: "انتهيت من العميل",
    bar: "لدي عميل",
  },
  call: {
    title: "في اتصال مع عميل",
    sub: "لا تُحوَّل إليك طلبات ولا يُحسب عليك تأخير حتى تنهي",
    close: "انتهى الاتصال",
    bar: "لدي اتصال",
  },
};

/** only these fold into a bar: the colleague is at the screen serving the client */
export const canFold = (kind: AwayKind) => kind === "client" || kind === "call";

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

/** the fold is kept for this status across pages (each page mounts the buttons anew) */
export const foldKey = (startedAt: string) => `away-fold:${startedAt}`;

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
