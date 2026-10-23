import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { offerTotals, ratesFor } from "@/lib/offer/pricing";
import { createSupabaseServerClient, createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { normAr } from "@/lib/catalog/norm";
import { offerHotelCity } from "@/lib/operations/seed-plan";
import { ensureCatalogHotel } from "./hotel-data-request";
import { getCurrentEmployeeId } from "./metrics";
import { getRates } from "./rates-actions";
import type { CreateOfferInput, CreateOfferResult } from "./offers";

async function db(): Promise<SupabaseClient> {
  return (await createSupabaseServerClient()) as unknown as SupabaseClient;
}

function generateSerial(): string {
  // the company's day — the server runs on UTC, and an offer issued after midnight in Madinah carried yesterday
  const stamp = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" }).replaceAll("-", "");
  const employeeNo = Math.floor(Math.random() * 9) + 1;
  const seq = Math.floor(Math.random() * 9000) + 1000;
  return `AD-${employeeNo}-${seq}-${stamp}`;
}

/**
 * Creates an offer + all children + pricing + first revision — the TRUSTED path.
 *
 * Not a server action, on purpose: whatever a "use server" file exports, a
 * browser can call with arguments of its own choosing, and this writes what an
 * offer was bought at. Its callers compute those figures on the server — the
 * producer from the stored draft, the repackage wizard from the import — and the
 * builder's action (offers.ts createOffer) passes a buy figure only from
 * pricing.internal.
 *
 * The cost tables (offer_hotels, offer_pricing_items, pricings) take no write
 * from any session since 0047 — an inserted buy price was a forged profit on the
 * executive dashboard — so they go through the service role, and only for the
 * offer the caller's own session has just created: that insert is RLS-checked,
 * so is_staff() still decides who gets this far.
 *
 * `asPartner` — a partner company issuing ITS OWN file (the owner, 2026-10-13:
 * the partner produces its offers itself). RLS lets no partner insert an offer,
 * so the whole offer goes through the service role, filed under that company
 * whatever the input says. The caller has checked the draft is theirs.
 */
export async function insertOffer(input: CreateOfferInput, asPartner?: string): Promise<CreateOfferResult> {
  try {
    const user = await getServerUser();
    if (!user) return { ok: false, error: "err.session" };
    if (!input.destination.trim()) return { ok: false, error: "err.destinationRequired" };

    const supabase = asPartner ? (createSupabaseServiceClient() as unknown as SupabaseClient) : await db();
    const serial = generateSerial();

    // «الموظف المختص» on the printed document. The builder picks an employee
    // explicitly; the generator and the repackage wizard do not, so the offer is
    // stamped with whoever is signed in — otherwise the field prints empty and
    // management cannot tell who issued the offer.
    const employee_id = input.employee_id ?? (await getCurrentEmployeeId());

    const { data: offer, error: offerError } = await supabase
      .from("offers")
      .insert({
        serial,
        customer_id: input.customer_id,
        employee_id,
        destination: input.destination.trim(),
        duration: input.duration,
        offer_date: input.offer_date,
        adults: input.adults,
        children: input.children,
        infants: input.infants,
        total: input.total,
        // Left out by the builder and the repackage wizard: converted here, or a
        // USD offer would count as nothing in the KPIs.
        total_sar: await totalSar(input),
        currency: input.currency,
        status: "draft",
        pipeline_stage: "active_not_confirmed",
        source_kind: input.source_kind ?? "direct",
        source_supplier_id: input.source_supplier_id ?? null,
        source_import_id: input.source_import_id ?? null,
        partner_company_id: asPartner ?? input.partner_company_id ?? null,
        show_prices: input.show_prices ?? true,
        partner_cost: input.partner_cost ?? null,
      })
      .select("id")
      .single();
    if (offerError || !offer) return { ok: false, error: "err.saveOfferFailed" };

    const offerId = offer.id;

    const cost = createSupabaseServiceClient() as unknown as SupabaseClient;
    await insertChildren(supabase, cost, offerId, await withCatalogHotels(cost, input, serial));

    await cost.from("pricings").insert({ offer_id: offerId, ...pricingRow(input) });
    await supabase.from("offer_revisions").insert({ offer_id: offerId, revision: 1, note: "created via builder" });

    return { ok: true, serial, id: offerId };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/**
 * «إصدار نسخة محدّثة» — the SAME offer re-filled from its corrected draft: the
 * head's figures updated and every printed row replaced. Serial, issuer,
 * status, pipeline stage, company and «with prices» stay as they are. Trusted
 * path like insertOffer: its one caller (produceOfferFromDraft) builds `input`
 * from the stored draft and has checked offers.write and the partner-file lock.
 *
 * A failure never leaves the offer with fewer rows than it had: the new rows go
 * in FIRST, and the old ones (their ids read up front) are deleted only after
 * every write landed. A failed write deletes what this call added — every row of
 * the offer that is not an old one — and the old rows stay. offer_days cannot
 * hold both copies (unique on offer_id + day_number), so it is UPSERTED on that
 * key in one statement after the other inserts, and the days the new programme
 * no longer has go with the old rows.
 *
 * ponytail: still not one transaction — a head update failing after the days
 * upsert leaves the new days beside the old rows, and a failed delete leaves
 * both copies (more rows, never fewer). Pressing the button again repairs
 * either: every row present then counts as old. The client link is untouched
 * meanwhile — it reads the last published render. An RPC makes it atomic if
 * that ever bites.
 */
export async function replaceOffer(serial: string, input: CreateOfferInput): Promise<CreateOfferResult> {
  try {
    if (!(await getServerUser())) return { ok: false, error: "err.session" };
    const supabase = await db();
    const cost = createSupabaseServiceClient() as unknown as SupabaseClient;
    const { data: offer } = await supabase.from("offers").select("id").eq("serial", serial).maybeSingle();
    if (!offer) return { ok: false, error: "err.loadFailed" };
    const offerId = (offer as { id: string }).id;
    const failed: CreateOfferResult = { ok: false, error: "err.saveOfferFailed" };

    // the rows being replaced — offer_hotels first: it points at offer_cities
    const tables = [
      { table: "offer_hotels", via: cost },
      { table: "offer_pricing_items", via: cost },
      ...["offer_cities", "offer_flights", "offer_services", "offer_terms"].map((table) => ({ table, via: supabase })),
    ];
    const old = new Map<string, string[]>();
    for (const { table, via } of tables) {
      const { data, error } = await via.from(table).select("id").eq("offer_id", offerId);
      if (error) return failed;
      old.set(table, ((data ?? []) as { id: string }[]).map((r) => r.id));
    }
    /** Undo this call's inserts: every row of the offer that is not an old one. */
    const rollback = async (): Promise<CreateOfferResult> => {
      for (const { table, via } of tables) {
        const keep = old.get(table) ?? [];
        const rows = via.from(table).delete().eq("offer_id", offerId);
        await (keep.length ? rows.not("id", "in", `(${keep.join(",")})`) : rows);
      }
      return failed;
    };

    if (!(await insertChildren(supabase, cost, offerId, { ...(await withCatalogHotels(cost, input, serial)), days: [] }))) return rollback();
    const days = input.days ?? [];
    if (days.length && (await supabase.from("offer_days").upsert(dayRows(offerId, days), { onConflict: "offer_id,day_number" })).error) {
      return rollback();
    }

    const { error: headError } = await supabase
      .from("offers")
      .update({
        customer_id: input.customer_id,
        destination: input.destination.trim(),
        duration: input.duration,
        offer_date: input.offer_date,
        adults: input.adults,
        children: input.children,
        infants: input.infants,
        total: input.total,
        total_sar: await totalSar(input),
        currency: input.currency,
        partner_cost: input.partner_cost ?? null,
      })
      .eq("id", offerId);
    if (headError) return rollback();
    await cost.from("pricings").upsert({ offer_id: offerId, ...pricingRow(input) }, { onConflict: "offer_id" });

    // every write landed: now the old rows go
    for (const { table, via } of tables) {
      const ids = old.get(table) ?? [];
      if (ids.length && (await via.from(table).delete().in("id", ids)).error) return failed;
    }
    const gone = supabase.from("offer_days").delete().eq("offer_id", offerId);
    const kept = days.map((d) => d.day_number);
    if ((await (kept.length ? gone.not("day_number", "in", `(${kept.join(",")})`) : gone)).error) return failed;

    const { data: last } = await supabase
      .from("offer_revisions")
      .select("revision")
      .eq("offer_id", offerId)
      .order("revision", { ascending: false })
      .limit(1)
      .maybeSingle();
    const revision = ((last as { revision: number } | null)?.revision ?? 0) + 1;
    await supabase.from("offer_revisions").insert({ offer_id: offerId, revision, note: "re-issued from its draft" });

    return { ok: true, serial, id: offerId };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/**
 * A hotel typed by hand (a line with no catalogue id) joins /hotels in its
 * city, its data asked of the data team (hotel-data-request.ts) — the line
 * keeps that id, so the pull, the voucher and a merge all reach it. One at a
 * time, the same name once: two stays in one hotel make one row.
 */
async function withCatalogHotels(cost: SupabaseClient, input: CreateOfferInput, serial: string): Promise<CreateOfferInput> {
  if (!input.hotels?.some((h) => !h.hotel_id && h.hotel_name?.trim())) return input;
  const by = await getCurrentEmployeeId();
  const made = new Map<string, string | null>();
  const stops = input.cities.map((c, i) => ({ ...c, id: `#${i}` }));
  const hotels = [];
  for (const h of input.hotels) {
    const name = h.hotel_name?.trim();
    if (h.hotel_id || !name) {
      hotels.push(h);
      continue;
    }
    // the stop that prints it, else the one its check-in falls in (seed-plan.ts, as the pull reads it)
    const city = offerHotelCity({ hotel_name: name, check_in: h.check_in }, stops) || null;
    const key = `${normAr(name)}|${normAr(city)}`;
    if (!made.has(key)) made.set(key, await ensureCatalogHotel(cost, { name, city, serial, by }));
    hotels.push({ ...h, hotel_id: made.get(key) ?? null });
  }
  return { ...input, hotels };
}

/** `total` in riyals for the KPIs — converted at today's rates when the caller left it out. */
async function totalSar(input: CreateOfferInput): Promise<number | null> {
  if (input.total_sar !== undefined) return input.total_sar;
  if (!input.currency || input.currency === "SAR") return input.total;
  return offerTotals([], (await getRates()).sarPer, input.currency, input.total).total_sar;
}

/**
 * Everything an offer prints, under `offerId`: cities, flights, days, hotels,
 * pricing lines, services, terms. The cost tables through the service role (see
 * insertOffer). True when every write landed.
 */
async function insertChildren(supabase: SupabaseClient, cost: SupabaseClient, offerId: string, input: CreateOfferInput): Promise<boolean> {
  const writes: PromiseLike<{ error: unknown }>[] = [];
  if (input.cities.length > 0) {
    writes.push(supabase.from("offer_cities").insert(
      input.cities.map((c, index) => ({
        offer_id: offerId,
        city_name: c.city_name,
        hotel_name: c.hotel_name,
        room_type: c.room_type,
        nights: c.nights,
        check_in: c.check_in,
        check_out: c.check_out,
        meals: c.meals,
        sort: index,
      })),
    ));
  }
  if (input.flights.length > 0) {
    writes.push(supabase.from("offer_flights").insert(
      input.flights.map((f, index) => ({
        offer_id: offerId,
        carrier: f.carrier,
        from_airport: f.from_airport,
        to_airport: f.to_airport,
        flight_date: f.flight_date,
        passengers: f.passengers,
        baggage: f.baggage,
        airline: f.airline ?? null,
        flight_no: f.flight_no ?? null,
        departure_at: f.departure_at ?? null,
        arrival_at: f.arrival_at ?? null,
        cabin_class: f.cabin_class ?? null,
        baggage_allowance: f.baggage_allowance ?? null,
        airline_iata: f.airline_iata ?? null,
        leg_order: f.leg_order ?? null,
        sort: index,
      })),
    ));
  }
  if (input.days && input.days.length > 0) {
    writes.push(supabase.from("offer_days").insert(dayRows(offerId, input.days)));
  }
  if (input.hotels && input.hotels.length > 0) {
    writes.push(cost.from("offer_hotels").insert(
      input.hotels.map((h, index) => ({
        offer_id: offerId,
        offer_city_id: h.offer_city_id ?? null,
        hotel_id: h.hotel_id ?? null,
        hotel_name: h.hotel_name,
        room_type_id: h.room_type_id,
        rooms_count: h.rooms_count,
        board_type: h.board_type,
        check_in: h.check_in,
        check_out: h.check_out,
        nights: h.nights,
        buy_price: h.buy_price,
        buy_currency: h.buy_currency,
        sell_price: h.sell_price,
        sell_currency: h.sell_currency,
        // supplier sourcing (migration 0014); safe defaults when absent
        cancellation_policy: h.cancellation_policy ?? null,
        excluded_surcharges: h.excluded_surcharges ?? [],
        valid_until: h.valid_until ?? null,
        supplier_id: h.supplier_id ?? null,
        supplier_name: h.supplier_name ?? null,
        rate_key: h.rate_key ?? null,
        net_base: h.net_base ?? null,
        net_source_currency: h.net_source_currency ?? null,
        fx_rate: h.fx_rate ?? null,
        fx_date: h.fx_date ?? null,
        ref_sell_base: h.ref_sell_base ?? null,
        markup_amount: h.markup_amount ?? null,
        markup_pct: h.markup_pct ?? null,
        image_url: h.image_url ?? null,
        facilities: h.facilities ?? [],
        content_star_rating: h.content_star_rating ?? null,
        room_type_name: h.room_type_name ?? null,
        sort: index,
      })),
    ));
  }
  if (input.pricing_items && input.pricing_items.length > 0) {
    writes.push(cost.from("offer_pricing_items").insert(
      input.pricing_items.map((p, index) => {
        const qty = Number.isFinite(p.quantity) && p.quantity > 0 ? p.quantity : 1;
        const total_buy = p.buy_price == null ? null : Number((p.buy_price * qty).toFixed(2));
        const total_sell = p.sell_price == null ? null : Number((p.sell_price * qty).toFixed(2));
        return {
          offer_id: offerId,
          item_type: p.item_type,
          item_id: p.item_id ?? null,
          description: p.description,
          quantity: qty,
          buy_price: p.buy_price,
          buy_currency: p.buy_currency,
          sell_price: p.sell_price,
          sell_currency: p.sell_currency,
          total_buy,
          total_sell,
          sort: index,
        };
      }),
    ));
  }
  if (input.services.length > 0) {
    writes.push(supabase.from("offer_services").insert(
      input.services.map((s, index) => ({ offer_id: offerId, label: s.label, kind: s.kind, sort: index })),
    ));
  }
  if (input.terms.length > 0) {
    writes.push(supabase.from("offer_terms").insert(
      input.terms.map((text, index) => ({ offer_id: offerId, text, sort: index })),
    ));
  }
  return (await Promise.all(writes)).every((w) => !w.error);
}

/** The programme's day rows — every column, so replaceOffer's upsert leaves nothing of the old day behind. */
function dayRows(offerId: string, days: NonNullable<CreateOfferInput["days"]>) {
  return days.map((d) => ({
    offer_id: offerId,
    day_number: d.day_number,
    day_date: d.day_date,
    city_name: d.city_name,
    title: d.title,
    activities: d.activities,
    temp_max: d.temp_max,
    temp_min: d.temp_min,
    rain_chance: d.rain_chance,
    weather_code: d.weather_code,
    weather_source: d.weather_source,
    weather_fetched_at: d.weather_fetched_at,
    transport_note: d.transport_note ?? null,
  }));
}

/** The offer's pricings row (cost table): totals, profit and the rates it was priced at. */
function pricingRow(input: CreateOfferInput) {
  const profit =
    input.total != null && input.buy_total != null ? Number((input.total - input.buy_total).toFixed(2)) : null;
  return {
    total: input.total,
    currency: input.currency,
    buy_total: input.buy_total,
    sell_total: input.total,
    profit,
    ...(input.fx
      ? {
          fx_rates: ratesFor(input.fx.sarPer, [
            input.currency,
            ...(input.pricing_items ?? []).flatMap((p) => [p.buy_currency, p.sell_currency]),
            ...(input.hotels ?? []).flatMap((h) => [h.buy_currency, h.sell_currency]),
          ]),
          fx_source: input.fx.source,
          fx_date: input.fx.updatedAt,
        }
      : {}),
  };
}
