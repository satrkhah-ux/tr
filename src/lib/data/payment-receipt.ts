import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { receiptNo } from "@/lib/partners/ledger-math";
import type { PaymentKind, PaymentMethod } from "@/lib/data/operations";
import type { ReceiptDTO } from "@/lib/operations/payments";

/**
 * «سند القبض» as the CLIENT reaches it — no session, so the service role, and
 * the 24-byte token is the gate (the /voucher reasoning: RLS cannot see a URL).
 * Every read below names its columns: the internal note, the proof path and who
 * recorded the payment are never selected, so they cannot leak by a spread.
 */

/** A fresh receipt number and share token for one payment. */
export function mintReceipt(): { receipt_no: string; receipt_token: string } {
  return { receipt_no: receiptNo(new Date()), receipt_token: randomBytes(24).toString("base64url") };
}

function db(): SupabaseClient {
  return createSupabaseServiceClient() as unknown as SupabaseClient;
}

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

type ReceiptRow = {
  receipt_no: string | null;
  amount: number | string;
  currency: string;
  kind: PaymentKind;
  method: PaymentMethod | null;
  reference: string | null;
  paid_at: string;
  operations: unknown;
};

type OfferBit = { serial: string; destination: string | null; customers: unknown };

/** The receipt behind a token; null for an unknown token, and for a refund (money out is not a receipt). */
export async function getReceiptByToken(token: string): Promise<ReceiptDTO | null> {
  if (!token || token.length < 20) return null;
  try {
    const { data } = await db()
      .from("operation_payments")
      .select("receipt_no, amount, currency, kind, method, reference, paid_at, operations(offers(serial, destination, customers(arabic_name)))")
      .eq("receipt_token", token)
      .maybeSingle();
    const row = data as ReceiptRow | null;
    if (!row || !row.receipt_no || row.kind === "refund") return null;
    const offer = one(one(row.operations as { offers: OfferBit | OfferBit[] | null } | null)?.offers);
    const customer = one(offer?.customers as { arabic_name: string | null } | { arabic_name: string | null }[] | null);
    return {
      receipt_no: row.receipt_no,
      serial: offer?.serial ?? "",
      destination: offer?.destination ?? null,
      customer_name: customer?.arabic_name ?? null,
      amount: Number(row.amount),
      currency: row.currency,
      kind: row.kind,
      method: row.method,
      reference: row.reference,
      paid_at: row.paid_at,
    };
  } catch {
    return null;
  }
}

export type TripReceipt = { receipt_no: string; amount: number; currency: string; paid_at: string; token: string };

/** The receipts listed on a client's /trip link — none once that link is revoked. */
export async function listTripReceipts(clientToken: string): Promise<TripReceipt[]> {
  try {
    const supabase = db();
    const { data: op } = await supabase
      .from("operations")
      .select("id, client_token_revoked_at")
      .eq("client_token", clientToken)
      .maybeSingle();
    const row = op as { id: string; client_token_revoked_at: string | null } | null;
    if (!row || row.client_token_revoked_at) return [];
    const { data } = await supabase
      .from("operation_payments")
      .select("receipt_no, receipt_token, amount, currency, paid_at")
      .eq("operation_id", row.id)
      .neq("kind", "refund")
      .not("receipt_token", "is", null)
      .order("paid_at", { ascending: true });
    return ((data ?? []) as { receipt_no: string; receipt_token: string; amount: number | string; currency: string; paid_at: string }[]).map(
      (p) => ({ receipt_no: p.receipt_no, amount: Number(p.amount), currency: p.currency, paid_at: p.paid_at, token: p.receipt_token }),
    );
  } catch {
    return [];
  }
}
