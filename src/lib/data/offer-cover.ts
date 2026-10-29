import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CoverStyle } from "@/components/offer-doc/cover-image";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

/**
 * The first page the employee chose for this offer's client PDF and link («أساسي» / «فني», offers.pdf_cover).
 * Service client like the public link itself; «basic» when the column is not there yet or the read fails.
 */
export async function getOfferCover(serial: string): Promise<CoverStyle> {
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const { data } = await supabase.from("offers").select("pdf_cover").eq("serial", serial).maybeSingle();
    return (data as { pdf_cover?: string } | null)?.pdf_cover === "designed" ? "designed" : "basic";
  } catch {
    return "basic";
  }
}

/** `?c=d` / `?c=b` name a cover outright (the WhatsApp link, the preview); anything else follows the stored choice. */
export async function coverFromParam(serial: string, param: string | null): Promise<CoverStyle> {
  return param === "d" ? "designed" : param === "b" ? "basic" : getOfferCover(serial);
}
