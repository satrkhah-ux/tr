"use server";

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { logAudit } from "./audit";
import { fixedCostIn, parseBook, type FinanceBook } from "@/lib/finance/model";
import { IDLE_MS, makeUnlockToken, unlockTokenValid } from "@/lib/finance/lock";

/**
 * The book is one document; every save appends a version to finance_book_versions (closed table,
 * migration 20261025090000), so the newest row is the book and the rest its history.
 * developer.access, or the owner's own account (FINANCE_ACCOUNTS) — salaries and the partners' shares are not the staff's screen.
 *
 * A password on top (finance_lock, migration 20261025100000): the owner sets it on his first visit.
 * The same password opens «الحسابات» (the owner, 2026-10-30: «الدخول بكلمة سر للادارة»), for its staff
 * too; an unlock lasts 30 minutes from the last use (lib/finance/lock.ts) — a new password ends them all.
 */
const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
/** the owner signs in as the administration's own account (2026-10-24); its role is shared with staff, so the ACCOUNT is named, not the role */
const FINANCE_ACCOUNTS = ["admin@admin.com"];
const allowed = async () => (await currentCan("developer.access"))
  || FINANCE_ACCOUNTS.includes((await getServerUser())?.email?.toLowerCase() ?? "");
const EMPTY: FinanceBook = { rents: [], staff: [], debts: [], bookings: [], partners: [], expenses: [], treasuryOut: [], targets: [], reservePct: 20, updatedAt: "" };
const COOKIE = "fin_unlock";
const MIN_LENGTH = 6;
const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

async function latest(): Promise<FinanceBook | null> {
  const { data, error } = await db().from("finance_book_versions").select("book, saved_at").order("id", { ascending: false }).limit(1).maybeSingle();
  if (error) return null;
  if (!data) return EMPTY;
  const book = parseBook({ ...(data.book as object), updatedAt: data.saved_at });
  return book;
}

/** the stored "salt:hash" (hex), "" when none is set yet, null when it could not be read */
async function lockHash(): Promise<string | null> {
  const { data, error } = await db().from("finance_lock").select("hash").eq("id", 1).maybeSingle();
  if (error) return null;
  return (data?.hash as string | undefined) ?? "";
}
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function unlocked(hash: string): Promise<boolean> {
  const user = await getServerUser();
  return !!user && unlockTokenValid((await cookies()).get(COOKIE)?.value, hash, user.id, Date.now());
}
async function grant(hash: string) {
  const user = await getServerUser();
  if (!user) return;
  (await cookies()).set(COOKIE, makeUnlockToken(hash, user.id, Date.now()), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: Math.floor(IDLE_MS / 1000),
  });
}

/** who may type the password: the book's owner, or «الحسابات» (finance.accounts) for its section */
const mayUnlock = async () => (await allowed()) || (await currentCan("finance.accounts"));

// ponytail: in-process attempt counter (one app container) — five wrong passwords, ten minutes' wait;
// a shared store if the app ever runs on more than one instance
const failures = new Map<string, { count: number; until: number }>();
const MAX_TRIES = 5;
const WAIT_MS = 10 * 60_000;

export type FinanceState = { book: FinanceBook } | { error: string } | { locked: "set" | "ask" };

export async function getFinance(): Promise<FinanceState | null> {
  if (!(await allowed())) return null;
  const hash = await lockHash();
  if (hash === null) return { error: "تعذّرت قراءة الحسابات. لم يُغيَّر شيء." };
  if (!hash) return { locked: "set" };
  if (!(await unlocked(hash))) return { locked: "ask" };
  const book = await latest();
  return book ? { book } : { error: "تعذّرت قراءة الحسابات. لم يُغيَّر شيء." };
}

/** the first visit only: once a password exists this refuses (a new one = delete the row in the database) */
export async function setFinancePassword(password: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await allowed())) return { ok: false, error: "لا صلاحية" };
  if (typeof password !== "string" || password.length < MIN_LENGTH || password.length > 200) return { ok: false, error: `كلمة السر ${MIN_LENGTH} أحرف على الأقل.` };
  const salt = randomBytes(16);
  const hash = `${salt.toString("hex")}:${(await scryptAsync(password, salt, 32)).toString("hex")}`;
  const user = await getServerUser();
  // the primary key is fixed at 1, so a second «set» (two tabs) fails instead of replacing the first
  const { error } = await db().from("finance_lock").insert({ id: 1, hash, set_by: user?.id ?? null });
  if (error) return { ok: false, error: "كلمة السر موضوعة من قبل. حدّث الصفحة." };
  await logAudit({ action: "finance.saved", entity: "finance_lock", entity_id: "1", meta: { password: "set" } });
  await grant(hash);
  return { ok: true };
}

export async function unlockFinance(password: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await mayUnlock())) return { ok: false, error: "لا صلاحية" };
  const user = await getServerUser();
  if (!user) return { ok: false, error: "لا صلاحية" };
  const f = failures.get(user.id);
  if (f && f.count >= MAX_TRIES && f.until > Date.now()) return { ok: false, error: "محاولات كثيرة خاطئة. انتظر عشر دقائق." };
  const hash = await lockHash();
  if (!hash) return { ok: false, error: "تعذّر التحقق. حدّث الصفحة." };
  const [salt, want] = hash.split(":");
  const got = (await scryptAsync(typeof password === "string" ? password.slice(0, 200) : "", Buffer.from(salt, "hex"), 32)).toString("hex");
  if (!same(got, want)) {
    const count = (f && f.until > Date.now() ? f.count : 0) + 1;
    failures.set(user.id, { count, until: Date.now() + WAIT_MS });
    if (count >= MAX_TRIES) await logAudit({ action: "finance.saved", entity: "finance_lock", entity_id: "1", meta: { password: "locked_out" } });
    return { ok: false, error: "كلمة السر غير صحيحة." };
  }
  failures.delete(user.id);
  await grant(hash);
  return { ok: true };
}

/**
 * «الحسابات»'s door (its layout): who may come in and whether the password is open for them now.
 * "none" — no password set yet and this person cannot set it (only the book's owner can).
 */
export async function accountsGate(): Promise<"forbidden" | "error" | "none" | "set" | "ask" | "open"> {
  const owner = await allowed();
  if (!owner && !(await currentCan("finance.accounts"))) return "forbidden";
  const hash = await lockHash();
  if (hash === null) return "error";
  if (!hash) return owner ? "set" : "none";
  return (await unlocked(hash)) ? "open" : "ask";
}

/** every «الحسابات» loader and action: allowed in AND unlocked now */
export async function accountsOpen(): Promise<boolean> {
  return (await accountsGate()) === "open";
}

/** use renews the unlock (the section's pages call it while someone works); false = it has already run out */
export async function touchFinanceUnlock(): Promise<boolean> {
  const hash = await lockHash();
  if (!hash || !(await mayUnlock()) || !(await unlocked(hash))) return false;
  await grant(hash);
  return true;
}

export async function saveFinance(next: unknown, base: string): Promise<{ ok: true; updatedAt: string } | { ok: false; error: string }> {
  if (!(await allowed())) return { ok: false, error: "لا صلاحية" };
  const hash = await lockHash();
  if (!hash || !(await unlocked(hash))) return { ok: false, error: "انتهت الجلسة. حدّث الصفحة وأدخل كلمة السر." };
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

/**
 * «الحسابات» links to the book (stage 4, 2026-10-30): a month's salaries, rents due and instalments — only
 * for whoever opens the book and has unlocked it this session; null for everyone else (the accounts staff
 * never see salaries).
 */
export async function financeFixedCost(month: string): Promise<number | null> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !(await allowed())) return null;
  const hash = await lockHash();
  if (!hash || !(await unlocked(hash))) return null;
  const book = await latest();
  if (!book) return null;
  const [y, m] = month.split("-").map(Number);
  return fixedCostIn(book, y, m);
}

/** «قفل الآن» — ends this browser's unlock at once */
export async function lockFinanceNow(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
