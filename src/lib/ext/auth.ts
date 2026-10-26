import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { grantedPermissions, type Permission } from "@/lib/roles/roles";
import { bearerToken, EXT_SCOPES, hashToken, linkUsable, type ExtScope } from "./token";

/**
 * Who is calling /api/ext/* — from the device token alone, never a cookie (the
 * extension's own fetch would race the proxy's refresh of the staff session, and
 * a cookie could not be revoked for one device). /api/ext is public in the
 * proxy for this reason: each route asks here first.
 *
 * Refused (401) once the link is revoked or expired; refused (403) once the
 * employee is no longer Active or holds nothing. What a request may do is the
 * link's scopes AND the employee's permissions as they are today.
 */
export type ExtCaller = {
  linkId: string;
  employeeId: string;
  name: string;
  scopes: ExtScope[];
  permissions: Permission[];
  can: (p: Permission) => boolean;
};

const NO_STORE = { "Cache-Control": "no-store" };

export function extJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;

/** a device opens its popup and panel now and then (and, from stage 2, checks once a minute); far below this */
const hits = new Map<string, { n: number; since: number }>();
function allow(linkId: string, now: number): boolean {
  const h = hits.get(linkId);
  if (!h || now - h.since > 60_000) {
    if (hits.size > 5000) hits.clear();
    hits.set(linkId, { n: 1, since: now });
    return true;
  }
  h.n += 1;
  return h.n <= 120;
}

type LinkRecord = {
  id: string;
  employee_id: string;
  scopes: string[] | null;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
};

type EmployeeRecord = {
  id: string;
  arabic_name: string | null;
  status: string | null;
  extra_permission_keys: string[] | null;
  removed_permission_keys: string[] | null;
  roles: { permission_keys: string[] } | { permission_keys: string[] }[] | null;
};

/** The caller, or the response to send instead. */
export async function extCaller(request: Request, need?: ExtScope): Promise<ExtCaller | NextResponse> {
  const token = bearerToken(request.headers.get("authorization"));
  if (!token) return extJson({ ok: false, error: "unlinked" }, 401);
  const now = Date.now();
  const { data: linkData, error: linkError } = await db()
    .from("extension_links")
    .select("id, employee_id, scopes, expires_at, revoked_at, last_used_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  // the database not answering is not «unlinked»: the extension would drop a token that is still good
  if (linkError) return extJson({ ok: false, error: "unavailable" }, 503);
  const link = linkData as LinkRecord | null;
  if (!link || !linkUsable(link, now)) return extJson({ ok: false, error: "unlinked" }, 401);
  if (!allow(link.id, now)) return extJson({ ok: false, error: "slow_down" }, 429);

  const { data: empData, error: empError } = await db()
    .from("employees")
    .select("id, arabic_name, status, extra_permission_keys, removed_permission_keys, roles(permission_keys)")
    .eq("id", link.employee_id)
    .maybeSingle();
  if (empError) return extJson({ ok: false, error: "unavailable" }, 503);
  const employee = empData as EmployeeRecord | null;
  const role = Array.isArray(employee?.roles) ? employee.roles[0] : employee?.roles;
  // the same rule as the session's (roles/current.ts) and the database's staff_can(): Active, the role's keys ± the person's
  const permissions = grantedPermissions(
    employee
      ? {
          status: employee.status,
          permission_keys: role?.permission_keys ?? null,
          extra_permission_keys: employee.extra_permission_keys,
          removed_permission_keys: employee.removed_permission_keys,
        }
      : null,
  );
  if (!employee || permissions.length === 0) return extJson({ ok: false, error: "inactive" }, 403);

  const scopes = (link.scopes ?? []).filter((s): s is ExtScope => (EXT_SCOPES as readonly string[]).includes(s));
  if (need && !scopes.includes(need)) return extJson({ ok: false, error: "scope" }, 403);

  // when it was last used, for the devices list — at most a write every five minutes
  if (!link.last_used_at || now - Date.parse(link.last_used_at) > 5 * 60_000) {
    void db().from("extension_links").update({ last_used_at: new Date(now).toISOString() }).eq("id", link.id).then(() => undefined);
  }
  const held = new Set(permissions);
  return {
    linkId: link.id,
    employeeId: employee.id,
    name: employee.arabic_name?.trim() || "",
    scopes,
    permissions,
    can: (p) => held.has(p),
  };
}
