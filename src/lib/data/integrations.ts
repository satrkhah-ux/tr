"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { logAudit } from "./audit";
import { runIntegrationChecks } from "@/lib/developer/integrations-run";
import { INTEGRATION_KINDS, looksLikeSecret, type IntegrationKind } from "@/lib/developer/integration-kinds";
import { integrationLink, type IntegrationLink } from "@/lib/developer/integration-links";
import { readyOffersSheet } from "./ready-offers";
import { SHEET_ID as LEADS_SHEET_ID } from "@/lib/leads/sync";
import { getTeletelConfig } from "@/lib/providers/teletel";

/**
 * «الربط الخارجي» on «المطوّر» (the owner, 2026-10-19): every server, database,
 * API, bot, sheet, script, domain, subscription and scheduled job the system
 * leans on, for settings.manage — what it is, who uses it, where its secret
 * lives (a NAME or a path, never a value), its account, plan and end date, and
 * its automatic health (lib/developer/integrations-run.ts).
 */

export type Integration = {
  id: string;
  name: string;
  kind: IntegrationKind;
  used_by: string | null;
  secret_ref: string | null;
  account: string | null;
  plan: string | null;
  cost: string | null;
  renews_on: string | null;
  notes: string | null;
  check_key: string | null;
  unused: boolean;
  last_ok_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  fail_streak: number;
  alerted: string | null;
  /** where to open it — from the system's own settings (integration-links.ts); never a secret */
  link?: IntegrationLink | null;
};

type Fail = { ok: false; error: string };
const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
const COLS = "id, name, kind, used_by, secret_ref, account, plan, cost, renews_on, notes, check_key, unused, last_ok_at, last_error, last_error_at, fail_streak, alerted";

export async function listIntegrations(): Promise<Integration[] | null> {
  if (!(await currentCan("settings.manage"))) return null;
  const [{ data }, ready] = await Promise.all([db().from("integrations").select(COLS).order("sort").order("name"), readyOffersSheet()]);
  const ctx = {
    site: (process.env["NEXT_PUBLIC_SITE_URL"] ?? "https://pkg.traveliun.com").replace(/\/$/, ""),
    readySheet: ready.id || null,
    leadsSheet: LEADS_SHEET_ID || null,
    teletel: getTeletelConfig()?.baseUrl ?? null,
  };
  return ((data ?? []) as Integration[]).map((r) => ({ ...r, link: integrationLink(r, ctx) }));
}

export async function saveIntegration(input: Partial<Integration> & { name: string; kind: IntegrationKind }): Promise<{ ok: true; id: string } | Fail> {
  if (!(await currentCan("settings.manage"))) return { ok: false, error: "forbidden" };
  const name = String(input.name ?? "").trim().slice(0, 160);
  if (!name) return { ok: false, error: "name" };
  if (!INTEGRATION_KINDS.includes(input.kind)) return { ok: false, error: "kind" };
  const text = (v: unknown, max = 600) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const secret = text(input.secret_ref, 300);
  if (secret && looksLikeSecret(secret)) return { ok: false, error: "secret_value" };
  const renews = text(input.renews_on, 10);
  if (renews && !/^\d{4}-\d{2}-\d{2}$/.test(renews)) return { ok: false, error: "date" };
  const row = {
    name,
    kind: input.kind,
    used_by: text(input.used_by),
    secret_ref: secret,
    account: text(input.account, 200),
    plan: text(input.plan, 200),
    cost: text(input.cost, 120),
    renews_on: renews,
    notes: text(input.notes, 1200),
    unused: Boolean(input.unused),
    updated_at: new Date().toISOString(),
  };
  const { data, error } = input.id
    ? await db().from("integrations").update(row).eq("id", input.id).select("id").maybeSingle()
    : await db().from("integrations").insert(row).select("id").maybeSingle();
  if (error || !data) return { ok: false, error: error?.code === "23505" ? "duplicate" : "db" };
  const id = (data as { id: string }).id;
  await logAudit({ action: "settings.updated", entity: "integrations", entity_id: id, meta: { name, kind: row.kind, edited: input.id ? "updated" : "created" } });
  return { ok: true, id };
}

/** «افحص الآن» — every automatic check at once, its alerts as the watch sends them. */
export async function checkIntegrationsNow(): Promise<{ ok: true; checked: number; alerts: number } | Fail> {
  if (!(await currentCan("settings.manage"))) return { ok: false, error: "forbidden" };
  const r = await runIntegrationChecks(true);
  return { ok: true, checked: r.checked, alerts: r.alerts };
}
