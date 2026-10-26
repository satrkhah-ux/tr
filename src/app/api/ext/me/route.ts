import { extCaller, extJson } from "@/lib/ext/auth";

export const runtime = "nodejs";

/**
 * GET /api/ext/me — the linked employee as the extension shows it: the name,
 * what the link may do, and which parts of the system they hold. The device
 * token is the only key (lib/ext/auth.ts); no cookie is read.
 */
export async function GET(request: Request) {
  const caller = await extCaller(request);
  if (caller instanceof Response) return caller;
  return extJson({
    ok: true,
    name: caller.name,
    scopes: caller.scopes,
    can: {
      offers: caller.can("offers.write"),
      clients: caller.can("clients.view"),
      operations: caller.can("operations.write") || caller.can("operations.own"),
    },
  });
}
