"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { partnerCaller } from "@/lib/partners/price-view";
import { issuePricing, issuedHotelRefs, ownIssueSheet, priceMoved } from "@/lib/offer/issue-pricing";
import { getProfitSettings } from "./app-settings";
import { getRates } from "./rates-actions";
import { loadDraft } from "./draft-store";

/**
 * «تطبيق تحديث السعر» (the owner, 2026-10-29): after an issue, does the file still price at the total
 * the client was sent? Any priced change since — a hotel or a tour added, the margin raised, profit
 * added — says no, and the editor offers the button that re-issues it (the ordinary re-issue: new
 * version, new PDF, the client link follows it, the old version kept in «سجل النسخ»).
 *
 * «Moved» is read at the rates the issue itself used (pricings.fx_rates), so a currency feed that moved
 * overnight is not a change the agent made; the new total shown is at today's rates — what the re-issue
 * will actually charge. Our own files only: a partner's sheet is re-priced at their terms on every issue.
 */
export type PriceCheck = { ok: true; changed: false } | { ok: true; changed: true; issued: number; next: number | null; currency: string } | { ok: false; error: string };

export async function checkPriceUpdate(draftId: string): Promise<PriceCheck> {
  try {
    if (!(await getServerUser())) return { ok: false, error: "err.session" };
    if ((await partnerCaller()) || !(await currentCan("offers.write"))) return { ok: false, error: "err.forbidden" };
    const record = await loadDraft(draftId);
    const serial = record?.data.produced_serial;
    if (!record || !serial || record.partner_company_id) return { ok: true, changed: false };

    const db = createSupabaseServiceClient() as unknown as SupabaseClient;
    const { data: offer } = await db.from("offers").select("id, total, currency, status").eq("serial", serial).maybeSingle();
    const row = offer as { id: string; total: number | string | null; currency: string | null; status: string | null } | null;
    if (!row || row.total == null || row.status === "cancelled") return { ok: true, changed: false };
    const { data: priced } = await db.from("pricings").select("fx_rates").eq("offer_id", row.id).maybeSingle();
    const atIssue = ((priced as { fx_rates: Record<string, number> | null } | null)?.fx_rates ?? {}) as Record<string, number>;

    const data = record.data;
    const [{ sarPer }, { default_pct }] = await Promise.all([getRates(), getProfitSettings()]);
    const sheet = ownIssueSheet(data);
    const refs = issuedHotelRefs(data);
    const issued = Number(row.total);
    const thenRates = issuePricing(sheet, data, refs, default_pct, { ...sarPer, ...atIssue }).totals.total;
    if (!priceMoved(thenRates, issued)) return { ok: true, changed: false };
    const next = issuePricing(sheet, data, refs, default_pct, sarPer).totals.total;
    return { ok: true, changed: true, issued, next, currency: row.currency || data.pricing.display_currency || "SAR" };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
