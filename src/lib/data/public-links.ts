"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import { notifyBookingChanged, notifyOps } from "@/lib/data/ops-notify";
import { syncOperationOfBooking } from "@/lib/data/operation-sync";
import { COMPANY } from "@/components/offer-doc/labels";
import { buildSupplierRequest, type RequestLang, type SupplierBookingKind } from "@/lib/operations/supplier-request";
import { DRV, driverServiceKind, driverStep, mapsLink, meetTime, type DriverStep, type ServiceKind } from "@/lib/operations/drivers";
import { linkOpen, sameDriver, stepAllowed, stepDetail, supplierAnswer, type LinkKind, type SupplierAnswerInput } from "@/lib/operations/op-links";
import type { TravelerKind } from "@/lib/operations/traveler-dto";

/**
 * The pages behind «رابط المورد» and «رابط السائق» (operations order 11).
 *
 * THE TOKEN IS THE GATE, as for /trip and /voucher: whoever holds it is not a
 * system user, so it is read here with the SERVICE role and refused once
 * expired, stopped, or — for a supplier — once the booking was handed to
 * someone else. Each page carries only what its reader already gets: the
 * supplier the request text order 8 sends him (names as typed on the case,
 * never decrypted from a passport); the driver his pick-ups. No price, no
 * other supplier, no passport, no internal note.
 */

const service = () => createSupabaseServiceClient() as unknown as SupabaseClient;
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

type LinkRow = {
  id: string;
  booking_id: string | null;
  supplier_id: string | null;
  driver_phone: string | null;
  driver_name: string | null;
  service_date: string | null;
  expires_at: string;
  revoked_at: string | null;
};

async function openLink(supabase: SupabaseClient, token: string, kind: LinkKind): Promise<LinkRow | null> {
  // 24 random bytes are 32 base64url characters: anything else is not ours, and costs no query
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(token)) return null;
  const { data } = await supabase
    .from("operation_links")
    .select("id, booking_id, supplier_id, driver_phone, driver_name, service_date, expires_at, revoked_at")
    .eq("token", token)
    .eq("kind", kind)
    .maybeSingle();
  const row = data as LinkRow | null;
  return row && linkOpen(row, new Date()) ? row : null;
}

// ---------------- the supplier's link ----------------

type OfferJoin = { serial: string; customers: { arabic_name: string | null } | { arabic_name: string | null }[] | null };
type SupplierBookingRow = {
  id: string;
  operation_id: string;
  kind: SupplierBookingKind;
  title: string;
  city_name: string;
  start_date: string | null;
  end_date: string | null;
  detail: Record<string, string> | null;
  handoff_note: string | null;
  status: string;
  confirmation_number: string | null;
  assignee_supplier_id: string | null;
  operations: { offers: OfferJoin | OfferJoin[] | null } | { offers: OfferJoin | OfferJoin[] | null }[] | null;
  company_suppliers: { arabic_name: string; contact_name: string | null; request_lang: string | null } | { arabic_name: string; contact_name: string | null; request_lang: string | null }[] | null;
};

async function supplierBooking(supabase: SupabaseClient, link: LinkRow): Promise<SupplierBookingRow | null> {
  const { data } = await supabase
    .from("operation_bookings")
    .select(
      "id, operation_id, kind, title, city_name, start_date, end_date, detail, handoff_note, status, confirmation_number, assignee_supplier_id, operations(offers(serial, customers(arabic_name))), company_suppliers:assignee_supplier_id(arabic_name, contact_name, request_lang)",
    )
    .eq("id", link.booking_id ?? "")
    .maybeSingle();
  const b = data as unknown as SupplierBookingRow | null;
  // handed to someone else, or cancelled: the link no longer speaks for it
  return b && b.assignee_supplier_id === link.supplier_id && b.status !== "cancelled" ? b : null;
}

export type SupplierLinkView = {
  lang: RequestLang;
  /** a drive or a tour asks for the driver and car; anything else for a number. */
  service: ServiceKind | null;
  subject: string;
  body: string;
  confirmed: { ref: string | null } | null;
  /** what is already on the booking — the form starts from it. */
  driver: { driver: string; phone: string; car: string; plate: string };
  expires_at: string;
};

export async function getSupplierLinkView(token: string): Promise<SupplierLinkView | null> {
  try {
    const supabase = service();
    const link = await openLink(supabase, token, "supplier");
    const b = link ? await supplierBooking(supabase, link) : null;
    if (!link || !b) return null;
    const supplier = one(b.company_suppliers);
    const offer = one(one(b.operations)?.offers);
    const lang: RequestLang = supplier?.request_lang === "en" ? "en" : "ar";

    const { data: trs } = await supabase
      .from("operation_travelers")
      .select("display_name, traveler_kind")
      .eq("operation_id", b.operation_id)
      .order("sort", { ascending: true });
    const travelers = ((trs ?? []) as { display_name: string; traveler_kind: TravelerKind }[]).map((t) => ({ name: t.display_name, kind: t.traveler_kind }));
    const lead = one(offer?.customers)?.arabic_name;
    if (travelers.length === 0 && lead) travelers.push({ name: lead, kind: "adult" });

    // the catalogue's English names, as composeRequest gives them (supplier-work.ts)
    const glossary: Record<string, string> = {};
    if (lang === "en") {
      const cities = [...new Set([b.city_name, b.detail?.["المدينة"]].map((c) => c?.trim()).filter((c): c is string => !!c))];
      const [c, h] = await Promise.all([
        cities.length > 0 ? supabase.from("cities").select("arabic_name, english_name").in("arabic_name", cities) : Promise.resolve({ data: [] }),
        b.kind === "hotel" ? supabase.from("hotels").select("arabic_name, english_name").eq("arabic_name", b.title.trim()).limit(1) : Promise.resolve({ data: [] }),
      ]);
      for (const r of [...(c.data ?? []), ...(h.data ?? [])] as { arabic_name: string; english_name: string | null }[]) {
        if (r.english_name?.trim()) glossary[r.arabic_name.trim()] = r.english_name.trim();
      }
    }

    const { subject, body } = buildSupplierRequest({
      lang,
      reference: offer?.serial ?? "",
      contact: supplier?.contact_name ?? null,
      booking: { kind: b.kind, title: b.title, city_name: b.city_name, start_date: b.start_date, end_date: b.end_date, detail: b.detail ?? {} },
      travelers,
      note: b.handoff_note,
      glossary,
    });
    const d = b.detail ?? {};
    return {
      lang,
      service: driverServiceKind(b),
      subject,
      body,
      confirmed: b.status === "confirmed" ? { ref: b.confirmation_number } : null,
      driver: { driver: d[DRV.driver] ?? "", phone: d[DRV.phone] ?? "", car: d[DRV.car] ?? "", plate: d[DRV.plate] ?? "" },
      expires_at: link.expires_at,
    };
  } catch {
    return null;
  }
}

export type LinkAnswer = { ok: boolean; message: string };

const SAY = {
  gone: "الرابط غير صالح أو انتهى. / This link is no longer valid.",
  ref: "أدخل رقم التأكيد. / Enter the confirmation number.",
  driver: "أدخل اسم السائق وجواله. / Enter the driver's name and mobile.",
  done: "تم التأكيد — شكراً لكم. / Confirmed — thank you.",
  already: "هذا الحجز مؤكد من قبل. / This booking is already confirmed.",
  failed: "تعذّر الحفظ. حاولوا مرة أخرى. / Could not save. Please try again.",
};

/**
 * The supplier confirms: the booking turns confirmed with his number (or his
 * driver and car), the case's statuses move (syncOperationOfBooking), and the
 * salesperson and operations hear of it — as if an agent had typed it.
 */
export async function confirmViaSupplierLink(token: string, input: SupplierAnswerInput): Promise<LinkAnswer> {
  try {
    const supabase = service();
    const link = await openLink(supabase, token, "supplier");
    const b = link ? await supplierBooking(supabase, link) : null;
    if (!link || !b) return { ok: false, message: SAY.gone };
    if (b.status === "confirmed") return { ok: true, message: SAY.already };

    const answer = supplierAnswer(driverServiceKind(b), {
      ref: String(input?.ref ?? ""),
      driver: String(input?.driver ?? ""),
      phone: String(input?.phone ?? ""),
      car: String(input?.car ?? ""),
      plate: String(input?.plate ?? ""),
    });
    if (!answer.ok) return { ok: false, message: SAY[answer.error] };

    const now = new Date().toISOString();
    const { data: updated, error } = await supabase
      .from("operation_bookings")
      .update({
        status: "confirmed",
        confirmation_number: answer.ref ?? b.confirmation_number,
        confirmed_at: now,
        request_answered_at: now,
        detail: { ...(b.detail ?? {}), ...answer.detail },
      })
      .eq("id", b.id)
      .eq("assignee_supplier_id", link.supplier_id ?? "")
      .not("status", "in", "(confirmed,cancelled)")
      .select("id");
    if (error) return { ok: false, message: SAY.failed };
    // confirmed meanwhile, by an agent or a second tab
    if ((updated ?? []).length === 0) return { ok: true, message: SAY.already };

    await supabase.from("operation_links").update({ answered_at: now }).eq("id", link.id);
    const supplier = one(b.company_suppliers)?.arabic_name ?? "المورد";
    const offer = one(one(b.operations)?.offers);
    await logAudit({
      action: "booking.confirmed",
      entity: "operation_bookings",
      entity_id: b.id,
      meta: { source: "supplier-link", link_id: link.id, confirmation_number: answer.ref, driver: Boolean(answer.detail[DRV.driver]) },
      actor: { id: null, label: "supplier-link" },
    });
    await syncOperationOfBooking(b.id);

    const what = [
      `أكّد المورد الحجز من رابطه${answer.ref ? ` برقم ${answer.ref}` : ""}`,
      answer.detail[DRV.driver] ? `السائق ${answer.detail[DRV.driver]} ${answer.detail[DRV.phone] ?? ""}`.trim() : null,
    ]
      .filter(Boolean)
      .join(" — ");
    await notifyBookingChanged({
      operationId: b.operation_id,
      serial: offer?.serial ?? "",
      customer: one(offer?.customers)?.arabic_name ?? null,
      bookingTitle: b.title,
      what,
      by: `${supplier} (رابط المورد)`,
    });
    await notifyOps(`✅ ${supplier}: ${what}\n${b.title} — ${offer?.serial ?? ""}`, `/operations/${b.operation_id}`);
    return { ok: true, message: SAY.done };
  } catch {
    return { ok: false, message: SAY.failed };
  }
}

// ---------------- the driver's day ----------------

export type DriverPickup = {
  id: string;
  kind: ServiceKind;
  serial: string;
  /** the booking name — who to look for at the arrivals hall. */
  lead: string;
  title: string;
  time: string;
  flight: string;
  meet: string;
  /** the landing the flight tracker last saw, when it moved the time. */
  landing: string;
  hotel: { name: string; name_en: string | null; map: string } | null;
  pax: string;
  /** the car and how many, as the sale wrote it — «فان × 2» — or the one operations typed. */
  car: string;
  plate: string;
  /** a tour's programme: where the day goes. */
  program: string;
  step: DriverStep | null;
};

export type DriverDay = { date: string; driver: string; contact: string; pickups: DriverPickup[] };

type DayBooking = {
  id: string;
  operation_id: string;
  kind: string;
  title: string;
  city_name: string;
  start_date: string | null;
  detail: Record<string, string> | null;
  status: string;
  operations: {
    execution_status: string;
    offers: (OfferJoin & { adults: number | null; children: number | null; infants: number | null }) | (OfferJoin & { adults: number | null; children: number | null; infants: number | null })[] | null;
  } | null;
};

async function dayBookings(supabase: SupabaseClient, link: LinkRow): Promise<DayBooking[]> {
  const { data } = await supabase
    .from("operation_bookings")
    .select("id, operation_id, kind, title, city_name, start_date, detail, status, operations(execution_status, offers(serial, adults, children, infants, customers(arabic_name)))")
    .eq("start_date", link.service_date ?? "")
    .in("kind", ["transport", "service"])
    .neq("status", "cancelled");
  return ((data ?? []) as unknown as DayBooking[]).filter(
    (b) => driverServiceKind(b) !== null && one(b.operations)?.execution_status !== "cancelled" && sameDriver(b.detail?.[DRV.phone], link.driver_phone),
  );
}

export async function getDriverDay(token: string): Promise<DriverDay | null> {
  try {
    const supabase = service();
    const link = await openLink(supabase, token, "driver");
    if (!link?.service_date) return null;
    const rows = await dayBookings(supabase, link);

    // the hotel a drive starts or ends at: the stay in the same city covering the day (as draftDriverMessage)
    const opIds = [...new Set(rows.map((r) => r.operation_id))];
    const { data: staysData } = opIds.length
      ? await supabase.from("operation_bookings").select("operation_id, title, city_name, start_date, end_date").in("operation_id", opIds).eq("kind", "hotel").neq("status", "cancelled")
      : { data: [] };
    const stays = (staysData ?? []) as { operation_id: string; title: string; city_name: string; start_date: string | null; end_date: string | null }[];
    const names = [...new Set(stays.map((s) => s.title.trim()))];
    const { data: hotelsData } = names.length ? await supabase.from("hotels").select("arabic_name, english_name, address").in("arabic_name", names) : { data: [] };
    const hotels = new Map(((hotelsData ?? []) as { arabic_name: string; english_name: string | null; address: string | null }[]).map((h) => [h.arabic_name.trim(), h]));
    const day = link.service_date;

    const pickups = rows.map((r): DriverPickup => {
      const d = r.detail ?? {};
      const offer = one(one(r.operations)?.offers);
      const city = r.city_name.trim();
      const here = stays.filter((s) => s.operation_id === r.operation_id && s.city_name.trim() === city);
      const stay = here.find((s) => (s.start_date ?? "") <= day && day <= (s.end_date ?? s.start_date ?? "")) ?? here[0] ?? null;
      const info = stay ? hotels.get(stay.title.trim()) : undefined;
      const count = (offer?.adults ?? 0) + (offer?.children ?? 0) + (offer?.infants ?? 0);
      return {
        id: r.id,
        kind: driverServiceKind(r) as ServiceKind,
        serial: offer?.serial ?? "",
        lead: one(offer?.customers)?.arabic_name ?? "",
        title: r.title,
        time: meetTime(r),
        flight: d[DRV.flight] ?? "",
        meet: d[DRV.meet] ?? "",
        landing: d[DRV.landing] ?? "",
        hotel: stay
          ? { name: stay.title, name_en: info?.english_name ?? null, map: mapsLink(info?.address || info?.english_name || stay.title, city) }
          : null,
        pax: d["الركاب"] || (count > 0 ? String(count) : ""),
        car: d[DRV.car] ?? "",
        plate: d[DRV.plate] ?? "",
        program: d["البرنامج"] ?? "",
        step: driverStep(d),
      };
    });
    pickups.sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
    return { date: day, driver: link.driver_name ?? "", contact: COMPANY.phone, pickups };
  } catch {
    return null;
  }
}

/** «انطلقت» / «استلمت الضيوف» on one pick-up of the driver's day. Forward only. */
export async function markDriverStep(token: string, bookingId: string, step: DriverStep): Promise<LinkAnswer> {
  if (step !== "on_way" && step !== "done") return { ok: false, message: SAY.failed };
  try {
    const supabase = service();
    const link = await openLink(supabase, token, "driver");
    const b = link ? (await dayBookings(supabase, link)).find((r) => r.id === bookingId) : undefined;
    if (!link || !b) return { ok: false, message: SAY.gone };
    if (!stepAllowed(driverStep(b.detail), step)) return { ok: true, message: "" };

    const riyadhNow = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Riyadh" }).slice(0, 16);
    const { error } = await supabase.from("operation_bookings").update({ detail: stepDetail(b.detail, step, riyadhNow) }).eq("id", b.id);
    if (error) return { ok: false, message: SAY.failed };

    await logAudit({
      action: "booking.created",
      entity: "operation_bookings",
      entity_id: b.id,
      meta: { edited: ["detail"], driver_step: step, link_id: link.id },
      actor: { id: null, label: "driver-link" },
    });
    if (step === "done") {
      const offer = one(one(b.operations)?.offers);
      await notifyOps(`🚐 تم استقبال الضيوف — ${b.title}\n${offer?.serial ?? ""}${link.driver_name ? ` · السائق ${link.driver_name}` : ""}`, `/operations/${b.operation_id}`);
    }
    return { ok: true, message: "" };
  } catch {
    return { ok: false, message: SAY.failed };
  }
}
