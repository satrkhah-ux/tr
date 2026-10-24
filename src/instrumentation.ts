/**
 * At server start, one throwaway Chromium print (offer-doc/pdf warmPdfEngine): the first programme PDF after a deploy
 * missed its send on 2026-10-24 (AD-7-5934, 75 s after the container started). Never awaited — the server does not
 * wait for it — and a failure is only logged. No timers or jobs here: those run once, from the cron, never per server.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production") {
    void import("./lib/offer-doc/pdf")
      .then((m) => m.warmPdfEngine())
      .then(() => console.log("[pdf-warmup] ready"))
      .catch((error) => console.error(`[pdf-warmup] ${error instanceof Error ? error.message : String(error)}`));
  }
}
