import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

/**
 * The customers row an issued offer points at — the client link reads the name
 * and phone from it. Found by the same name and phone, else created. Null when
 * the file names nobody or the row cannot be written: the offer still goes out,
 * without the name, as before.
 *
 * Service role: only staff may write customers (RLS). NOT a server action (no
 * "use server" here) — every caller has already checked who may issue the file.
 * Only staff reuse an existing row (`reuse`), so a partner's offer is never tied
 * to one of our customers who shares the phone.
 *
 * Same body as the private copy in drafts.ts (the generator), which can import
 * this one instead.
 */
export async function customerFor(customer: { customer_name: string; customer_phone: string }, reuse: boolean): Promise<string | null> {
  const name = customer.customer_name.trim();
  const phone = customer.customer_phone.trim();
  if (!name && !phone) return null;
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    let found = supabase.from("customers").select("id").eq("arabic_name", name || phone);
    found = phone ? found.eq("mobile", phone) : found.is("mobile", null);
    const { data: hit } = reuse ? await found.limit(1).maybeSingle() : { data: null };
    if (hit) return (hit as { id: string }).id;
    const { data: row } = await supabase.from("customers").insert({ arabic_name: name || phone, mobile: phone || null }).select("id").single();
    return (row as { id: string } | null)?.id ?? null;
  } catch {
    return null;
  }
}
