import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/secrets/get", () => ({ getSecret: async () => undefined }));
const { verifyNotificationToken } = await import("./tamara");

const KEY = "notification-key";
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims: object, key = KEY, header: object = { alg: "HS256", typ: "JWT" }) => {
  const head = `${b64(header)}.${b64(claims)}`;
  return `${head}.${createHmac("sha256", key).update(head).digest("base64url")}`;
};
const now = Date.parse("2026-10-29T12:00:00Z");
const exp = now / 1000 + 600;

describe("Tamara's webhook token (tamaraToken, HS256 with the Notification key)", () => {
  it("accepts Tamara's own signed, unexpired token", () => {
    expect(verifyNotificationToken(jwt({ exp, iat: exp - 900, iss: "Tamara" }), KEY, now)).toBe(true);
  });

  it("refuses unsigned, forged, expired, other-issuer and alg-swapped tokens", () => {
    expect(verifyNotificationToken("", KEY, now)).toBe(false);
    expect(verifyNotificationToken(jwt({ exp, iss: "Tamara" }, "wrong-key"), KEY, now)).toBe(false);
    expect(verifyNotificationToken(jwt({ exp: now / 1000 - 1, iss: "Tamara" }), KEY, now)).toBe(false);
    expect(verifyNotificationToken(jwt({ iss: "Tamara" }), KEY, now)).toBe(false);
    expect(verifyNotificationToken(jwt({ exp, iss: "Someone" }), KEY, now)).toBe(false);
    expect(verifyNotificationToken(`${b64({ alg: "none" })}.${b64({ exp, iss: "Tamara" })}.`, KEY, now)).toBe(false);
    // the payload edited after signing
    const [h, , s] = jwt({ exp, iss: "Tamara" }).split(".");
    expect(verifyNotificationToken(`${h}.${b64({ exp: exp + 9999, iss: "Tamara" })}.${s}`, KEY, now)).toBe(false);
    // no key configured: nothing is trusted
    expect(verifyNotificationToken(jwt({ exp, iss: "Tamara" }), "", now)).toBe(false);
  });
});
