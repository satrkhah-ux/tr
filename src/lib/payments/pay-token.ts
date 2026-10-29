import { createHmac, timingSafeEqual } from "node:crypto";
import type { PayVia } from "./pay-now-rules";

/**
 * A custom amount on the public «ادفع الآن» page (/pay/<serial>?a=<token>): a deposit or an instalment the
 * employee chose. The amount is signed with the server's secret together with the serial and an expiry, so a
 * client who edits the link — or moves it to another file — is refused, never charged a figure of their own.
 */

const DAY = 86_400_000;
const TTL_DAYS = 30;

// a Tamara link signs its way too (`|tamara`), so the client cannot carry the amount to the other gateway; MyFatoorah keeps the first form
const mac = (secret: string, serial: string, cents: number, exp: number, via: PayVia) =>
  createHmac("sha256", secret).update(`pay|${serial}|${cents}|${exp}${via === "tamara" ? "|tamara" : ""}`).digest().subarray(0, 16).toString("base64url");

export function signAmount(secret: string, serial: string, amount: number, now = Date.now(), via: PayVia = "myfatoorah"): string {
  const cents = Math.round(amount * 100);
  const exp = Math.floor(now / DAY) + TTL_DAYS;
  return `${cents.toString(36)}.${exp.toString(36)}.${mac(secret, serial, cents, exp, via)}`;
}

/** The signed amount, or null when the token is not ours, not this file's, or past its day. */
export function readAmount(secret: string, serial: string, token: string | null | undefined, now = Date.now(), via: PayVia = "myfatoorah"): number | null {
  const [c, e, sig] = String(token ?? "").split(".");
  if (!c || !e || !sig) return null;
  const cents = parseInt(c, 36);
  const exp = parseInt(e, 36);
  if (!Number.isSafeInteger(cents) || cents <= 0 || !Number.isSafeInteger(exp)) return null;
  const want = Buffer.from(mac(secret, serial, cents, exp, via));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  if (Math.floor(now / DAY) > exp) return null;
  return cents / 100;
}
