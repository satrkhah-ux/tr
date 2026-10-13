"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { duplicateDraft } from "@/lib/data/drafts";
import { getPartnerSession } from "./session";

/**
 * «جدّد التسعير» — an expired offer's file copied into a fresh draft, which
 * prices itself at today's rates when the partner opens its pricing; the link
 * to the old offer is kept so the new one can show what the old one cost.
 *
 * Only the partner's own offer: the draft copy goes through duplicateDraft,
 * which scopes a partner to its own drafts, and the offer is checked here first.
 */
export async function renewPartnerOffer(serial: string, draftId: string): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const partner = await getPartnerSession();
  if (!partner) return { ok: false, message: "انتهت الجلسة — ادخلوا من جديد." };
  try {
    const service = createSupabaseServiceClient() as unknown as SupabaseClient;
    const { data } = await service.from("offers").select("id, partner_company_id").eq("serial", serial.trim()).maybeSingle();
    const offer = data as { id: string; partner_company_id: string | null } | null;
    if (!offer || offer.partner_company_id !== partner.partner_id) return { ok: false, message: "لم نجد هذا العرض ضمن عروض شركتكم." };

    const copy = await duplicateDraft(draftId);
    if (!copy.ok) return { ok: false, message: "تعذّر نسخ الملف. حاولوا مرة أخرى." };
    await service.from("offer_renewals").insert({ old_offer_id: offer.id, new_draft_id: copy.id, partner_id: partner.partner_id });
    return { ok: true, id: copy.id };
  } catch {
    return { ok: false, message: "تعذّر التجديد. حاولوا مرة أخرى." };
  }
}
