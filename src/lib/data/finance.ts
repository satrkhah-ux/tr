"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { logAudit } from "./audit";
import { parseBook, type FinanceBook } from "@/lib/finance/model";

/**
 * The book is one document; every save appends a version to finance_book_versions (closed table,
 * migration 20261025090000), so the newest row is the book and the rest its history.
 * developer.access only — salaries and the partners' shares are not the administration's screen.
 */
const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
const allowed = () => currentCan("developer.access");
const EMPTY: FinanceBook = { rents: [], staff: [], debts: [], bookings: [], partners: [], expenses: [], reservePct: 20, updatedAt: "" };

async function latest(): Promise<FinanceBook | null> {
  const { data, error } = await db().from("finance_book_versions").select("book, saved_at").order("id", { ascending: false }).limit(1).maybeSingle();
  if (error) return null;
  if (!data) return EMPTY;
  const book = parseBook({ ...(data.book as object), updatedAt: data.saved_at });
  return book;
}

export async function getFinance(): Promise<{ book: FinanceBook; error?: undefined } | { error: string; book?: undefined } | null> {
  if (!(await allowed())) return null;
  const book = await latest();
  return book ? { book } : { error: "تعذّرت قراءة الحسابات. لم يُغيَّر شيء." };
}

export async function saveFinance(next: unknown, base: string): Promise<{ ok: true; updatedAt: string } | { ok: false; error: string }> {
  if (!(await allowed())) return { ok: false, error: "لا صلاحية" };
  const book = parseBook(next);
  if (!book) return { ok: false, error: "في البيانات قيمة غير صالحة (مبلغ سالب أو حقل ناقص)." };
  // ponytail: check-then-insert — two saves in the same instant both land (newest wins); one owner edits it
  const current = await latest();
  if (!current) return { ok: false, error: "تعذّرت قراءة الحسابات الحالية، فلم يُحفظ شيء." };
  if (current.updatedAt !== base) return { ok: false, error: "عُدّلت الحسابات من نافذة أخرى. حدّث الصفحة ثم أعد التعديل." };
  const user = await getServerUser();
  const { updatedAt: _drop, ...doc } = book;
  void _drop;
  const { data, error } = await db().from("finance_book_versions").insert({ book: doc, saved_by: user?.id ?? null }).select("id, saved_at").single();
  if (error || !data) return { ok: false, error: "تعذّر الحفظ." };
  // the audit says that it changed, never the figures
  await logAudit({ action: "finance.saved", entity: "finance_book_versions", entity_id: String(data.id), meta: {} });
  return { ok: true, updatedAt: data.saved_at };
}
