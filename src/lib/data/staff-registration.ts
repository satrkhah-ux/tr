"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import { notifyEmployeeRegistration } from "@/lib/data/ops-notify";
import {
  REJECT_COOLDOWN_DAYS,
  normalizeRegistration,
  rateDecision,
  type RegistrationInput,
} from "@/lib/team/register-rules";

/**
 * «تسجيل موظف جديد» — the public form's only writer.
 *
 * Runs with the SERVICE role and no session: staff_registrations has no policy
 * at all (0046), so this action is the one door, and every check below is the
 * door's lock. What it can produce is exactly one thing — a `pending` request.
 * No auth account and no password: nothing here can make an employee, pick a
 * role or claim an address. Approval does that (team.ts) by INVITING the
 * address, so only whoever really owns the mailbox can ever sign in with it —
 * an outsider can no longer pre-claim a new hire's email with a password of
 * their own (security audit L8).
 *
 * Every "no" that would reveal whether an address is already staff answers
 * with the same success the real thing gets. The form must not be a way to
 * find out who works here.
 */

function db(): SupabaseClient {
  return createSupabaseServiceClient() as unknown as SupabaseClient;
}

export type StaffRegisterResult = { ok: true } | { ok: false; error: TranslationKey };

const NEUTRAL: StaffRegisterResult = { ok: true };
const FAILED: StaffRegisterResult = { ok: false, error: "reg.err.failed" };

/**
 * The origin, hashed with a server secret so the table never holds an address.
 * x-forwarded-for can be forged, which is why the global pending cap — not
 * this — is the limit that actually holds.
 */
async function originHash(): Promise<string | null> {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim();
  if (!ip) return null;
  return createHash("sha256")
    .update(`${ip}|${process.env["SETTINGS_ENCRYPTION_KEY"] ?? ""}`)
    .digest("hex");
}

/**
 * ilike treats _ and % as wildcards; an address must match only itself.
 * PostgREST also reads * as % — normalizeRegistration refuses it outright.
 */
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export async function registerEmployee(
  input: RegistrationInput & { /** honeypot — hidden from people, filled by bots */ website?: string },
): Promise<StaffRegisterResult> {
  if (input.website?.trim()) return NEUTRAL;

  // Only the fields the rules name are read: a role or status smuggled into the
  // payload has nowhere to go.
  const parsed = normalizeRegistration(input);
  if (!parsed.ok) return parsed;
  const v = parsed.value;

  try {
    const supabase = db();
    const ipHash = await originHash();

    // Limits BEFORE anything is stored, so a flood stores nothing.
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const [fromOrigin, open] = await Promise.all([
      ipHash
        ? supabase
            .from("staff_registrations")
            .select("id", { count: "exact", head: true })
            .eq("ip_hash", ipHash)
            .gte("created_at", since)
        : Promise.resolve({ count: 0, error: null }),
      supabase.from("staff_registrations").select("id", { count: "exact", head: true }).eq("status", "pending"),
    ]);
    if (fromOrigin.error || open.error) return FAILED;
    if (rateDecision({ ipCount24h: fromOrigin.count ?? 0, pendingTotal: open.count ?? 0 }) === "closed") {
      return { ok: false, error: "reg.closed" };
    }

    // Already staff, or turned down recently → the same answer as success.
    const cooldown = new Date(Date.now() - REJECT_COOLDOWN_DAYS * 24 * 3600 * 1000).toISOString();
    const [staff, rejected] = await Promise.all([
      supabase.from("employees").select("id").ilike("email", likeLiteral(v.email)).limit(1),
      supabase
        .from("staff_registrations")
        .select("id")
        .eq("email", v.email)
        .eq("status", "rejected")
        .gte("reviewed_at", cooldown)
        .limit(1),
    ]);
    if (staff.error || rejected.error) return FAILED;
    if ((staff.data ?? []).length > 0 || (rejected.data ?? []).length > 0) return NEUTRAL;

    const { data: row, error: insertError } = await supabase
      .from("staff_registrations")
      .insert({
        arabic_name: v.arabic_name,
        english_name: v.english_name,
        email: v.email,
        mobile: v.mobile,
        note: v.note,
        ip_hash: ipHash,
      })
      .select("id")
      .single();
    // 23505: a request for this address is already pending. Same answer.
    if (insertError || !row) return insertError?.code === "23505" ? NEUTRAL : FAILED;

    const id = (row as { id: string }).id;
    await logAudit({
      action: "staff_registration.submitted",
      entity: "staff_registrations",
      entity_id: id,
      actor: { id: null, label: "self-registration" },
      meta: {},
    });
    // Nobody watches a table. Tell the office a request arrived.
    await notifyEmployeeRegistration({ name: v.arabic_name });
    return NEUTRAL;
  } catch {
    return FAILED;
  }
}
