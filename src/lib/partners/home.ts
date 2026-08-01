"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { listPartnerFiles } from "./drafts";
import { getPartnerSession } from "./session";

/**
 * The numbers a partner's home screen is made of.
 *
 * Everything here is derived from rows the database would hand them anyway
 * (0035 for their files and offers, 0037 for operations and payments), so the
 * user client throughout — no service-role shortcut that could out-run a policy.
 */

export type DestinationUse = { name: string; count: number };

export type PartnerRequest = {
  serial: string | null;
  client_status: string;
  execution_status: string;
  travel_start: string | null;
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
  destinations: DestinationUse[];
  ledger: LedgerEntry[];
  /** Payments minus refunds, per currency — a single total would add riyals to dollars. */
  balances: { currency: string; net: number }[];
};

const EMPTY: PartnerHomeData = {
  files: 0,
  issued: 0,
  requests: [],
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
      .select("id, client_status, execution_status, travel_start, offers!inner(serial)")
      .order("confirmed_at", { ascending: false })
      .limit(100);

    type OpRow = {
      id: string;
      client_status: string;
      execution_status: string;
      travel_start: string | null;
      offers: { serial: string | null } | { serial: string | null }[] | null;
    };
    const ops = (opsRows ?? []) as OpRow[];
    const serialOf = (row: OpRow) =>
      (Array.isArray(row.offers) ? row.offers[0]?.serial : row.offers?.serial) ?? null;

    requests = ops.map((row) => ({
      serial: serialOf(row),
      client_status: row.client_status,
      execution_status: row.execution_status,
      travel_start: row.travel_start,
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

  return {
    files: files.length,
    issued: files.filter((file) => file.serial).length,
    requests,
    destinations,
    ledger,
    balances: [...nets.entries()].map(([currency, net]) => ({ currency, net })),
  };
}
