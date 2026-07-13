import { cookies } from "next/headers";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { Database } from "@/lib/types";
import { AUTH_STORAGE_KEY, getSupabaseEnv, parseSessionCookie } from "./constants";

/**
 * Server-side Supabase client for RSC / route handlers. Reads the session from
 * the request cookie (set by the browser client) and forwards the access token
 * so PostgREST applies the correct row-level-security context. Never writes
 * cookies (RSC cannot); token refresh happens on the browser.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient<Database>> {
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
  const cookieStore = await cookies();
  const session = parseSessionCookie(cookieStore.get(AUTH_STORAGE_KEY)?.value);
  if (!session) return null;

  try {
    const { url, anonKey } = getSupabaseEnv();
    const supabase = createClient<Database>(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await supabase.auth.getUser(session.accessToken);
    if (error) return null;
    return data.user;
  } catch {
    return null;
  }
}
