import { describe, expect, it } from "vitest";
import { parseSessionCookie, sessionJson } from "./constants";

const json = JSON.stringify({ access_token: "a.b.c", refresh_token: "r", expires_at: 10 });

describe("the session cookie, however it was encoded", () => {
  it("reads it once-encoded (the browser's own write) and twice-encoded (a server write before the fix)", () => {
    expect(sessionJson(encodeURIComponent(json))).toBe(json);
    expect(sessionJson(encodeURIComponent(encodeURIComponent(json)))).toBe(json);
    expect(sessionJson(json)).toBe(json);
  });

  it("parses the token from each, and treats garbage as signed out", () => {
    for (const raw of [json, encodeURIComponent(json), encodeURIComponent(encodeURIComponent(json))]) {
      expect(parseSessionCookie(raw)).toEqual({ accessToken: "a.b.c", refreshToken: "r", expiresAt: 10 });
    }
    expect(parseSessionCookie("%E0%A4%A")).toBeNull();
  });
});
