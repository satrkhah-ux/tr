import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
const state = vi.hoisted(() => ({ manual: false, complete: true, patches: [] as Record<string, unknown>[], guards: [] as unknown[][] }));
vi.mock("@/lib/providers/teletel", () => ({
  conversationThread: async () => ({ historyComplete: state.complete, messages: [
    { id: 1, at: 1, text: "تأشيرة أمريكا", fromClient: true, isPrivate: false },
    { id: 2, at: 2, text: "مكان الموعد؟", fromClient: false, isPrivate: false },
    { id: 3, at: 3, text: "جدة", fromClient: true, isPrivate: false },
  ] }),
  teletelGet: async () => ({ labels: [] }),
}));
vi.mock("@/lib/leads/lifecycle", () => ({}));
vi.mock("@/lib/murad/core", () => ({}));
vi.mock("@/lib/data/audit", () => ({}));
import { refreshClosedClassification } from "./teletel-pull";

function client() {
  return { from: () => {
    const query = {
      select: () => query,
      eq: (...args: unknown[]) => { state.guards.push(args); return query; },
      is: (...args: unknown[]) => { state.guards.push(args); return query; },
      or: (...args: unknown[]) => { state.guards.push(args); return query; },
      maybeSingle: async () => ({ data: { id: "lead", destination: "جدة", destination_source: state.manual ? "manual" : "client", inquiry: "بكج", inquiry_source: "auto", created_at: "1970-01-01T00:00:01Z", last_visit_at: "1970-01-01T00:00:03Z" } }),
      update: (patch: Record<string, unknown>) => { state.patches.push(patch); return query; },
      then: (resolve: (value: { data: never[]; error: null }) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return query;
  } } as unknown as SupabaseClient;
}

describe("classification when a conversation closes between pulls", () => {
  beforeEach(() => { state.manual = false; state.complete = true; state.patches = []; state.guards = []; });
  it("uses the whole request and guards against a later visit or manual edit", async () => {
    await refreshClosedClassification(client(), 1);
    expect(state.patches).toEqual([expect.objectContaining({ destination: "الولايات المتحدة", inquiry: "تأشيرات" })]);
    expect(state.guards).toContainEqual(["last_visit_at", "1970-01-01T00:00:03Z"]);
    expect(state.guards).toContainEqual(["destination_source.is.null,destination_source.neq.manual"]);
  });
  it("preserves a manually recorded destination while fixing the automatic service", async () => {
    state.manual = true;
    await refreshClosedClassification(client(), 1);
    expect(state.patches).toHaveLength(1);
    expect(state.patches[0]).not.toHaveProperty("destination");
    expect(state.patches[0].inquiry).toBe("تأشيرات");
  });
  it("does not replace stored information using incomplete history", async () => {
    state.complete = false;
    await refreshClosedClassification(client(), 1);
    expect(state.patches).toEqual([]);
  });
});
