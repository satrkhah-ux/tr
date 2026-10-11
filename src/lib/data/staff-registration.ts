"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import { notifyEmployeeRegistration } from "@/lib/data/ops-notify";
import {
  PENDING_BAN,
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
 * door's lock. What it can produce is exactly one thing — a `pending` request
 * plus a BANNED auth account with the password the applicant chose. Nothing
 * here can make an employee or pick a role; approval does that (team.ts).
 *
 * Every "no" that would reveal whether an address is already staff answers
 * with the same success the real thing gets. The form must not be a way to
 * find out who works here.
 *
 * Known limit, accepted: one EXACT address can still be told apart afterwards —
 * signing in with the password just chosen says «قيد المراجعة» for a new
 * request and «بيانات غير صحيحة» for staff, and the new-account path is slower.
 * Each such probe of a non-staff address costs a pending request and a Telegram
 * message, so it stops at PENDING_CAP. Closing it means creating the account
 * only at approval, by invite (issueEmployeeAccount's path).
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

    // Limits BEFORE any account exists, so a flood creates nothing.
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

    // Confirmed (no mail is sent, so no SMTP is involved) and banned: the
    // account exists with their password and cannot sign in until approval.
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: v.email,
      password: v.password,
      email_confirm: true,
      ban_duration: PENDING_BAN,
      user_metadata: { self_registered: true },
    });
    if (createError || !created?.user) {
      // A partner login, an existing staff login or a request already pending
      // all own the address. Same answer as success.
      if (createError?.code === "email_exists" || createError?.code === "user_already_exists") return NEUTRAL;
      if (createError?.code === "weak_password") return { ok: false, error: "reg.err.password" };
      return FAILED;
    }

    const { data: row, error: insertError } = await supabase
      .from("staff_registrations")
      .insert({
        arabic_name: v.arabic_name,
        english_name: v.english_name,
        email: v.email,
        mobile: v.mobile,
        note: v.note,
        auth_user_id: created.user.id,
        ip_hash: ipHash,
      })
      .select("id")
      .single();
    if (insertError || !row) {
      // Never leave a banned account with no request behind it — nobody could
      // ever approve or reject it.
      await supabase.auth.admin.deleteUser(created.user.id);
      // 23505: a second submit for the same address won the race.
      return insertError?.code === "23505" ? NEUTRAL : FAILED;
    }

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
