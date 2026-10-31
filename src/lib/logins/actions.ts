"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { logAudit } from "@/lib/data/audit";
import { decryptSecret, encryptSecret, isVaultConfigured } from "@/lib/crypto/secrets";
import { LOGIN_KINDS, type LoginKind as Kind } from "./kinds";

/**
 * «حسابات الدخول» (the owner, 2026-10-31): every login the company holds, in one place. An employee adds and sees
 * their own; the administration (logins.manage) sees and manages all. The password is never sent to the page with the
 * list — only on «اعرض», one at a time, each showing audited (without the value). Saving and removing are audited too.
 */

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
type Fail = { ok: false; error: string };


export type LoginRow = {
  id: string;
  name: string;
  kind: Kind;
  url: string | null;
  username: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  hasPassword: boolean;
  createdBy: string | null;
  createdByName: string | null;
  updatedAt: string;
};

export type LoginInput = { id?: string; name: string; kind: string; url?: string; username?: string; email?: string; phone?: string; notes?: string; password?: string };

async function who(): Promise<{ me: string; manager: boolean } | null> {
  const me = await getCurrentEmployeeId();
  if (!me) return null;
  return { me, manager: await currentCan("logins.manage") };
}

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export async function listLogins(): Promise<{ rows: LoginRow[]; manager: boolean; vault: boolean } | null> {
  const w = await who();
  if (!w) return null;
  let q = db().from("shared_logins").select("id, name, kind, url, username, email, phone, notes, password_enc, created_by, updated_at").order("name");
  if (!w.manager) q = q.eq("created_by", w.me);
  const { data } = await q;
  const rows = (data ?? []) as (Omit<LoginRow, "hasPassword" | "createdBy" | "createdByName" | "updatedAt"> & { password_enc: string | null; created_by: string | null; updated_at: string })[];
  const ids = [...new Set(rows.map((r) => r.created_by).filter((x): x is string => Boolean(x)))];
  const { data: people } = ids.length ? await db().from("employees").select("id, arabic_name").in("id", ids) : { data: [] };
  const nameOf = new Map(((people ?? []) as { id: string; arabic_name: string }[]).map((p) => [p.id, p.arabic_name.replace(/[‎‏]/g, "").trim()]));
  return {
    manager: w.manager,
    vault: isVaultConfigured(),
    rows: rows.map(({ password_enc, created_by, updated_at, ...r }) => ({ ...r, hasPassword: Boolean(password_enc), createdBy: created_by, createdByName: nameOf.get(created_by ?? "") ?? null, updatedAt: updated_at })),
  };
}

/** the row the caller may touch: their own, or any for the administration */
async function mine(id: string, w: { me: string; manager: boolean }): Promise<{ password_enc: string | null; name: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await db().from("shared_logins").select("created_by, password_enc, name").eq("id", id).maybeSingle();
  const row = data as { created_by: string | null; password_enc: string | null; name: string } | null;
  return row && (w.manager || row.created_by === w.me) ? row : null;
}

export async function saveLogin(input: LoginInput): Promise<{ ok: true } | Fail> {
  const w = await who();
  if (!w) return { ok: false, error: "سجّل الدخول أولاً." };
  const name = text(input.name, 120);
  if (!name) return { ok: false, error: "اكتب اسم الحساب أو المنصة." };
  const kind = (LOGIN_KINDS.some(([k]) => k === input.kind) ? input.kind : "other") as Kind;
  const password = typeof input.password === "string" && input.password.length > 0 ? input.password.slice(0, 500) : null;
  if (password && !isVaultConfigured()) return { ok: false, error: "التشفير غير مُعدّ على الخادم — لا تُحفظ كلمة السر." };
  const row: Record<string, unknown> = {
    name,
    kind,
    url: text(input.url, 500),
    username: text(input.username, 200),
    email: text(input.email, 200),
    phone: text(input.phone, 40),
    notes: text(input.notes, 1000),
    updated_by: w.me,
    updated_at: new Date().toISOString(),
  };
  // an empty password field on an edit keeps the saved one
  if (password) row.password_enc = encryptSecret(password);
  if (input.id) {
    if (!(await mine(input.id, w))) return { ok: false, error: "لا صلاحية على هذا الحساب." };
    const { error } = await db().from("shared_logins").update(row).eq("id", input.id);
    if (error) return { ok: false, error: "تعذّر الحفظ." };
    await logAudit({ action: "login.saved", entity: "shared_logins", entity_id: input.id, meta: { name, kind, password_changed: Boolean(password) } });
    return { ok: true };
  }
  const { data, error } = await db().from("shared_logins").insert({ ...row, created_by: w.me }).select("id").single();
  if (error || !data) return { ok: false, error: "تعذّر الحفظ." };
  await logAudit({ action: "login.saved", entity: "shared_logins", entity_id: (data as { id: string }).id, meta: { name, kind, created: true, password_changed: Boolean(password) } });
  return { ok: true };
}

export async function revealLogin(id: string): Promise<{ ok: true; password: string } | Fail> {
  const w = await who();
  if (!w) return { ok: false, error: "سجّل الدخول أولاً." };
  const row = await mine(id, w);
  if (!row) return { ok: false, error: "لا صلاحية على هذا الحساب." };
  if (!row.password_enc) return { ok: false, error: "لا كلمة سر محفوظة." };
  try {
    const password = decryptSecret(row.password_enc);
    await logAudit({ action: "login.revealed", entity: "shared_logins", entity_id: id, meta: { name: row.name } });
    return { ok: true, password };
  } catch {
    return { ok: false, error: "تعذّر فك التشفير." };
  }
}

export async function deleteLogin(id: string): Promise<{ ok: true } | Fail> {
  const w = await who();
  if (!w) return { ok: false, error: "سجّل الدخول أولاً." };
  const row = await mine(id, w);
  if (!row) return { ok: false, error: "لا صلاحية على هذا الحساب." };
  const { error } = await db().from("shared_logins").delete().eq("id", id);
  if (error) return { ok: false, error: "تعذّر الحذف." };
  await logAudit({ action: "login.deleted", entity: "shared_logins", entity_id: id, meta: { name: row.name } });
  return { ok: true };
}
