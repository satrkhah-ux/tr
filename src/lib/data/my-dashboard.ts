import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { getCurrentEmployeeId } from "./metrics";
import { listMyOpenDraftRows } from "./draft-store";
import { getRates } from "./rates-actions";
import { myFollowUps } from "./wizard-case";
import { normalizeDraftData, STAGES, type StageKey } from "@/lib/offer/draft-types";
import { validateDraft } from "@/lib/offer/draft-validation";
import { draftSellTotal } from "@/lib/offer/preview-dto";
import { offerSarTotal } from "@/lib/offer/pricing";
import { isLiveCase } from "@/lib/operations/summary";
import { riyadhDate } from "@/lib/operations/payments";
import type { ClientStatus, ExecutionStatus } from "@/lib/operations/state";
import type { OfferStatus } from "@/lib/types";
import {
  clientsOf,
  countryResolver,
  summarizeMine,
  type MyDashboard,
  type MyDraft,
  type MyOffer,
} from "@/lib/dashboard/my-stats";

/**
 * «لوحتي» — what the signed-in employee issued, left unfinished and got
 * confirmed, loaded once per /dashboard request.
 *
 * NOT a server action: nothing here is callable from a browser, and the
 * employee is resolved from the session (getCurrentEmployeeId), so no request
 * can name someone else's id. Three reads, whatever the number of files:
 *   · offers with their client, operation and cities embedded (one join on the
 *     session client — staff read offers/operations/customers under is_staff());
 *   · my unissued drafts (draft-store: offer_drafts is service-only);
 *   · the country/city catalogue, to put «كوالالمبور» under ماليزيا.
 * Only SELL totals leave this file — no buy, net or profit column is selected,
 * so the dashboard needs no pricing.internal check.
 */

type OfferRow = {
  id: string;
  serial: string;
  customer_id: string | null;
  destination: string | null;
  offer_date: string | null;
  total: number | null;
  total_sar: number | null;
  currency: string | null;
  status: OfferStatus;
  created_at: string;
  customers: One<{ arabic_name: string | null; mobile: string | null }>;
  operations: One<{
    id: string;
    client_status: string;
    execution_status: string;
    travel_start: string | null;
    travel_end: string | null;
    updated_at: string | null;
  }>;
  offer_cities: { city_name: string | null; sort: number | null; check_in: string | null; check_out: string | null }[] | null;
};

/** A to-one embed comes back as an object, or as a one-row array when PostgREST cannot tell. */
type One<T> = T | T[] | null;
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

const GATED = new Set<StageKey>(STAGES.filter((s) => s.gated).map((s) => s.key));

export async function getMyDashboard(): Promise<MyDashboard> {
  try {
    if (!(await getServerUser())) return { ok: false, reason: "forbidden" };
    const [admin, employee] = await Promise.all([currentCan("dashboard.admin"), currentCan("dashboard.employee")]);
    if (!admin && !employee) return { ok: false, reason: "forbidden" };
    const me = await getCurrentEmployeeId();
    if (!me) return { ok: false, reason: "noEmployee" };

    const db = (await createSupabaseServerClient()) as unknown as SupabaseClient;
    const [offersRes, draftRows, countriesRes, citiesRes, rates, canPricing, followUp] = await Promise.all([
      // ponytail: one account's whole history in one read (PostgREST caps it at 1000 rows);
      // move the lists to server paging + SQL counts if an account ever passes that.
      db
        .from("offers")
        .select(
          "id, serial, customer_id, destination, offer_date, total, total_sar, currency, status, created_at, customers(arabic_name, mobile), operations(id, client_status, execution_status, travel_start, travel_end, updated_at), offer_cities(city_name, sort, check_in, check_out)",
        )
        .eq("employee_id", me)
        .order("created_at", { ascending: false })
        .limit(1000),
      listMyOpenDraftRows(),
      db.from("countries").select("arabic_name"),
      db.from("cities").select("arabic_name, countries(arabic_name)"),
      getRates(),
      currentCan("pricing.view"),
      // «قائمة متابعتك اليوم» — the cases I answer for whose «ينتظر» day has come
      myFollowUps(db, me),
    ]);
    if (offersRes.error) return { ok: false, reason: "error" };

    const resolve = countryResolver(
      ((countriesRes.data ?? []) as { arabic_name: string | null }[]).map((c) => c.arabic_name ?? "").filter(Boolean),
      ((citiesRes.data ?? []) as { arabic_name: string | null; countries: One<{ arabic_name: string | null }> }[]).map((c) => ({
        name: c.arabic_name ?? "",
        country: one(c.countries)?.arabic_name ?? null,
      })),
    );

    const offers: MyOffer[] = ((offersRes.data ?? []) as unknown as OfferRow[]).map((row) => {
      const customer = one(row.customers);
      const op = one(row.operations);
      const stops = [...(row.offer_cities ?? [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
      const cities = stops.map((c) => c.city_name?.trim() ?? "").filter(Boolean);
      const checkIns = stops.map((c) => c.check_in).filter((d): d is string => Boolean(d)).sort();
      const checkOuts = stops.map((c) => c.check_out).filter((d): d is string => Boolean(d)).sort();
      return {
        id: row.id,
        serial: row.serial,
        customerId: row.customer_id,
        client: customer?.arabic_name ?? null,
        phone: customer?.mobile ?? null,
        destination: row.destination,
        country: resolve({ destination: row.destination, cities }),
        cities,
        // the operation's dates are the booked ones; else the programme's stays; else the offer's start
        start: op?.travel_start ?? checkIns[0] ?? row.offer_date,
        end: op?.travel_end ?? checkOuts.at(-1) ?? null,
        total: row.total,
        currency: row.currency,
        totalSar: offerSarTotal(row),
        status: row.status,
        createdAt: row.created_at,
        updatedAt: op?.updated_at && op.updated_at > row.created_at ? op.updated_at : row.created_at,
        operation: op
          ? {
              id: op.id,
              clientStatus: op.client_status,
              executionStatus: op.execution_status,
              live: isLiveCase({ client_status: op.client_status as ClientStatus, execution_status: op.execution_status as ExecutionStatus }),
            }
          : null,
      };
    });

    const drafts: MyDraft[] = draftRows.map((row) => {
      const draft = normalizeDraftData(row.data);
      const partner = Boolean(draft.customer.partner_company_id);
      let missing: StageKey[] = [];
      try {
        // Basic asks for the client's name and phone before anything else, so
        // they count as missing here too; then whatever blocks the issue —
        // the same validateDraft the issue button obeys.
        const clientGap = !partner && (!draft.customer.customer_name.trim() || !draft.customer.customer_phone.trim());
        missing = [
          ...new Set<StageKey>([...(clientGap ? (["customer"] as const) : []), ...validateDraft(draft, { partnerFile: partner }).blocking.map((i) => i.stage)]),
        ].filter((s) => canPricing || !GATED.has(s));
      } catch {
        /* one odd draft must not take the whole dashboard down — it shows without its gaps */
      }
      const total = draftSellTotal(draft, rates.sarPer);
      return {
        id: row.id,
        title: row.title,
        client: draft.customer.customer_name.trim() || null,
        phone: draft.customer.customer_phone.trim() || null,
        country: draft.trip.country.trim() || draft.trip.destination.trim() || null,
        cities: draft.cities.map((c) => c.city_name.trim()).filter(Boolean),
        start: draft.trip.arrival_date,
        end: draft.trip.departure_date,
        total: total && total > 0 ? total : null,
        currency: draft.pricing.display_currency || null,
        missing,
        updatedAt: row.updated_at,
      };
    });

    return { ok: true, offers, drafts, clients: clientsOf(offers), stats: summarizeMine(offers, drafts.length, riyadhDate()), followUp };
  } catch {
    return { ok: false, reason: "error" };
  }
}
