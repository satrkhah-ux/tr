import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { SCREENS_BUCKET } from "@/lib/office-screens/config";
import { ttlCache } from "@/lib/ttl-cache";

export const runtime = "nodejs";

/**
 * An ad for the screens, 1920×1080, served by pkg itself (the evaluator,
 * 2026-10-19: Supabase's Free plan allows 5 GB of egress a month). The name is
 * the ad's id, which changes with every upload, so the browser keeps it for a
 * year and pkg keeps it in memory: Storage is asked once per ad per server
 * start, not by every TV on every turn. Public, like the screens.
 */
const kept = ttlCache<string, ArrayBuffer>(24 * 3600_000, 60);

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }): Promise<Response> {
  const { file } = await ctx.params;
  const m = /^([a-z0-9-]{4,40})\.jpg$/.exec(file);
  if (!m) return new Response(null, { status: 404 });
  let body = kept.get(m[1]);
  if (!body) {
    const { data, error } = await (createSupabaseServiceClient() as unknown as SupabaseClient).storage.from(SCREENS_BUCKET).download(`${m[1]}/1080.jpg`);
    if (error || !data) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    body = await data.arrayBuffer();
    kept.set(m[1], body);
  }
  return new Response(body, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" } });
}
