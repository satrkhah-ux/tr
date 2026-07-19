import { createHmac } from "node:crypto";

/**
 * Telegram Mini App `initData` verification — the security boundary of the
 * Telegram entry path. Telegram signs the payload it injects into the web app;
 * we recompute the HMAC exactly per the official spec:
 *   secret_key = HMAC_SHA256(key="WebAppData", message=bot_token)
 *   hash       = HMAC_SHA256(key=secret_key, message=data_check_string)
 * where data_check_string = sorted `key=value` pairs (hash excluded) joined
 * with "\n". A stale auth_date is rejected so captured payloads can't be
 * replayed indefinitely. Pure module (crypto only) — unit-tested.
 */

export type TelegramWebAppUser = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
};

export type VerifiedInitData = {
  user: TelegramWebAppUser;
  authDate: number;
};

/** Default freshness window: 24h (Telegram re-issues initData on each open). */
const MAX_AGE_SECONDS = 60 * 60 * 24;

export function verifyTelegramInitData(
  initData: string,
  botToken: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  maxAgeSeconds = MAX_AGE_SECONDS,
): VerifiedInitData | null {
  if (!initData || !botToken) return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }

  const hash = params.get("hash");
  if (!hash) return null;

  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === "hash") continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (expected !== hash) return null;

  const authDate = Number(params.get("auth_date") ?? 0);
  if (!Number.isFinite(authDate) || authDate <= 0) return null;
  if (nowSeconds - authDate > maxAgeSeconds) return null;

  const rawUser = params.get("user");
  if (!rawUser) return null;
  try {
    const user = JSON.parse(rawUser) as TelegramWebAppUser;
    if (typeof user.id !== "number" || user.id <= 0) return null;
    return { user, authDate };
  } catch {
    return null;
  }
}

/** Build a signed initData string — TEST HELPER (mirrors Telegram's signing). */
export function signInitDataForTest(
  fields: Record<string, string>,
  botToken: string,
): string {
  const pairs = Object.entries(fields).map(([k, v]) => `${k}=${v}`);
  pairs.sort();
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secretKey).update(pairs.join("\n")).digest("hex");
  const params = new URLSearchParams(fields);
  params.set("hash", hash);
  return params.toString();
}
