"use server";

import { createElement } from "react";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { logAudit } from "@/lib/data/audit";
import { listBookings } from "@/lib/data/operation-bookings";
import { listTravelers, listTravelersByOperation } from "@/lib/data/operation-travelers";
import { getWelcomeBoard } from "@/lib/data/welcome-board";
import { conversationForPhone, sendTeletelAttachment, sendTeletelMessage } from "@/lib/providers/teletel";
import { COMPANY } from "@/components/offer-doc/labels";
import { WelcomeBoardDocument } from "@/components/offer-doc/WelcomeBoardDocument";
import { renderDocHtml } from "@/lib/offer-doc/html";
import { offerDocumentToPdf } from "@/lib/offer-doc/pdf";
import { normalizeName } from "@/lib/offer/pricing-suggest";
import { normAr } from "@/lib/catalog/norm";
import { catalogHotelsFor } from "@/lib/data/hotel-match";
import { gateOps, gateRow, mayWork, opsAccess } from "@/lib/operations/access";
import { carText, DRV, driverServiceKind, linkOf, meetTime, type ServiceKind } from "@/lib/operations/drivers";
import { hotelsMessage, programmeMessage, programmeUpdate, recipientKey, type HotelGap, type ProgrammeInput } from "@/lib/operations/driver-programme";
import { cityOf, transportCities } from "@/lib/operations/wizard/transport";
import { leadName } from "@/lib/operations/travelers";

/**
 * «السائقون والاستقبال» — what the driver (or the city's local agent) is sent,
 * and the day's drives of every case on one sheet.
 *
 * The facts are booking detail (edited through updateBooking like any other
 * detail); this module only reads them out and sends them — since the owner's
 * order of 2026-10-17, as TWO messages for the recipient's whole part of the
 * trip (driver-programme.ts), not a card per drive. Sending is a reviewed act,
 * as for supplier requests: drafted, shown in an editable box, and gone only
 * when a human presses the button.
 */

function db(): Promise<SupabaseClient> {
  return createSupabaseServerClient() as unknown as Promise<SupabaseClient>;
}

type Fail = { ok: false; error: TranslationKey };

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

type OfferJoin = { serial: string; employee_id?: string | null };
type OpJoin = { execution_status?: string; offers: OfferJoin | OfferJoin[] | null };

/** The driver's (or the local agent's) two messages, ready for review — and what changed since the last. */
export type ProgrammeDraft = {
  to_label: string;
  to_phone: string | null;
  canSendWhatsapp: boolean;
  /** the cities this recipient covers — their part of the trip, nobody else's. */
  cities: string[];
  programme: string;
  hotels: string;
  /** the lines new since the programme (and updates) last sent to them — null when nothing changed or nothing was sent. */
  update: string | null;
  /** hotels missing an address or a phone — warned before sending, never printed as «—». */
  gaps: HotelGap[];
  /** the case's hotels whose city none of its drives names — left out of this message, and said so. */
  unplaced: string[];
  serial: string;
  /** the arrival sign's name, for sending it by hand — the lead traveller's as in the passport (leadName). */
  customer: string;
};

const PROGRAMME_TEMPLATES = ["driver_programme", "driver_update"];

/** What this recipient was last told: the last programme and every update since, newest first. */
async function toldBefore(supabase: SupabaseClient, operationId: string, to: { label: string; phone: string | null }): Promise<string | null> {
  let q = supabase
    .from("operation_dispatches")
    .select("template, body")
    .eq("operation_id", operationId)
    .in("template", PROGRAMME_TEMPLATES)
    .order("sent_at", { ascending: false })
    .limit(20);
  q = to.phone ? q.eq("to_address", to.phone) : q.eq("to_label", to.label);
  const rows = ((await q).data ?? []) as { template: string; body: string }[];
  const last = rows.findIndex((r) => r.template === "driver_programme");
  return last < 0 ? null : rows.slice(0, last + 1).map((r) => r.body).join("\n");
}

/**
 * The programme and the hotels for whoever drives this booking's city — its
 * driver once named, else the supplier its trips are with — covering every city
 * they have on this case and no other (driver-programme.ts recipientKey).
 */
export async function draftDriverProgramme(bookingId: string): Promise<{ ok: true; draft: ProgrammeDraft } | Fail> {
  const denied = await gateRow("operation_bookings", bookingId);
  if (denied) return { ok: false, error: denied };
  try {
    const supabase = await db();
    const { data: own } = await supabase.from("operation_bookings").select("operation_id").eq("id", bookingId).maybeSingle();
    const operationId = (own as { operation_id: string } | null)?.operation_id;
    if (!operationId) return { ok: false, error: "ops.err.notFound" };

    const [bookings, travelers, opRes] = await Promise.all([
      listBookings(operationId),
      listTravelers(operationId),
      supabase.from("operations").select("travel_start, travel_end, offers(serial, destination)").eq("id", operationId).maybeSingle(),
    ]);
    const cities = transportCities({ bookings, supplierWork: null });
    const mine = cities.find((c) => c.trips.some((t) => t.booking.id === bookingId));
    if (!mine) return { ok: false, error: "ops.err.notFound" };
    const key = recipientKey(mine);
    const covered = key ? cities.filter((c) => recipientKey(c) === key) : [mine];
    // the cities by their letters alone — «كوالا لمبور» is «كوالالمبور», «جده» is «جدة»
    const place = (s: string) => normAr(s).replace(/\s+/g, "");
    const mineAt = new Set(covered.map((c) => place(c.name)));
    const anyAt = new Set(cities.map((c) => place(c.name)));
    const hotelsOn = bookings.filter((b) => b.kind === "hotel" && b.status !== "cancelled");
    const stays = hotelsOn.filter((b) => mineAt.has(place(cityOf(b))));
    // A hotel whose city no drive of the case names (none written, or another spelling) is
    // nobody's by city: the one recipient of the whole trip gets it all the same; anyone
    // else is told it is missing — it used to drop out of the message without a word.
    const unplaced = hotelsOn.filter((b) => !anyAt.has(place(cityOf(b))));
    if (covered.length === cities.length) stays.push(...unplaced);

    const op = opRes.data as unknown as { travel_start: string | null; travel_end: string | null; offers: unknown } | null;
    const offer = one(op?.offers as { serial: string; destination: string | null } | { serial: string; destination: string | null }[] | null);
    // the guest the driver looks for: the passport's name, never the client's WhatsApp one (2026-10-18)
    const customer = leadName(travelers);

    // the catalogue: the hotels' names, addresses and links, the cities' places and countries, the airports' names
    const trips = covered.flatMap((c) => c.trips);
    const codes = [...new Set(trips.flatMap((t) => {
      const link = linkOf(t.booking.detail?.[DRV.flight]);
      return link ? [link.from, link.to] : [];
    }))];
    const cityNames = [...new Set([...covered.map((c) => c.name), ...stays.map(cityOf)].filter(Boolean))];
    type HotelRow = { id: string; arabic_name: string; city_id: string | null; english_name: string | null; address: string | null; contact_number: string | null; google_maps: string | null };
    type CityRow = { arabic_name: string; lat: number | null; lng: number | null; country_id: string | null };
    const [catalog, citiesRes, airportsRes] = await Promise.all([
      // the booking's own hotel (its catalogue id, else its name in its city) — never a namesake elsewhere
      catalogHotelsFor<HotelRow>(supabase, stays.map((s) => ({ ...s, city_name: cityOf(s) })), "english_name, address, contact_number, google_maps"),
      cityNames.length > 0 ? supabase.from("cities").select("arabic_name, lat, lng, country_id").in("arabic_name", cityNames) : Promise.resolve({ data: [] }),
      codes.length > 0 ? supabase.from("airports").select("code, arabic_name").in("code", codes) : Promise.resolve({ data: [] }),
    ]);
    const cityRows = (citiesRes.data ?? []) as CityRow[];
    const countryIds = [...new Set(cityRows.map((c) => c.country_id).filter((x): x is string => !!x))];
    const countries = countryIds.length > 0 ? (((await supabase.from("countries").select("arabic_name").in("id", countryIds)).data ?? []) as { arabic_name: string }[]) : [];
    const cityRow = (name: string) => cityRows.find((c) => normalizeName(c.arabic_name) === normalizeName(name));

    const input: ProgrammeInput = {
      serial: offer?.serial ?? "",
      from: op?.travel_start ?? null,
      to: op?.travel_end ?? null,
      customer,
      travellers: travelers.length,
      country: countries.map((c) => c.arabic_name).join("، ") || offer?.destination || "",
      trips: trips.map((t) => ({
        kind: t.kind,
        title: t.booking.title,
        city: cityOf(t.booking),
        date: t.booking.start_date,
        time: t.time,
        flight: t.booking.detail?.[DRV.flight] ?? "",
        car: carText(t.booking.detail),
      })),
      stays: stays.map((s) => {
        const h = catalog.pick({ ...s, city_name: cityOf(s) });
        const c = cityRow(cityOf(s));
        return {
          name: s.title,
          name_en: h?.english_name ?? null,
          city: cityOf(s),
          check_in: s.start_date,
          check_out: s.end_date,
          address: h?.address ?? null,
          phone: h?.contact_number ?? null,
          map: h?.google_maps ?? null,
          coords: c?.lat != null && c?.lng != null ? { lat: Number(c.lat), lng: Number(c.lng) } : null,
        };
      }),
      legs: bookings.filter((b) => b.kind === "flight" && b.status !== "cancelled").flatMap((b) => b.flight_legs ?? []),
      airports: Object.fromEntries(((airportsRes.data ?? []) as { code: string; arabic_name: string }[]).map((a) => [a.code, a.arabic_name])),
      // the driver works for us whoever sold the trip — he calls our operations line
      emergency: COMPANY.phone,
    };

    // to the driver once named, else to the agent the city's trips are with
    let to = { label: mine.driver.name || "السائق", phone: mine.driver.phone || null };
    if (!mine.driver.name && !mine.driver.phone && mine.supplierId) {
      const { data: s } = await supabase.from("company_suppliers").select("arabic_name, mobile, whatsapp").eq("id", mine.supplierId).maybeSingle();
      const sup = s as { arabic_name: string; mobile: string | null; whatsapp: string | null } | null;
      if (sup) to = { label: sup.arabic_name, phone: sup.whatsapp || sup.mobile || null };
    }

    const programme = programmeMessage(input);
    const hotels = hotelsMessage(input);
    const conversation = to.phone ? await conversationForPhone(to.phone) : null;
    return {
      ok: true,
      draft: {
        to_label: to.label,
        to_phone: to.phone,
        canSendWhatsapp: conversation !== null,
        cities: covered.map((c) => c.name).filter(Boolean),
        programme,
        hotels: hotels.body,
        update: programmeUpdate(await toldBefore(supabase, operationId, to), programme, input.serial),
        gaps: hotels.gaps,
        unplaced: covered.length === cities.length ? [] : unplaced.map((b) => `${b.title}${cityOf(b) ? ` — ${cityOf(b)}` : ""}`),
        serial: input.serial,
        customer,
      },
    };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** The arrival sign, as /welcome-board prints it — the company's own identity, the booking name. */
async function arrivalSign(serial: string): Promise<Uint8Array | null> {
  const source = await getWelcomeBoard(serial);
  if (!source) return null;
  const html = await renderDocHtml(() => createElement(WelcomeBoardDocument, { board: source.board }), source.font);
  return new Uint8Array(await offerDocumentToPdf(html));
}

/**
 * Send one of the reviewed messages, and keep what went out. The programme over
 * WhatsApp carries the arrival sign after it, as a PDF; by hand, the agent
 * attaches it (the button beside it prints it). The operation is read off the
 * booking, not taken from the browser: the log must land on the right case.
 */
export async function sendDriverProgramme(input: {
  booking_id: string;
  part: "programme" | "hotels" | "update";
  channel: "whatsapp" | "manual";
  to_label: string;
  to_phone: string | null;
  body: string;
}): Promise<{ ok: true } | Fail> {
  const denied = await gateRow("operation_bookings", input.booking_id);
  if (denied) return { ok: false, error: denied };
  if (!input.body.trim()) return { ok: false, error: "ops.err.emptyMessage" };
  try {
    const supabase = await db();
    const { data } = await supabase.from("operation_bookings").select("operation_id, operations(offers(serial))").eq("id", input.booking_id).maybeSingle();
    const row = data as unknown as { operation_id: string; operations: { offers: unknown } | { offers: unknown }[] | null } | null;
    if (!row) return { ok: false, error: "ops.err.notFound" };
    const serial = one(one(row.operations)?.offers as { serial: string } | { serial: string }[] | null)?.serial ?? "";

    let providerMessageId: string | null = null;
    let signed = false;
    if (input.channel === "whatsapp") {
      // an existing Teletel conversation only — a new one cannot be opened safely (teletel.ts)
      const conversationId = input.to_phone ? await conversationForPhone(input.to_phone) : null;
      if (!conversationId) return { ok: false, error: "ops.err.noConversation" };
      const sent = await sendTeletelMessage(conversationId, input.body);
      if (sent === null) return { ok: false, error: "ops.err.sendFailed" };
      providerMessageId = String(sent);
      if (input.part === "programme" && serial) {
        signed = true;
        // the PDF takes a browser and seconds: after the answer, as the client's programme is (client-whatsapp.ts)
        after(async () => {
          const bytes = await arrivalSign(serial).catch(() => null);
          if (bytes) await sendTeletelAttachment(conversationId, "📎 لوحة الاستقبال / Arrival sign", { name: `welcome-${serial}.pdf`, type: "application/pdf", bytes });
        });
      }
    }

    await supabase.from("operation_dispatches").insert({
      operation_id: row.operation_id,
      channel: input.channel,
      // a driver is the ground supplier's man — the existing audience, not a new one
      audience: "supplier",
      template: input.part === "hotels" ? "driver_hotels" : input.part === "update" ? "driver_update" : "driver_programme",
      to_label: input.to_label,
      to_address: input.to_phone,
      body: input.body,
      attachments: signed ? [{ kind: "welcome_board" }] : [],
      status: "sent",
      provider_message_id: providerMessageId,
      approved_by: await getCurrentEmployeeId(),
      sent_at: new Date().toISOString(),
    });
    await logAudit({
      action: "dispatch.sent",
      entity: "operation_bookings",
      entity_id: input.booking_id,
      meta: { channel: input.channel, to: input.to_label, template: `driver_${input.part}` },
    });
    return { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export type ScheduleRow = {
  id: string;
  operation_id: string;
  serial: string;
  customer: string | null;
  kind: ServiceKind;
  title: string;
  city: string;
  time: string;
  flight: string;
  meet: string;
  car: string;
  plate: string;
  driver: string;
  phone: string;
  pax: string;
  confirmed: boolean;
};

/** Every drive and tour of every live case on one date, in the order the cars leave — an own-files holder's cases only. */
export async function listDriverSchedule(date: string): Promise<ScheduleRow[]> {
  if (await gateOps()) return [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  try {
    const access = await opsAccess();
    const supabase = await db();
    const { data } = await supabase
      .from("operation_bookings")
      .select("id, operation_id, kind, title, city_name, start_date, detail, status, operations(execution_status, offers(serial, employee_id))")
      .eq("start_date", date)
      .in("kind", ["transport", "service"])
      .neq("status", "cancelled");
    const rows = (data ?? []) as unknown as {
      id: string;
      operation_id: string;
      kind: string;
      title: string;
      city_name: string;
      start_date: string | null;
      detail: Record<string, string> | null;
      status: string;
      operations: OpJoin | OpJoin[] | null;
    }[];
    // each case's guest as in the passport (leadName) — this sheet is copied to the drivers;
    // asked for the cases this holder may work only, the gate listTravelersByOperation keeps
    const mine = [...new Set(rows.filter((r) => mayWork(access, one(one(r.operations)?.offers)?.employee_id)).map((r) => r.operation_id))];
    const travelers = mine.length > 0 ? await listTravelersByOperation(mine) : {};
    return rows
      .flatMap((r): ScheduleRow[] => {
        const kind = driverServiceKind(r);
        const op = one(r.operations);
        if (!kind || op?.execution_status === "cancelled") return [];
        const offer = one(op?.offers);
        if (!mayWork(access, offer?.employee_id)) return [];
        const d = r.detail ?? {};
        return [
          {
            id: r.id,
            operation_id: r.operation_id,
            serial: offer?.serial ?? "",
            customer: leadName(travelers[r.operation_id] ?? []) || null,
            kind,
            title: r.title,
            city: r.city_name.trim(),
            time: meetTime(r),
            flight: d[DRV.flight] ?? "",
            meet: d[DRV.meet] ?? "",
            car: carText(d),
            plate: d[DRV.plate] ?? "",
            driver: d[DRV.driver] ?? "",
            phone: d[DRV.phone] ?? "",
            pax: d["الركاب"] ?? "",
            confirmed: r.status === "confirmed",
          },
        ];
      })
      .sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
  } catch {
    return [];
  }
}
