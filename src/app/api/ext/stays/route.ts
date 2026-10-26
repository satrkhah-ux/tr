import { extCaller, extJson } from "@/lib/ext/auth";
import { myProposals } from "@/lib/ext/stays";

export const runtime = "nodejs";

/** GET /api/ext/stays — the employee's own open proposals and their stays, to send a captured hotel price into. */
export async function GET(request: Request) {
  const caller = await extCaller(request, "prices");
  if (caller instanceof Response) return caller;
  if (!caller.can("offers.write")) return extJson({ ok: false, error: "forbidden" }, 403);
  try {
    return extJson({ ok: true, proposals: await myProposals(caller) });
  } catch {
    return extJson({ ok: false, error: "unavailable" }, 503);
  }
}
