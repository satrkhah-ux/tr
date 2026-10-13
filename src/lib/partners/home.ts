"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { CLIENT_DOCUMENT_KINDS, type VoucherKind } from "@/lib/operations/voucher-dto";
import { lastTwoMonths, monthReport, type MonthReport } from "./report";
import { listPartnerFiles } from "./drafts";
import { getPartnerSession } from "./session";

/**
 * The numbers a partner's home screen is made of.
 *
 * Everything here is derived from rows the database would hand them anyway
 * (0035 for their files and offers, 0037 for operations and payments), so the
 * user client throughout — no service-role shortcut that could out-run a policy.
 * One exception: the client documents of operations that query already proved
 * are theirs (operation_documents has no partner policy), client kinds only.
 */

export type DestinationUse = { name: string; count: number };

export type PartnerRequest = {
  operation_id: string;
  serial: string | null;
  client_status: string;
  execution_status: string;
  travel_start: string | null;
  /** the traveller's link (/trip), once minted and not stopped. */
  client_token: string | null;
  /** the client's documents, newest version of each kind — never the internal summary. */
  documents: { kind: VoucherKind; token: string }[];
};

/** An offer the partner issued whose client has not confirmed yet. */
export type PartnerAwaiting = {
  serial: string;
  destination: string | null;
  travelers: number;
  travel_date: string | null;
  /** the file it was issued from — «جدّد التسعير» copies it. */
  draft_id: string;
  /** the last day its prices hold (0060); null for offers issued before validity existed. */
  valid_until: string | null;
  expired: boolean;
  total: number | null;
  currency: string | null;
  /** renewed from an expired offer: what that one cost, to show the difference. */
  was: { serial: string; total: number | null; currency: string | null } | null;
  /** this expired offer was already renewed into a new file. */
  renewed: boolean;
};

export type LedgerEntry = {
  paid_at: string;
  amount: number;
  currency: string;
  kind: string;
  serial: string | null;
};

export type PartnerHomeData = {
  files: number;
  issued: number;
  requests: PartnerRequest[];
  awaiting: PartnerAwaiting[];
  /** «تقريركم الشهري»: this month and the one before. */
  reports: MonthReport[];
  destinations: DestinationUse[];
  ledger: LedgerEntry[];
  /** Payments minus refunds, per currency — a single total would add riyals to dollars. */
  balances: { currency: string; net: number }[];
};

const EMPTY: PartnerHomeData = {
  files: 0,
  issued: 0,
  requests: [],
  awaiting: [],
  reports: [],
  destinations: [],
  ledger: [],
  balances: [],
};

export async function getPartnerHome(): Promise<PartnerHomeData> {
  const partner = await getPartnerSession();
  if (!partner) return EMPTY;

  const files = await listPartnerFiles();

  // Destination tally: which countries they actually sell, and how often. Named
  // by whatever the file calls its destination, because that is the string the
  // partner typed and the one they will recognise.
  const tally = new Map<string, number>();
  for (const file of files) {
    const name = (file.destination ?? "").trim();
    if (name) tally.set(name, (tally.get(name) ?? 0) + 1);
  }
  const destinations = [...tally.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ar"));

  let requests: PartnerRequest[] = [];
  let ledger: LedgerEntry[] = [];

  try {
    const supabase = (await createSupabaseServerClient()) as unknown as SupabaseClient;

    const { data: opsRows } = await supabase
      .from("operations")
      .select("id, client_status, execution_status, travel_start, client_token, client_token_revoked_at, offers!inner(serial)")
      .order("confirmed_at", { ascending: false })
      .limit(100);

    type OpRow = {
      id: string;
      client_status: string;
      execution_status: string;
      travel_start: string | null;
      client_token: string | null;
      client_token_revoked_at: string | null;
      offers: { serial: string | null } | { serial: string | null }[] | null;
    };
    const ops = (opsRows ?? []) as OpRow[];
    const serialOf = (row: OpRow) =>
      (Array.isArray(row.offers) ? row.offers[0]?.serial : row.offers?.serial) ?? null;

    // ids from the partner's own RLS-filtered read above — the only ones looked up here
    const docs = new Map<string, Map<VoucherKind, string>>();
    if (ops.length > 0) {
      const { data: docRows } = await (createSupabaseServiceClient() as unknown as SupabaseClient)
        .from("operation_documents")
        .select("operation_id, kind, token")
        .in(
          "operation_id",
          ops.map((row) => row.id),
        )
        .in("kind", CLIENT_DOCUMENT_KINDS)
        .is("revoked_at", null)
        .order("version", { ascending: true });
      for (const d of (docRows ?? []) as { operation_id: string; kind: VoucherKind; token: string }[]) {
        // ascending, so the last write per kind is the newest version
        docs.set(d.operation_id, (docs.get(d.operation_id) ?? new Map()).set(d.kind, d.token));
      }
    }

    requests = ops.map((row) => ({
      operation_id: row.id,
      serial: serialOf(row),
      client_status: row.client_status,
      execution_status: row.execution_status,
      travel_start: row.travel_start,
      client_token: row.client_token && !row.client_token_revoked_at ? row.client_token : null,
      documents: [...(docs.get(row.id) ?? new Map<VoucherKind, string>()).entries()].map(([kind, token]) => ({ kind, token })),
    }));

    if (ops.length > 0) {
      const bySerial = new Map(ops.map((row) => [row.id, serialOf(row)]));
      const { data: payRows } = await supabase
        .from("operation_payments")
        .select("operation_id, amount, currency, kind, paid_at")
        .in(
          "operation_id",
          ops.map((row) => row.id),
        )
        .order("paid_at", { ascending: false })
        .limit(200);

      ledger = ((payRows ?? []) as {
        operation_id: string;
        amount: number | string;
        currency: string;
        kind: string;
        paid_at: string;
      }[]).map((row) => ({
        paid_at: row.paid_at,
        amount: Number(row.amount) || 0,
        currency: row.currency || "SAR",
        kind: row.kind,
        serial: bySerial.get(row.operation_id) ?? null,
      }));
    }
  } catch {
    // A partner with no confirmed file yet is the common case, not a failure.
  }

  // A refund is stored positive with kind='refund' — the sign lives here, once.
  const nets = new Map<string, number>();
  for (const entry of ledger) {
    const signed = entry.kind === "refund" ? -entry.amount : entry.amount;
    nets.set(entry.currency, (nets.get(entry.currency) ?? 0) + signed);
  }

  const confirmed = new Set(requests.map((r) => r.serial));

  // the offers themselves (0035 lets a partner read its own): validity, totals, the monthly report
  type OfferRow = { id: string; serial: string; destination: string | null; total: number | string | null; currency: string | null; created_at: string; valid_until: string | null };
  let offers: OfferRow[] = [];
  const renewedFrom = new Map<string, OfferRow>();
  const renewedOld = new Set<string>();
  try {
    const supabase = (await createSupabaseServerClient()) as unknown as SupabaseClient;
    const res = await supabase.from("offers").select("id, serial, destination, total, currency, created_at, valid_until").order("created_at", { ascending: false }).limit(500);
    offers = (res.data ?? []) as OfferRow[];
    const ren = await supabase.from("offer_renewals").select("old_offer_id, new_draft_id");
    const byId = new Map(offers.map((o) => [o.id, o]));
    for (const r of (ren.data ?? []) as { old_offer_id: string; new_draft_id: string }[]) {
      const old = byId.get(r.old_offer_id);
      if (old) renewedFrom.set(r.new_draft_id, old);
      renewedOld.add(r.old_offer_id);
    }
  } catch {
    // the lists below simply go without validity and the report stays empty
  }
  const offerBySerial = new Map(offers.map((o) => [o.serial, o]));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
  const num = (v: number | string | null) => (v == null ? null : Number(v));

  return {
    // a file opened and left empty is not a request
    files: files.filter((file) => file.serial || file.destination || file.title).length,
    issued: files.filter((file) => file.serial).length,
    requests,
    awaiting: files
      .filter((file): file is typeof file & { serial: string } => Boolean(file.serial) && !confirmed.has(file.serial))
      .map((file) => {
        const offer = offerBySerial.get(file.serial);
        const was = renewedFrom.get(file.id);
        return {
          serial: file.serial,
          destination: file.destination,
          travelers: file.travelers,
          travel_date: file.travel_date,
          draft_id: file.id,
          valid_until: offer?.valid_until ?? null,
          expired: Boolean(offer?.valid_until && offer.valid_until < today),
          total: num(offer?.total ?? null),
          currency: offer?.currency ?? null,
          was: was ? { serial: was.serial, total: num(was.total), currency: was.currency } : null,
          renewed: Boolean(offer && renewedOld.has(offer.id)),
        };
      }),
    reports: lastTwoMonths(today).map((month) =>
      monthReport(
        offers.map((o) => ({ issued_on: o.created_at.slice(0, 10), destination: o.destination, total: num(o.total), currency: o.currency, confirmed: confirmed.has(o.serial) })),
        month,
      ),
    ),
    destinations,
    ledger,
    balances: [...nets.entries()].map(([currency, net]) => ({ currency, net })),
  };
}
