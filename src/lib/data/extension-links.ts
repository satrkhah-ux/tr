"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { currentPermissions } from "@/lib/roles/current";
import { getPartnerSession } from "@/lib/partners/session";
import { logAudit } from "@/lib/data/audit";
import { deviceLabel, EXT_SCOPES, LINK_DAYS, MAX_LINKS, mintToken } from "@/lib/ext/token";

/**
 * «ربط الإضافة» (/extension): an employee links this browser's extension, sees
 * their linked devices, and revokes one. Their own devices only; a partner
 * company's session links nothing. The token leaves here once, to the page that
 * hands it to the extension; the table keeps its sha256.
 */
export type ExtensionLink = {
  id: string;
  label: string;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
};

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;

/** the signed-in employee, Active and holding something — else null */
async function me(): Promise<string | null> {
  if (await getPartnerSession()) return null;
  const [id, permissions] = await Promise.all([getCurrentEmployeeId(), currentPermissions()]);
  return id && permissions.length > 0 ? id : null;
}

export async function listMyExtensionLinks(): Promise<ExtensionLink[]> {
  const id = await me();
  if (!id) return [];
  const { data } = await db()
    .from("extension_links")
    .select("id, label, created_at, expires_at, last_used_at")
    .eq("employee_id", id)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  return (data ?? []) as ExtensionLink[];
}

/** This browser, linked: the token for the page to hand to the extension once, and the link's id (revoked if it never arrives). */
export async function linkExtension(): Promise<{ ok: true; id: string; token: string } | { ok: false; error: string }> {
  const id = await me();
  if (!id) return { ok: false, error: "غير مسموح" };
  const label = deviceLabel((await headers()).get("user-agent") ?? "");
  const open = await listMyExtensionLinks();
  if (open.length >= MAX_LINKS) return { ok: false, error: `لديك ${MAX_LINKS} أجهزة مربوطة — ألغِ واحداً منها أولاً` };
  const { token, hash } = mintToken();
  const expiresAt = new Date(Date.now() + LINK_DAYS * 86_400_000).toISOString();
  const { data, error } = await db()
    .from("extension_links")
    .insert({ employee_id: id, token_hash: hash, label, scopes: [...EXT_SCOPES], expires_at: expiresAt })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "تعذّر الربط — حاول مرة أخرى" };
  const linkId = (data as { id: string }).id;
  // two presses at once could both pass the count above: the newest past the cap is taken back
  if ((await listMyExtensionLinks()).length > MAX_LINKS) {
    await db().from("extension_links").update({ revoked_at: new Date().toISOString() }).eq("id", linkId);
    return { ok: false, error: `لديك ${MAX_LINKS} أجهزة مربوطة — ألغِ واحداً منها أولاً` };
  }
  await logAudit({ action: "ext.linked", entity: "extension_links", entity_id: linkId, meta: { label } });
  return { ok: true, id: linkId, token };
}

/**
 * Every live device of the signed-in employee, revoked — «ألغِ كل الأجهزة» on /extension, and after they change
 * their own password (ChangePasswordDialog): a new password cuts off every device, as a reset by the
 * administration does (employee-accounts.ts). Any employee of ours, whatever they hold; never a partner.
 */
export async function revokeAllMyExtensionLinks(): Promise<{ ok: boolean; count: number }> {
  if (await getPartnerSession()) return { ok: false, count: 0 };
  const id = await getCurrentEmployeeId();
  if (!id) return { ok: false, count: 0 };
  const { data, error } = await db()
    .from("extension_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("employee_id", id)
    .is("revoked_at", null)
    .select("id");
  if (error) return { ok: false, count: 0 };
  const count = (data ?? []).length;
  if (count > 0) await logAudit({ action: "ext.revoked", entity: "extension_links", entity_id: id, meta: { all: true, count } });
  return { ok: true, count };
}

export async function revokeExtensionLink(linkId: string): Promise<{ ok: boolean }> {
  const id = await me();
  if (!id) return { ok: false };
  const { data } = await db()
    .from("extension_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", linkId)
    .eq("employee_id", id)
    .is("revoked_at", null)
    .select("id, label");
  const row = (data ?? [])[0] as { id: string; label: string } | undefined;
  if (!row) return { ok: false };
  await logAudit({ action: "ext.revoked", entity: "extension_links", entity_id: row.id, meta: { label: row.label } });
  return { ok: true };
}
