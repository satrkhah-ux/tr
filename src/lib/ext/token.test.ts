import { describe, expect, it } from "vitest";
import { bearerToken, deviceLabel, hashToken, linkUsable, mintToken } from "./token";

describe("«ربط الإضافة» — the device token", () => {
  it("mints 32 random bytes, and keeps only a sha256 that matches it", () => {
    const a = mintToken();
    const b = mintToken();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(hashToken(a.token));
    expect(a.token).not.toBe(b.token);
    expect(a.hash).not.toContain(a.token);
  });

  it("reads only a Bearer header holding something that can be a token", () => {
    const { token } = mintToken();
    expect(bearerToken(`Bearer ${token}`)).toBe(token);
    expect(bearerToken(`bearer  ${token} `)).toBe(token);
    expect(bearerToken(null)).toBeNull();
    expect(bearerToken(token)).toBeNull();
    expect(bearerToken("Bearer short")).toBeNull();
    expect(bearerToken(`Bearer ${token}x`)).toBeNull();
    expect(bearerToken(`Bearer ${token.slice(0, 42)}'`)).toBeNull();
  });

  it("refuses a revoked or expired link", () => {
    const now = Date.parse("2026-10-26T12:00:00Z");
    expect(linkUsable({ expires_at: "2026-11-25T12:00:00Z", revoked_at: null }, now)).toBe(true);
    expect(linkUsable({ expires_at: "2026-10-26T11:59:59Z", revoked_at: null }, now)).toBe(false);
    expect(linkUsable({ expires_at: "2026-11-25T12:00:00Z", revoked_at: "2026-10-26T10:00:00Z" }, now)).toBe(false);
    expect(linkUsable({ expires_at: "not a date", revoked_at: null }, now)).toBe(false);
  });

  it("names the device from the browser's own words", () => {
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36")).toBe("كروم — ويندوز");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/140.0 Safari/537.36 Edg/140.0")).toBe("إيدج — ويندوز");
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Chrome/140.0")).toBe("كروم — ماك");
  });
});
