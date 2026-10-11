"use server";

import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What ONE NIGHT of a room last cost — remembered per (hotel, room type, board).
 *
 * Per night (0054) so a 3-night figure is never offered to a 5-night stay as
 * the whole price; the caller multiplies by its own nights.
 *
 * The agent prices a room once and the next file that books it starts from the
 * number they already decided, instead of an empty box and a guess. Saving is
 * an explicit press: a price typed and then thought better of should not
 * become the house answer.
 *
 * Never applied to a document on its own — it fills the field, the agent reads
 * it, and the draft carries whatever they leave there.
 */

/** `price` is per night. */
export type RememberedRate = { price: number; currency: string; updated_at: string };

async function db(): Promise<SupabaseClient> {
  return (await createSupabaseServerClient()) as unknown as SupabaseClient;
}

/** The board as the memory keys it — '' and null are the same answer. */
function boardKey(board: string | null): string {
  return board?.trim() ? board.trim() : "";
}

export async function recallHotelRate(
  hotelId: string,
  roomTypeName: string,
  boardType: string | null,
): Promise<RememberedRate | null> {
  if (!(await getServerUser())) return null;
  if (!hotelId || !roomTypeName.trim()) return null;
  try {
    const supabase = await db();
    const { data } = await supabase
      .from("hotel_rate_memory")
      .select("price, currency, updated_at, board_type")
      .eq("hotel_id", hotelId)
      .eq("room_type_name", roomTypeName.trim())
      // rows saved before 0054 held a whole stay of unknown length
      .eq("per_night", true)
      .limit(20);

    const rows = (data ?? []) as { price: number; currency: string; updated_at: string; board_type: string | null }[];
    // Matched in JS rather than with .eq("board_type", …): a null board is a
    // legitimate answer, and PostgREST's eq never matches NULL.
    const hit = rows.find((r) => boardKey(r.board_type) === boardKey(boardType));
    if (!hit) return null;
    return { price: Number(hit.price), currency: hit.currency, updated_at: hit.updated_at };
  } catch {
    return null;
  }
}

export type RememberRateResult = { ok: true } | { ok: false; error: "err.session" | "err.db" };

export async function rememberHotelRate(input: {
  hotelId: string;
  roomTypeName: string;
  boardType: string | null;
  /** per night. */
  price: number;
  currency: string;
}): Promise<RememberRateResult> {
  const user = await getServerUser();
  if (!user) return { ok: false, error: "err.session" };
  if (!input.hotelId || !input.roomTypeName.trim() || !Number.isFinite(input.price) || input.price <= 0) {
    return { ok: false, error: "err.db" };
  }
  try {
    const supabase = await db();
    const board = input.boardType?.trim() || null;

    // The unique index is on coalesce(board_type, ''), which onConflict cannot
    // name — so the upsert is done by hand: find this product's row, then
    // update it or insert one.
    const { data: existing } = await supabase
      .from("hotel_rate_memory")
      .select("id, board_type")
      .eq("hotel_id", input.hotelId)
      .eq("room_type_name", input.roomTypeName.trim())
      .limit(20);

    const row = ((existing ?? []) as { id: string; board_type: string | null }[]).find(
      (r) => boardKey(r.board_type) === boardKey(board),
    );

    const values = {
      per_night: true,
      price: input.price,
      currency: input.currency?.trim() || "SAR",
      updated_at: new Date().toISOString(),
    };

    const { error } = row
      ? await supabase.from("hotel_rate_memory").update(values).eq("id", row.id)
      : await supabase.from("hotel_rate_memory").insert({
          hotel_id: input.hotelId,
          room_type_name: input.roomTypeName.trim(),
          board_type: board,
          ...values,
        });

    return error ? { ok: false, error: "err.db" } : { ok: true };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
