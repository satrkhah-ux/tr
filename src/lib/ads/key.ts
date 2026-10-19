import "server-only";
import { createHash } from "node:crypto";

/**
 * The key in the Ads Script's URL (app/api/ads/hook): a hash of
 * ADMIN_API_SECRET with its own label — never the secret, never in the repo.
 * On the server: printf 'ads-hook:%s' "$ADMIN_API_SECRET" | sha256sum | cut -c1-40
 */
export function adsHookKey(): string | null {
  const secret = process.env["ADMIN_API_SECRET"];
  return secret ? createHash("sha256").update(`ads-hook:${secret}`).digest("hex").slice(0, 40) : null;
}
