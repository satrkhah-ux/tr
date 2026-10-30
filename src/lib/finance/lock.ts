/**
 * The finance password's unlock token (the owner, 2026-10-30: «الدخول بكلمة سر للادارة … جلسة مفتوحة
 * تنتهي بعد مدة خمول»). One password guards «الحسابات المالية» and «الحسابات»; an unlock lasts
 * IDLE_MINUTES from the last use and every use renews it (touchFinanceUnlock).
 *
 * The token is `<expires ms>.<HMAC(stored hash, user id + expiry)>`: only the server, holding the hash,
 * can make one; a new password ends every open session; a copied cookie dies at its expiry. Pure.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const IDLE_MINUTES = 30;
export const IDLE_MS = IDLE_MINUTES * 60_000;

const sign = (hash: string, userId: string, expires: number) => createHmac("sha256", hash).update(`${userId}.${expires}`).digest("hex");

export function makeUnlockToken(hash: string, userId: string, now: number): string {
  const expires = now + IDLE_MS;
  return `${expires}.${sign(hash, userId, expires)}`;
}

export function unlockTokenValid(value: string | undefined, hash: string, userId: string, now: number): boolean {
  if (!value || !hash || !userId) return false;
  const dot = value.indexOf(".");
  const expires = Number(value.slice(0, dot));
  if (dot < 1 || !Number.isFinite(expires) || expires <= now || expires > now + IDLE_MS) return false;
  const want = sign(hash, userId, expires);
  const got = value.slice(dot + 1);
  return got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
