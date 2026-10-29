import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto/secrets";

/**
 * getSecret(name): the ONE server-only reader of an API key or token — the
 * value saved in «المفاتيح والتوكنات» (app_secrets, AES-GCM vault) if any,
 * else the server's environment. Re-read once a minute, so a key saved on the
 * page works without a redeploy. A missing table, a missing vault key or a
 * tampered blob falls back to the environment silently.
 *
 * NEVER return what this gives to a browser, and never log it.
 */

const TTL_MS = 60_000;
let cache: { at: number; values: Map<string, string> } | null = null;

async function vault(): Promise<Map<string, string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.values;
  const values = new Map<string, string>();
  try {
    const db = createSupabaseServiceClient() as unknown as SupabaseClient;
    const { data } = await db.from("app_secrets").select("name, value_enc");
    for (const row of (data ?? []) as { name: string; value_enc: string }[]) {
      try {
        values.set(row.name, decryptSecret(row.value_enc));
      } catch {
        /* this one undecryptable: its env value still answers */
      }
    }
  } catch {
    /* no table yet, no database: the environment answers */
  }
  cache = { at: Date.now(), values };
  return values;
}

export async function getSecret(name: string): Promise<string | undefined> {
  return (await vault()).get(name) || process.env[name] || undefined;
}

/** where a name's value comes from now — for the page, never the value itself */
export async function secretSource(name: string): Promise<"vault" | "env" | null> {
  if ((await vault()).get(name)) return "vault";
  return process.env[name] ? "env" : null;
}

/** after a save or a clear: the next read sees it at once */
export function forgetSecrets(): void {
  cache = null;
}
