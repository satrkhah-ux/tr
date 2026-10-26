import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/data/audit";
import { getRates } from "@/lib/data/rates-actions";
import { deriveHotelStays, normalizeDraftData, type DraftData } from "@/lib/offer/draft-types";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import type { ExtCaller } from "./auth";

/**
 * «أرسل إلى الملف» — a hotel price the employee saw with their own eyes on
 * Agoda, Almosafer or Booking, sent from the extension into THEIR proposal
 * draft («مقترح سكرتيرك …», not issued), exactly as «قارن» writes it
 * (secretary/proposals.ts applyComparedHotel — kept in step with it; that file is
 * "use server", so its core cannot be shared with a caller that has no session).
 * The stays offered to choose from are the same ones «قارن» lists: the
 * employee's own proposals of the last two weeks. No price leaves here.
 *
 * One difference from «قارن», on purpose: a stay is its own hotel line (its id),
 * never «every line in the city» — a city with two hotels, or a room change,
 * keeps its other line untouched, and the line is priced for its own nights.
 */
const TITLE_PREFIX = "مقترح سكرتيرك";

export type ExtStay = { stayId: string; cityKey: string; city: string; hotel: string; checkIn: string | null; checkOut: string | null; nights: number; rooms: number };
export type ExtProposal = { id: string; title: string; client: string; createdAt: string; stays: ExtStay[] };

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;

/** The employee's own open proposals (the last two weeks, not issued), each stay with its dates and rooms. */
export async function myProposals(caller: ExtCaller): Promise<ExtProposal[]> {
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data } = await db()
    .from("offer_drafts")
    .select("id, title, data, created_at")
    .eq("created_by", caller.employeeId)
    .ilike("title", `${TITLE_PREFIX}%`)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(20);
  return ((data ?? []) as { id: string; title: string | null; data: Record<string, unknown>; created_at: string }[])
    .map((r) => ({ r, d: normalizeDraftData(r.data) }))
    .filter(({ d }) => !d.produced_serial)
    .map(({ r, d }) => ({
      id: r.id,
      title: r.title ?? "مقترح",
      client: d.customer.customer_name || "عميل",
      createdAt: r.created_at,
      // each hotel line with its own dates and nights (a city may hold two)
      stays: deriveHotelStays(d.cities, d.hotels).map((st) => ({
        stayId: st.line.id,
        cityKey: st.city_key,
        city: st.city_name,
        hotel: st.line.hotel_name,
        checkIn: st.check_in,
        checkOut: st.check_out,
        nights: Math.max(st.nights, 1),
        rooms: (st.line.rooms ?? []).length || 1,
      })),
    }));
}

export type ApplyInput = { draftId: string; stayId: string; hotelName: string; amount: number; currency: string; site: string };
export type ApplyResult = { ok: true; staySar: number; draftId: string } | { ok: false; error: string };

const SITES = new Set(["أجودا", "المسافر", "Booking.com"]);

/** The captured price into the stay — the same writing as «قارن»'s «+ أضف هذا الفندق بديلاً». */
export async function applyCapturedPrice(caller: ExtCaller, input: ApplyInput): Promise<ApplyResult> {
  const hotelName = (typeof input.hotelName === "string" ? input.hotelName : "").trim().slice(0, 150);
  const site = SITES.has(input.site) ? input.site : "موقع حجز";
  if (typeof input.draftId !== "string" || !/^[0-9a-f-]{36}$/i.test(input.draftId) || typeof input.stayId !== "string" || !input.stayId || input.stayId.length > 80 || !hotelName) {
    return { ok: false, error: "أكمل اسم الفندق والإقامة." };
  }
  if (typeof input.amount !== "number" || !Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 1_000_000) return { ok: false, error: "سعر غير صالح." };
  const cur = (typeof input.currency === "string" ? input.currency : "").trim().toUpperCase() || "SAR";
  // the rates before the draft is read: the write below follows the read with nothing slow between them
  const { sarPer } = await getRates().catch(() => ({ sarPer: {} as Record<string, number> }));
  const staySar = cur === "SAR" ? input.amount : sarPer[cur] ? input.amount * sarPer[cur] : NaN;
  if (!Number.isFinite(staySar)) return { ok: false, error: `لا أعرف تحويل ${cur} — اختر الريال واكتب السعر به.` };

  const { data, error: readError } = await db().from("offer_drafts").select("id, title, data, created_by, updated_at").eq("id", input.draftId).maybeSingle();
  if (readError) return { ok: false, error: "تعذّر الوصول إلى النظام — حاول بعد قليل." };
  const row = data as { id: string; title: string | null; data: Record<string, unknown>; created_by: string | null; updated_at: string } | null;
  // their own proposal drafts only — never an issued file, never a colleague's
  if (!row || row.created_by !== caller.employeeId || !row.title?.startsWith(TITLE_PREFIX)) return { ok: false, error: "هذه ليست مسودة مقترح لك." };
  const d: DraftData = normalizeDraftData(row.data);
  if (d.produced_serial) return { ok: false, error: "المسودة أُصدرت — عدّلها من بيسك." };
  const stay = deriveHotelStays(d.cities, d.hotels).find((st) => st.line.id === input.stayId);
  if (!stay) return { ok: false, error: "لم أجد هذه الإقامة — ربما تغيّرت المسودة." };

  const rooms = (stay.line.rooms ?? []).length || 1;
  const perRoom = Math.round((staySar / rooms) * 100) / 100;
  const next: DraftData = {
    ...d,
    hotels: d.hotels.map((h) =>
      h.id !== input.stayId
        ? h
        : {
            ...h,
            hotel_id: null, // a typed hotel joins /hotels through the existing path at issue
            hotel_name: hotelName,
            manual_price: null,
            manual_currency: "SAR",
            // this line's own nights, not the whole city's
            priced_nights: Math.max(stay.nights, 1),
            sourcing: null,
            rooms: (h.rooms ?? []).map((room) => ({ ...room, price: perRoom })),
          },
    ),
  };
  // written only over the draft as it was read: saved in Basic meanwhile, or issued, and nothing is written
  const { data: written, error } = await db()
    .from("offer_drafts")
    .update({ data: next, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("created_by", caller.employeeId)
    .eq("updated_at", row.updated_at)
    .select("id");
  if (error) return { ok: false, error: "تعذّر الحفظ." };
  if (!written?.length) return { ok: false, error: "تغيّرت المسودة للتو — أعد المحاولة." };
  await logAudit({
    action: "secretary.compare_applied",
    entity: "offer_drafts",
    entity_id: row.id,
    meta: { city: stay.city_name, hotel: hotelName, sar: Math.round(staySar), site: `${site} — من الإضافة`, by_hand: true },
    actor: { id: caller.employeeId, label: caller.name },
  });
  return { ok: true, staySar: Math.round(staySar), draftId: row.id };
}
