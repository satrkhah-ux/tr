import { describe, expect, it } from "vitest";
import { integrationLink, type LinkContext } from "./integration-links";

const ctx: LinkContext = { site: "https://pkg.traveliun.com", readySheet: "1qUeTaABC", leadsSheet: "1jCwYeXYZ", teletel: "https://chat.teletel.sa" };
const row = (over: Partial<{ kind: string; name: string; check_key: string | null; notes: string | null }>) => ({ kind: "api", name: "x", check_key: null, notes: null, ...over });

describe("«الربط الخارجي» — the link each row opens", () => {
  it("opens the two sheets the system reads, by the ids it reads them by", () => {
    expect(integrationLink(row({ kind: "sheet", check_key: "sheet_ready_offers" }), ctx)).toEqual({ url: "https://docs.google.com/spreadsheets/d/1qUeTaABC", label: "فتح الشيت" });
    expect(integrationLink(row({ kind: "sheet", check_key: "sheet_leads" }), ctx)?.url).toBe("https://docs.google.com/spreadsheets/d/1jCwYeXYZ");
    expect(integrationLink(row({ kind: "sheet", check_key: "sheet_leads" }), { ...ctx, leadsSheet: null })).toBeNull();
  });

  it("opens Teletel, the site and a bot by its @name", () => {
    expect(integrationLink(row({ check_key: "teletel" }), ctx)).toEqual({ url: "https://chat.teletel.sa", label: "chat.teletel.sa" });
    expect(integrationLink(row({ kind: "domain", check_key: "tls_pkg" }), ctx)?.label).toBe("pkg.traveliun.com");
    expect(integrationLink(row({ kind: "bot", name: "@spytraveliunbot — عين الإدارة", check_key: "bot_eye" }), ctx)?.url).toBe("https://t.me/spytraveliunbot");
  });

  it("shows a link typed in the notes, never one that could carry a key or a webhook", () => {
    expect(integrationLink(row({ notes: "اللوحة: https://ads.example.com/report" }), ctx)?.url).toBe("https://ads.example.com/report");
    expect(integrationLink(row({ notes: "https://api.x.com/v1?api_key=abc" }), ctx)).toBeNull();
    expect(integrationLink(row({ notes: "https://script.google.com/macros/s/AKfy/exec" }), ctx)).toBeNull();
    expect(integrationLink(row({ notes: "بلا رابط" }), ctx)).toBeNull();
  });
});
