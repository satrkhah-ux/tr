import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
let stored: string | null = "designed";
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: stored === null ? null : { pdf_cover: stored } }) }) }) }) }),
}));
const { getOfferCover, coverFromParam } = await import("./offer-cover");

describe("offer cover", () => {
  it("follows the stored choice, basic by default", async () => {
    stored = "designed";
    expect(await getOfferCover("S1")).toBe("designed");
    stored = "basic";
    expect(await getOfferCover("S1")).toBe("basic");
    stored = null;
    expect(await getOfferCover("S1")).toBe("basic");
  });
  it("a ?c= parameter names the cover outright, otherwise the stored one wins", async () => {
    stored = "designed";
    expect(await coverFromParam("S1", "b")).toBe("basic");
    expect(await coverFromParam("S1", null)).toBe("designed");
    stored = "basic";
    expect(await coverFromParam("S1", "d")).toBe("designed");
  });
});
