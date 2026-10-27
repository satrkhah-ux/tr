"use server";

import { logAudit } from "@/lib/data/audit";
import { getRates } from "@/lib/data/rates-actions";
import { currentCan } from "@/lib/roles/current";
import { normalizeDraftData, type DraftData } from "@/lib/offer/draft-types";
import { normAr } from "@/lib/catalog/norm";
import { currentSecretaryEmployee, secretaryDb } from "./core";

/**
 * «عروض مقترحة من سكرتيرك» + «قارن» (the owner, 2026-10-26): the employee's own
 * proposal drafts («مقترح سكرتيرك …», theirs, last two weeks), each stay with
 * its compare context — and the paste-back: a price the employee read with
 * their OWN eyes on a public site becomes the stay's typed price, marked as
 * manually entered from that site. Buy prices of others never leave here:
 * a stay's current total is returned only to pricing.internal.
 */

const TITLE_PREFIX = "مقترح سكرتيرك";

export type ProposalStay = {
  cityKey: string;
  cityAr: string;
  cityEn: string | null;
  checkIn: string | null;
  checkOut: string | null;
  nights: number;
  hotelName: string;
  roomsCount: number;
  /** the stay's typed total in its own currency — pricing.internal only, else null */
  currentTotal: { amount: number; currency: string } | null;
};

export type Proposal = { id: string; title: string | null; createdAt: string; client: string; adults: number; stays: ProposalStay[] };

const fold = (s: string) => normAr(s).replace(/^ال/, "");

export async function listMyProposals(): Promise<Proposal[] | null> {
  const employee = await currentSecretaryEmployee();
  if (!employee || !(await currentCan("offers.write"))) return null;
  const internal = await currentCan("pricing.internal");
  const db = secretaryDb();
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const { data } = await db
    .from("offer_drafts")
    .select("id, title, data, created_at")
    .eq("created_by", employee.id)
    .ilike("title", `${TITLE_PREFIX}%`)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(20);
  const rows = (data ?? []) as { id: string; title: string | null; data: Record<string, unknown>; created_at: string }[];
  if (!rows.length) return [];

  // the catalogue's English city names — the compare links match far better with them
  const { data: cityRows } = await db.from("cities").select("arabic_name, english_name");
  const en = new Map(((cityRows ?? []) as { arabic_name: string; english_name: string | null }[]).map((c) => [fold(c.arabic_name), c.english_name?.trim() || null]));

  return rows.map((r) => {
    const d = normalizeDraftData(r.data);
    return {
      id: r.id,
      title: r.title,
      createdAt: r.created_at,
      client: d.customer.customer_name || "عميل",
      adults: d.trip.adults || 2,
      stays: d.hotels.map((h) => {
        const city = d.cities.find((c) => c.key === h.city_key);
        const typed = (h.rooms ?? []).reduce((n: number | null, room) => (n == null || room.price == null ? null : n + room.price), 0 as number | null);
        return {
          cityKey: h.city_key ?? "",
          cityAr: h.city_name,
          cityEn: en.get(fold(h.city_name)) ?? null,
          checkIn: city?.check_in ?? null,
          checkOut: city?.check_out ?? null,
          nights: Math.max(city?.nights ?? 1, 1),
          hotelName: h.hotel_name,
          roomsCount: (h.rooms ?? []).length || 1,
          currentTotal: internal && typed != null ? { amount: typed, currency: h.manual_currency?.trim() || "SAR" } : null,
        };
      }),
    };
  });
}

export type ApplyResult = { ok: true; staySar: number } | { ok: false; error: string };

/** «+ أضف هذا الفندق بديلاً»: the employee's own verified find, written by their hand into THEIR proposal draft. */
export async function applyComparedHotel(input: { draftId: string; cityKey: string; hotelName: string; amount: number; currency: string; site: string }): Promise<ApplyResult> {
  const employee = await currentSecretaryEmployee();
  if (!employee || !(await currentCan("offers.write"))) return { ok: false, error: "لا صلاحية" };
  const hotelName = (input.hotelName ?? "").trim().slice(0, 150);
  const site = (input.site ?? "").trim().slice(0, 30);
  if (!/^[0-9a-f-]{36}$/i.test(input.draftId) || !input.cityKey || !hotelName) return { ok: false, error: "أكمل اسم الفندق." };
  if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 1_000_000) return { ok: false, error: "سعر غير صالح." };

  const db = secretaryDb();
  const { data } = await db.from("offer_drafts").select("id, title, data, created_by").eq("id", input.draftId).maybeSingle();
  const row = data as { id: string; title: string | null; data: Record<string, unknown>; created_by: string | null } | null;
  // their own proposal drafts only — never an issued file, never a colleague's
  if (!row || row.created_by !== employee.id || !row.title?.startsWith(TITLE_PREFIX)) return { ok: false, error: "هذه ليست مسودة مقترح لك." };
  const d: DraftData = normalizeDraftData(row.data);
  if (d.produced_serial) return { ok: false, error: "المسودة أُصدرت — عدّلها من بيسك." };
  const stay = d.hotels.find((h) => h.city_key === input.cityKey);
  if (!stay) return { ok: false, error: "لم أجد هذه الإقامة." };

  const { sarPer } = await getRates().catch(() => ({ sarPer: {} as Record<string, number> }));
  const cur = input.currency?.trim().toUpperCase() || "SAR";
  const staySar = cur === "SAR" ? input.amount : sarPer[cur] ? input.amount * sarPer[cur] : NaN;
  if (!Number.isFinite(staySar)) return { ok: false, error: `لا أعرف تحويل ${cur} — اكتب السعر بالريال.` };

  const rooms = (stay.rooms ?? []).length || 1;
  const perRoom = Math.round((staySar / rooms) * 100) / 100;
  const city = d.cities.find((c) => c.key === input.cityKey);
  const next: DraftData = {
    ...d,
    hotels: d.hotels.map((h) => h.city_key !== input.cityKey ? h : {
      ...h,
      hotel_id: null, // a typed hotel joins /hotels through the existing path at issue
      hotel_name: hotelName,
      manual_price: null,
      manual_currency: "SAR",
      priced_nights: Math.max(city?.nights ?? 1, 1),
      sourcing: null,
      rooms: (h.rooms ?? []).map((room) => ({ ...room, price: perRoom })),
    }),
  };
  const { error } = await db.from("offer_drafts").update({ data: next, updated_at: new Date().toISOString() }).eq("id", row.id).eq("created_by", employee.id);
  if (error) return { ok: false, error: "تعذّر الحفظ." };
  await logAudit({
    action: "secretary.compare_applied",
    entity: "offer_drafts",
    entity_id: row.id,
    meta: { city: stay.city_name, hotel: hotelName, sar: Math.round(staySar), site, by_hand: true },
  });
  return { ok: true, staySar: Math.round(staySar) };
}
