"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { logAudit } from "@/lib/data/audit";
import { encryptSecret, isVaultConfigured } from "@/lib/crypto/secrets";
import { runCheck } from "@/lib/developer/checks";
import type { CheckResult } from "@/lib/developer/health";
import { allowedSecrets, cleanSecretValue, lastFour, rateLimited, type IntegrationRef } from "./core";
import { forgetSecrets, secretSource } from "./get";

/**
 * «المفاتيح والتوكنات» — developer.access or dashboard.admin (the owner, 2026-10-29). Writes are WRITE-ONLY: a saved
 * value is never returned, echoed or logged; the page learns only set / not
 * set, the source, the last four characters, and who changed it when. Every
 * save and clear is audited WITHOUT the value, and writes are rate-limited.
 */

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
type Fail = { ok: false; error: string };

const writes = new Map<string, number[]>();

async function developer(): Promise<string | null> {
  if (!(await currentCan("developer.access")) && !(await currentCan("dashboard.admin"))) return null;
  return (await getCurrentEmployeeId()) ?? null;
}

async function allowed() {
  const { data } = await db().from("integrations").select("secret_ref, check_key");
  return allowedSecrets((data ?? []) as IntegrationRef[]);
}

export type SecretRow = {
  name: string;
  set: boolean;
  source: "vault" | "env" | null;
  /** the last four characters of the value in use — never more */
  last4: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  /** the «الربط الخارجي» check that tests it, if any */
  checkId: string | null;
};

export async function listSecrets(): Promise<{ rows: SecretRow[]; vault: boolean; enabled: boolean } | null> {
  if (!(await developer())) return null;
  const [names, { data, error }] = await Promise.all([allowed(), db().from("app_secrets").select("name, last4, updated_at, updated_by_label")]);
  const saved = new Map(((data ?? []) as { name: string; last4: string | null; updated_at: string; updated_by_label: string | null }[]).map((r) => [r.name, r]));
  const rows: SecretRow[] = [];
  for (const { name, checkId } of names) {
    const source = await secretSource(name);
    const row = saved.get(name);
    const env = process.env[name];
    rows.push({
      name,
      set: source !== null,
      source,
      last4: source === "vault" ? (row?.last4 ?? null) : source === "env" && env ? lastFour(env) : null,
      updatedAt: row?.updated_at ?? null,
      updatedBy: row?.updated_by_label ?? null,
      checkId,
    });
  }
  return { rows, vault: isVaultConfigured(), enabled: !error };
}

async function guardWrite(name: string): Promise<{ me: string; label: string } | Fail> {
  const me = await developer();
  if (!me) return { ok: false, error: "للمطوّر فقط." };
  if (!(await allowed()).some((a) => a.name === name)) return { ok: false, error: "هذا الاسم ليس في القائمة المسموحة." };
  const limit = rateLimited(writes.get(me) ?? [], Date.now());
  writes.set(me, limit.next);
  if (limit.blocked) return { ok: false, error: "تغييرات كثيرة في وقت قصير — انتظر دقائق." };
  const { data } = await db().from("employees").select("arabic_name").eq("id", me).maybeSingle();
  return { me, label: ((data as { arabic_name?: string } | null)?.arabic_name ?? "المطوّر").trim() };
}

/** save or replace — the value goes in and never comes back */
export async function saveSecret(name: string, value: string): Promise<{ ok: true; last4: string } | Fail> {
  const who = await guardWrite(name);
  if ("ok" in who) return who;
  if (!isVaultConfigured()) return { ok: false, error: "مفتاح التشفير على الخادم غير مضبوط — لا يمكن الحفظ هنا." };
  const clean = cleanSecretValue(value);
  if (!clean) return { ok: false, error: "القيمة فارغة أو فيها سطر جديد أو أطول من المسموح." };
  const replaced = (await secretSource(name)) === "vault";
  const last4 = lastFour(clean);
  const { error } = await db().from("app_secrets").upsert({
    name, value_enc: encryptSecret(clean), last4, updated_by: who.me, updated_by_label: who.label, updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: "تعذّر الحفظ." };
  forgetSecrets();
  await logAudit({ action: "secrets.saved", entity: "app_secrets", entity_id: name, meta: { name, replaced } });
  return { ok: true, last4 };
}

/** clear — the server's environment value (if any) answers again */
export async function clearSecret(name: string): Promise<{ ok: true } | Fail> {
  const who = await guardWrite(name);
  if ("ok" in who) return who;
  const { error } = await db().from("app_secrets").delete().eq("name", name);
  if (error) return { ok: false, error: "تعذّر المسح." };
  forgetSecrets();
  await logAudit({ action: "secrets.cleared", entity: "app_secrets", entity_id: name, meta: { name } });
  return { ok: true };
}

/** «افحص الآن»: the integration's own check from «الربط الخارجي» (its error text already scrubbed of secrets) */
export async function checkSecret(name: string): Promise<CheckResult | Fail> {
  if (!(await developer())) return { ok: false, error: "للمطوّر فقط." };
  const entry = (await allowed()).find((a) => a.name === name);
  if (!entry?.checkId) return { ok: false, error: "لا يوجد فحص آلي مربوط بهذا الاسم في «الربط الخارجي»." };
  forgetSecrets();
  const result = await runCheck(entry.checkId);
  return result ?? { ok: false, error: "الفحص غير موجود." };
}
