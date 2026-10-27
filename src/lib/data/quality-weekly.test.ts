import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: vi.fn() }));
vi.mock("./ops-notify", () => ({ notifyOps: vi.fn() }));
import { qualityCounts } from "./quality-weekly";

describe("quality count reads", () => {
  it("preserves the database failure instead of misreporting every error as missing setup", async () => {
    for (const code of ["57014", "PGRST202", "PGRST301", "42501"]) {
      const error = { code, message: "database failure" };
      const rpc = vi.fn().mockResolvedValue({ data: null, error });
      await expect(qualityCounts({ rpc } as unknown as SupabaseClient)).rejects.toBe(error);
      expect(rpc).toHaveBeenCalledWith("data_quality_counts");
    }
  });

  it("keeps a zero issue count as a valid result", async () => {
    const rows = [{ issue: "hotel_no_city", total: 0, used: 0 }];
    const rpc = vi.fn().mockResolvedValue({ data: rows, error: null });
    await expect(qualityCounts({ rpc } as unknown as SupabaseClient)).resolves.toEqual(rows);
  });
});
