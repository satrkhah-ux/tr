import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normAr, normEn } from "@/lib/catalog/norm";
import { hasArabicLetter } from "@/lib/data/quality";
import { allRows } from "@/lib/data/all-rows";
import { logAudit } from "@/lib/data/audit";
import { notifyHotelData } from "@/lib/data/ops-notify";

/**
 * A hotel's data is the administration's, never the salesperson's or the
 * booking agent's (the owner, 2026-10-23: «يجب أن يتم تحويل هذا الطلب إلى
 * الإدارة، وموظف المبيعات أو الحجوزات يكمل حجوزاته ولا يظهر له خطأ يخص
 * البيانات» — «أو عندما يدخله يدوياً يتم إضافته في النظام تلقائياً»).
 *
 *  · ensureCatalogHotel — a hotel typed by hand (an issued draft's line with
 *    no catalogue id, a booking the catalogue does not know) becomes a /hotels
 *    row in its city, and the administration is told to complete it;
 *  · requestHotelData — what a paper waits on (the English name, the address
 *    or the phone) goes to the administration (settings.manage), once a week
 *    per hotel and reason.
 *
 * Service role: the callers are gated, or are the server itself.
 */

/** «كوالالمبور» and «كوالا لمبور» — one city (hotel-match.ts). */
const place = (s: string | null | undefined) => normAr(s).replace(/\s+/g, "");

export type HotelDataReason = "new" | "no_english" | "no_contact";

const REASON: Record<HotelDataReason, string> = {
  new: "فندق جديد أُضيف من إدخال يدوي — أكمل اسمه الإنكليزي وعنوانه وهاتفه وتصنيفه",
  no_english: "الاسم الإنكليزي — فاوتشر الإقامة ينتظره",
  no_contact: "العنوان أو الهاتف — يُطبع في الفاوتشر لموظف الاستقبال",
};

/**
 * Tell the administration, unless this hotel was asked for the same reason (or
 * as new, which asks for everything) in the last 7 days. After the response
 * when there is one — issuing never waits on Telegram. Best-effort.
 */
export async function requestHotelData(
  supabase: SupabaseClient,
  hotel: { id: string; name: string; city: string | null },
  reason: HotelDataReason,
  context: { serial?: string | null; by?: string | null } = {},
): Promise<void> {
  const ask = async () => {
    try {
      const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const { data: asked } = await supabase
        .from("audit_logs")
        .select("id")
        .eq("action", "data.requested")
        .eq("entity", "hotels")
        .eq("entity_id", hotel.id)
        .in("meta->>reason", [reason, "new"])
        .gte("created_at", since)
        .limit(1);
      if ((asked ?? []).length > 0) return;
      await logAudit({ action: "data.requested", entity: "hotels", entity_id: hotel.id, meta: { reason, serial: context.serial ?? null } });
      await notifyHotelData({ hotelId: hotel.id, name: hotel.name, city: hotel.city, why: REASON[reason], serial: context.serial ?? null, by: context.by ?? null });
    } catch {
      /* the request is a courtesy — the hotel is on «جودة البيانات» either way */
    }
  };
  try {
    after(ask);
  } catch {
    // outside a request (a job): inline
    await ask();
  }
}

/**
 * The /hotels row for a hotel typed by hand in `city` — the one hotel of that
 * name there (either language), or a new row handed to the administration.
 * Null when there is no name, the write failed, or two namesakes leave it
 * unsaid which one was meant (the duplicates card is the data team's).
 */
export async function ensureCatalogHotel(
  supabase: SupabaseClient,
  input: { name: string; city: string | null; serial?: string | null; by?: string | null },
): Promise<string | null> {
  const name = input.name.trim();
  if (!name) return null;
  try {
    const { data: cities } = await allRows<{ id: string; arabic_name: string; english_name: string | null; country_id: string | null }>((from, to) =>
      supabase.from("cities").select("id, arabic_name, english_name, country_id").range(from, to),
    );
    // the Arabic name first; the English one only for a city typed in English — an Arabic
    // name has no Latin letters, and "" would match every city without an English name
    const wanted = place(input.city);
    const cityEn = normEn(input.city);
    const city = wanted ? (cities.find((c) => place(c.arabic_name) === wanted) ?? (cityEn ? cities.find((c) => normEn(c.english_name) === cityEn) : undefined) ?? null) : null;

    const same = (h: { arabic_name: string; english_name: string | null }) =>
      normAr(h.arabic_name) === normAr(name) || (normEn(name) !== "" && normEn(h.english_name) === normEn(name));
    const { data: rows } = city
      ? await supabase.from("hotels").select("id, arabic_name, english_name").eq("city_id", city.id)
      : await supabase.from("hotels").select("id, arabic_name, english_name").eq("arabic_name", name);
    const found = ((rows ?? []) as { id: string; arabic_name: string; english_name: string | null }[]).filter(same);
    if (found.length > 1) return null;
    // with no city to tell namesakes apart, only when the booking names no city either (hotel-match.ts)
    if (found.length === 1 && (city || !input.city?.trim())) return found[0].id;

    // a name typed in English is its English name too — the voucher can print it at once
    const latin = !hasArabicLetter(name);
    const { data: created, error } = await supabase
      .from("hotels")
      .insert({ arabic_name: name, english_name: latin ? name : null, city_id: city?.id ?? null, country_id: city?.country_id ?? null })
      .select("id")
      .single();
    if (error || !created) return null;
    const id = (created as { id: string }).id;
    await logAudit({ action: "data.created", entity: "hotels", entity_id: id, meta: { from: "typed", serial: input.serial ?? null, city: input.city ?? null } });
    await requestHotelData(supabase, { id, name, city: city?.arabic_name ?? input.city ?? null }, "new", input);
    return id;
  } catch {
    return null;
  }
}
