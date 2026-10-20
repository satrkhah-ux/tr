import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultControl } from "@/lib/murad/control";

const state = vi.hoisted(() => ({ permissions: [] as string[], db: vi.fn() }));
vi.mock("@/lib/roles/current", () => ({ currentCan: async (p: string) => state.permissions.includes(p) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: state.db, getServerUser: async () => ({ id: "user" }) }));
vi.mock("@/lib/data/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/manager-screen/snapshot", () => ({ managerSnapshot: async () => null }));
vi.mock("@/lib/providers/teletel", () => ({ listTeletelTeams: async () => [], teletelGet: async () => null }));
import { getMuradControl, saveMuradControl } from "./murad-control";
import { getManagementDecisions, createManagementDecision, updateManagementDecision } from "./management-decisions";

beforeEach(() => { state.permissions = []; state.db.mockClear(); });
describe("management server authorization", () => {
  it("rejects direct reads and writes by staff without management permissions", async () => {
    state.permissions = ["offers.write", "pricing.internal"];
    expect(await getMuradControl()).toBeNull();
    expect(await getManagementDecisions()).toBeNull();
    expect((await saveMuradControl(defaultControl())).ok).toBe(false);
    expect((await createManagementDecision({ title: "قرار", ownerId: "", dueOn: "", sourceKey: "" })).ok).toBe(false);
    expect((await updateManagementDecision("id", "done", "")).ok).toBe(false);
    expect(state.db).not.toHaveBeenCalled();
  });
  it("rejects malformed controls before making a privileged database call", async () => {
    state.permissions = ["developer.access"];
    expect((await saveMuradControl({ ...defaultControl(), teamIds: [-1] })).ok).toBe(false);
    expect(state.db).not.toHaveBeenCalled();
  });
  it("rejects impossible dates and missing responsible employees", async () => {
    state.permissions = ["dashboard.admin"];
    expect((await createManagementDecision({ title: "قرار", ownerId: "00000000-0000-0000-0000-000000000000", dueOn: "2026-02-30", sourceKey: "" })).ok).toBe(false);
    expect(state.db).not.toHaveBeenCalled();
  });
});
