import { cache } from "react";
import { ttlCache } from "@/lib/ttl-cache";
import { cookies } from "next/headers";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { Database } from "@/lib/types";
import { AUTH_STORAGE_KEY, getSupabaseEnv, parseSessionCookie } from "./constants";
import { systemActor, systemUser } from "./system-actor";

/**
 * Server-side Supabase client for RSC / route handlers. Reads the session from
 * the request cookie (set by the browser client) and forwards the access token
 * so PostgREST applies the correct row-level-security context. Never writes
 * cookies (RSC cannot); token refresh happens on the browser.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient<Database>> {
  // a server job (system-actor.ts) has no session: its own gates stand for RLS
  if (systemActor()) return createSupabaseServiceClient();
  const { url, anonKey } = getSupabaseEnv();
  const cookieStore = await cookies();
  const session = parseSessionCookie(cookieStore.get(AUTH_STORAGE_KEY)?.value);

  return createClient<Database>(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: session
      ? { headers: { Authorization: `Bearer ${session.accessToken}` } }
      : undefined,
  });
}

/**
 * SERVICE-ROLE client — BYPASSES row-level security. SERVER ONLY. Used exclusively
 * for admin-gated access to the supplier credential vault (hotel_suppliers) and the
 * audit log, which regular authenticated users must NOT reach via PostgREST. The
 * caller is responsible for its own admin gate; results carrying secrets must never
 * be returned to the browser (see src/lib/data/suppliers.ts maskRow).
 */
export function createSupabaseServiceClient(): SupabaseClient<Database> {
  const { url } = getSupabaseEnv();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set — supplier credential access requires it.");
  }
  return createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Returns the authenticated user (validated against Supabase Auth) or null. */
export async function getServerUser(): Promise<User | null> {
  const system = systemActor();
  if (system) return systemUser(system);
  const cookieStore = await cookies();
  const session = parseSessionCookie(cookieStore.get(AUTH_STORAGE_KEY)?.value);
  if (!session) return null;
  return userForToken(session.accessToken);
}

/**
 * One round trip to Supabase Auth per token per request. Every permission
 * check, draft read and employee lookup asks for the user, and each used to
 * validate the token again — opening a file's status panel waited on four of
 * them in a row. Keyed by the token, so a sign-in or sign-out inside the same
 * request (a new cookie) is still validated fresh.
 */
const usersByToken = ttlCache<string, User>(60_000);

const userForToken = cache(async (accessToken: string): Promise<User | null> => {
  // across requests too: the token is a signed JWT valid ~1 h, and validating it
  // is a Frankfurt → Mumbai round trip on every navigation (lib/ttl-cache.ts)
  const known = usersByToken.get(accessToken);
  if (known) return known;
  try {
    const { url, anonKey } = getSupabaseEnv();
    const supabase = createClient<Database>(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error) return null;
    if (data.user) usersByToken.set(accessToken, data.user);
    return data.user;
  } catch {
    return null;
  }
});
