import { describe, expect, it } from "vitest";
import { PARTNER_PREFIXES, partnerIdFromToken, underAny } from "./route-guard";

const token = (payload: object) =>
  `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;

describe("the partner's way through the proxy", () => {
  it("reads the partner company from the token, Arabic name and all", () => {
    expect(partnerIdFromToken(token({ sub: "u1", user_metadata: { partner_id: "p-42", partner_name: "ترافليون التقني — شركة تجريبية" } }))).toBe("p-42");
  });

  it("finds no partner on a staff token, a broken token or an empty id", () => {
    expect(partnerIdFromToken(token({ sub: "u2", user_metadata: { self_registered: true } }))).toBeNull();
    expect(partnerIdFromToken(token({ user_metadata: { partner_id: "" } }))).toBeNull();
    expect(partnerIdFromToken("not-a-jwt")).toBeNull();
  });

  it("lets a partner into its portal and its files, and nowhere of ours", () => {
    for (const ok of ["/b2b", "/b2b/profile", "/package-generator/abc/trip", "/offer/AD-1/preview", "/ready-offers", "/welcome-board/AD-1", "/basic", "/basic/abc"]) {
      expect(underAny(ok, PARTNER_PREFIXES)).toBe(true);
    }
    for (const no of ["/dashboard", "/kanban-board", "/operations/1", "/customers", "/settings", "/partner-companies", "/b2bx", "/basics"]) {
      expect(underAny(no, PARTNER_PREFIXES)).toBe(false);
    }
  });
});
