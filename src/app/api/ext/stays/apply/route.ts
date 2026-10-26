import { extCaller, extJson } from "@/lib/ext/auth";
import { applyCapturedPrice, type ApplyInput } from "@/lib/ext/stays";

export const runtime = "nodejs";

/**
 * POST /api/ext/stays/apply {draftId, cityKey, hotelName, amount, currency, site}
 * — «أرسل إلى الملف»: the price the employee confirmed in the extension's form,
 * into their own proposal draft, as «قارن» writes it (lib/ext/stays.ts).
 */
export async function POST(request: Request) {
  const caller = await extCaller(request, "prices");
  if (caller instanceof Response) return caller;
  if (!caller.can("offers.write")) return extJson({ ok: false, error: "forbidden" }, 403);
  const body = (await request.json().catch(() => null)) as Partial<ApplyInput> | null;
  if (!body) return extJson({ ok: false, error: "bad_body" }, 400);
  const r = await applyCapturedPrice(caller, body as ApplyInput);
  return extJson(r, r.ok ? 200 : 400);
}
