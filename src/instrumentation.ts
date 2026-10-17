/**
 * Once per server start. «العملاء»: the conversations sheet is pulled every two
 * minutes, whether or not anyone has the page open, so a conversation is dated
 * the day it was logged (the sheet has no date column). Production only — a dev
 * server restarts too often to keep a clock — and LEADS_SHEET_AUTOPULL=0 stops it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NODE_ENV !== "production" || process.env.LEADS_SHEET_AUTOPULL === "0") return;
  const { createSupabaseServiceClient } = await import("@/lib/supabase/server");
  const { pullSheet } = await import("@/lib/leads/sync");
  const tick = () => {
    pullSheet(createSupabaseServiceClient() as never).catch(() => undefined);
  };
  setTimeout(tick, 30_000);
  setInterval(tick, 120_000);
}
