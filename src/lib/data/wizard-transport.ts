"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { gateOperation, gateRows } from "@/lib/operations/access";
import { assignBooking, listAssignees, sendBookingRequest, type AssigneeOption, type RequestDraft } from "@/lib/data/operation-assign";
import { confirmBookings, updateBooking } from "@/lib/data/operation-bookings";
import { attachSupplierConfirmation, composeRequest } from "@/lib/data/supplier-work";
import { normalizeName } from "@/lib/offer/pricing-suggest";
import { awaitingConfirmation } from "@/lib/operations/confirm-all";
import { DRV, driverServiceKind } from "@/lib/operations/drivers";
import { assigneesFor } from "@/lib/operations/supplier-request";
import { parseHotelConfirmation } from "@/lib/operations/wizard/hotels";
import { NO_SUPPLIER_KEY, NO_SUPPLIER_REF } from "@/lib/operations/wizard/transport";
import { uploadText } from "@/lib/repackage/extract/upload-text";

/**
 * «المواصلات» in the case wizard — a city's drives and tours handed, requested,
 * confirmed and given their driver as ONE.
 *
 * Each action gates the case and every booking (operations/access.ts), checks
 * that the ids are this case's drives and tours, and then runs the existing
 * per-booking action underneath — assignBooking, composeRequest /
 * sendBookingRequest, confirmBookings, updateBooking — so the audit log, the
 * request's clock, the salesperson's notice and the case's status move exactly
 * as they do one booking at a time on «عرض الكل».
 */

type Fail = { ok: false; error: TranslationKey };

const service = () => createSupabaseServiceClient() as unknown as SupabaseClient;

type Trip = {
  id: string;
  operation_id: string;
  kind: string;
  title: string;
  start_date: string | null;
  detail: Record<string, string> | null;
  status: string;
  assignee_kind: string;
  assignee_supplier_id: string | null;
  handoff_note: string | null;
};

/** The bookings named, once the caller may work them all and each is a drive or tour of THIS case. */
async function cityTrips(operationId: string, ids: string[]): Promise<{ trips: Trip[] } | Fail> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return { ok: false, error: "ops.err.notFound" };
  const denied = (await gateOperation(operationId)) ?? (await gateRows("operation_bookings", unique));
  if (denied) return { ok: false, error: denied };
  try {
    // service: 0063's supplier column is not granted to sessions — the gates above are the check
    const { data, error } = await service()
      .from("operation_bookings")
      .select("id, operation_id, kind, title, start_date, detail, status, assignee_kind, assignee_supplier_id, handoff_note")
      .in("id", unique);
    if (error) return { ok: false, error: "err.loadFailed" };
    const byId = new Map(((data ?? []) as Trip[]).map((t) => [t.id, t]));
    // in the order asked (the request numbers them so); an id from the browser never reaches
    // another case's booking, nor a hotel through this door
    const trips = unique.flatMap((id) => {
      const t = byId.get(id);
      return t && t.operation_id === operationId && driverServiceKind(t) ? [t] : [];
    });
    return trips.length === unique.length ? { trips } : { ok: false, error: "ops.err.notFound" };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** The open trips of a request, all with one supplier — or why they cannot go as one message. */
function oneSupplier(trips: Trip[]): { ids: string[] } | Fail {
  const open = trips.filter((t) => t.status !== "confirmed" && t.status !== "cancelled");
  if (open.length === 0) return { ok: false, error: "ops.confirmAll.none" };
  const supplier = open[0].assignee_supplier_id;
  if (!supplier || open.some((t) => t.assignee_kind !== "supplier" || t.assignee_supplier_id !== supplier)) {
    return { ok: false, error: "wz.transport.err.oneSupplier" };
  }
  return { ids: open.map((t) => t.id) };
}

export type TransportSetup = {
  /** our suppliers that sell transfers (or never said what they sell). */
  suppliers: AssigneeOption[];
  /** normalised city name → the supplier last handed a drive or tour there, on any case. */
  usual: Record<string, string>;
  /** normalised city name → the driver last written there, on any case (the owner, 2026-10-26: «بأقل الإدخالات») */
  usualDriver: Record<string, { name: string; phone: string }>;
};

/**
 * The picker's list and each city's usual agent. «Usual» is what the office
 * last did: the supplier most recently handed a drive or tour in that city,
 * whichever file it was on — nothing to maintain, and it follows the office
 * when it changes agent.
 */
export async function transportSuppliers(operationId: string, cities: string[]): Promise<TransportSetup> {
  const none: TransportSetup = { suppliers: [], usual: {}, usualDriver: {} };
  if (await gateOperation(operationId)) return none;
  try {
    // the one «ينفّذه» rule — the suppliers that sell transfers (a city's current one is kept by the card)
    const suppliers = assigneesFor(await listAssignees(), { kind: "transport", title: "" }, null, null).filter((a) => a.kind === "supplier");
    const names = [...new Set(cities.map((c) => c.trim()).filter(Boolean))].slice(0, 30);
    if (names.length === 0) return { suppliers, usual: {}, usualDriver: {} };
    const { data } = await service()
      .from("operation_bookings")
      .select("city_name, assignee_supplier_id, detail")
      .in("kind", ["transport", "service"])
      .in("city_name", names)
      .order("assigned_at", { ascending: false, nullsFirst: false })
      .limit(300);
    // only one the picker offers — a supplier since disabled is not suggested
    const offered = new Set(suppliers.map((s) => s.id));
    const usual: Record<string, string> = {};
    // the driver the office last wrote in that city — offered, never written for the clerk
    const usualDriver: Record<string, { name: string; phone: string }> = {};
    type Row = { city_name: string; assignee_supplier_id: string | null; detail: Record<string, string> | null };
    for (const r of (data ?? []) as Row[]) {
      const key = normalizeName(r.city_name);
      if (!key) continue;
      if (!usual[key] && r.assignee_supplier_id && offered.has(r.assignee_supplier_id)) usual[key] = r.assignee_supplier_id;
      const name = String(r.detail?.[DRV.driver] ?? "").trim();
      const phone = String(r.detail?.[DRV.phone] ?? "").trim();
      if (!usualDriver[key] && (name || phone)) usualDriver[key] = { name, phone };
    }
    return { suppliers, usual, usualDriver };
  } catch {
    return none;
  }
}

/**
 * Hand the city's trips to one supplier. A trip a supplier already confirmed
 * keeps it — its confirmation number and its cost are that supplier's.
 */
export async function assignCitySupplier(input: { operation_id: string; booking_ids: string[]; supplier_id: string }): Promise<{ ok: true; assigned: number } | Fail> {
  if (!input.supplier_id) return { ok: false, error: "ops.err.pickAssignee" };
  const res = await cityTrips(input.operation_id, input.booking_ids);
  if ("ok" in res) return res;
  const move = res.trips.filter(
    (t) => t.status !== "cancelled" && !(t.status === "confirmed" && t.assignee_kind === "supplier") && t.assignee_supplier_id !== input.supplier_id,
  );
  for (const t of move) {
    // the note the trip was handed with stays — assignBooking would otherwise clear it
    const done = await assignBooking({ booking_id: t.id, kind: "supplier", assignee_id: input.supplier_id, handoff_note: t.handoff_note });
    if (!done.ok) return done;
  }
  return { ok: true, assigned: move.length };
}

/**
 * «بدون مورد» (the owner, 2026-10-29: «خيار بدون مورد ويتم الأمر بنجاح دون
 * عرقلة»): the office runs the city's trips itself — no supplier, maybe no
 * driver yet. Each trip is handed to the operations team (assignBooking kind
 * "ops", which clears any supplier), carries the «بدون مورد» mark in its detail
 * (merged, never replacing the driver or the times), and is confirmed under
 * NO_SUPPLIER_REF through confirmBookings — so the city counts done, the case
 * moves on and the audit log reads like any other confirmation.
 */
export async function confirmCityWithoutSupplier(input: { operation_id: string; booking_ids: string[] }): Promise<{ ok: true; confirmed: number } | Fail> {
  const res = await cityTrips(input.operation_id, input.booking_ids);
  if ("ok" in res) return res;
  const open = res.trips.filter((t) => t.status !== "cancelled");
  if (open.length === 0) return { ok: false, error: "ops.confirmAll.none" };
  for (const t of open) {
    const handed = await assignBooking({ booking_id: t.id, kind: "ops", handoff_note: t.handoff_note });
    if (!handed.ok) return handed;
    const marked = await updateBooking({ id: t.id, detail: { ...(t.detail ?? {}), [NO_SUPPLIER_KEY]: "نعم" } });
    if (!marked.ok) return marked;
  }
  const waiting = open.filter((t) => awaitingConfirmation(t.status));
  if (waiting.length === 0) return { ok: true, confirmed: 0 };
  return confirmBookings({
    operation_id: input.operation_id,
    entries: waiting.map((t) => ({ booking_id: t.id, confirmation_number: NO_SUPPLIER_REF })),
  });
}

/** ONE request for the city's open trips, for review — composeRequest with the rest as `alsoIds`. */
export async function draftCityRequest(input: { operation_id: string; booking_ids: string[] }): Promise<{ ok: true; draft: RequestDraft } | Fail> {
  const res = await cityTrips(input.operation_id, input.booking_ids);
  if ("ok" in res) return res;
  const open = oneSupplier(res.trips);
  if ("ok" in open) return open;
  return composeRequest(open.ids[0], open.ids.slice(1));
}

/** Send the reviewed request once; every open trip of the city is marked asked. */
export async function sendCityRequest(input: {
  operation_id: string;
  booking_ids: string[];
  channel: "whatsapp" | "manual";
  to_label: string;
  to_phone: string | null;
  body: string;
}): Promise<{ ok: true } | Fail> {
  const res = await cityTrips(input.operation_id, input.booking_ids);
  if ("ok" in res) return res;
  const open = oneSupplier(res.trips);
  if ("ok" in open) return open;
  return sendBookingRequest({
    booking_id: open.ids[0],
    also_ids: open.ids.slice(1),
    operation_id: input.operation_id,
    channel: input.channel,
    to_label: input.to_label,
    to_phone: input.to_phone,
    body: input.body,
  });
}

/** «تأكيد الكل للمدينة»: the supplier's one reference on every trip still waiting — confirmBookings. */
export async function confirmCity(input: { operation_id: string; booking_ids: string[]; confirmation_number: string }): Promise<{ ok: true; confirmed: number } | Fail> {
  const res = await cityTrips(input.operation_id, input.booking_ids);
  if ("ok" in res) return res;
  return confirmBookings({
    operation_id: input.operation_id,
    entries: res.trips.map((t) => ({ booking_id: t.id, confirmation_number: input.confirmation_number })),
  });
}

/**
 * The supplier's confirmation for the city (PDF or photo): filed ONCE and
 * pointed at by every confirmed trip of the city (supplier-work.ts
 * attachSupplierConfirmation — one paper, every booking it covers). The city's
 * number — typed, or with none typed read off the paper — confirms the trips
 * still waiting under it, through confirmBookings like «تأكيد الكل للمدينة».
 * A paper with no trip to land on (nothing confirmed, no number) is refused.
 */
export async function attachCityConfirmation(formData: FormData): Promise<{ ok: true; number: string | null } | Fail> {
  const operationId = String(formData.get("operation_id") ?? "");
  const ids = String(formData.get("booking_ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const res = await cityTrips(operationId, ids);
  if ("ok" in res) return res;
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "ops.err.noFile" };

  const open = res.trips.filter((t) => awaitingConfirmation(t.status));
  let number = String(formData.get("confirmation_number") ?? "").trim().slice(0, 40);
  if (!number && open.length > 0) {
    // the labels a confirmation prints its number under are the same for a hotel and a transfer
    const text = await uploadText(formData, "ground transport booking confirmation").catch(() => null);
    if (text?.ok) number = parseHotelConfirmation(text.text).confirmation;
  }
  const targets = res.trips.filter((t) => t.status === "confirmed" || (number && awaitingConfirmation(t.status)));
  if (targets.length === 0) return { ok: false, error: "wz.transport.err.paperNumber" };

  const paper = new FormData();
  paper.set("booking_ids", targets.map((t) => t.id).join(","));
  paper.set("file", file);
  const filed = await attachSupplierConfirmation(paper);
  if (!filed.ok) return filed;
  if (number && open.length > 0) {
    const done = await confirmBookings({ operation_id: operationId, entries: open.map((t) => ({ booking_id: t.id, confirmation_number: number })) });
    if (!done.ok) return done;
  }
  return { ok: true, number: number || null };
}

/**
 * The driver typed once, on the trips given (transport.ts driverTargets: the
 * city's, or the one trip whose driver differs). Through updateBooking, as the
 * driver card saves it; an emptied field is dropped, as there.
 */
export async function setTripsDriver(input: { operation_id: string; booking_ids: string[]; name: string; phone: string }): Promise<{ ok: true } | Fail> {
  const res = await cityTrips(input.operation_id, input.booking_ids);
  if ("ok" in res) return res;
  for (const t of res.trips) {
    const detail: Record<string, string> = { ...(t.detail ?? {}), [DRV.driver]: input.name.trim(), [DRV.phone]: input.phone.trim() };
    for (const k of [DRV.driver, DRV.phone]) if (!detail[k]) delete detail[k];
    const done = await updateBooking({ id: t.id, detail });
    if (!done.ok) return done;
  }
  return { ok: true };
}
