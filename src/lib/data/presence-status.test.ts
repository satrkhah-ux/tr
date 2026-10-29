import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_LIMITS } from "@/lib/presence/excuse";

type Call = {
  table: string;
  op: "select" | "insert" | "update";
  payload?: Record<string, unknown>;
  filters: unknown[][];
};
const state = vi.hoisted(() => ({
  me: null as string | null,
  perms: [] as string[],
  calls: [] as Call[],
  single: {} as Record<string, unknown>,
}));

/** a Supabase builder that remembers what was asked of it */
function from(table: string) {
  const call: Call = { table, op: "select", filters: [] };
  state.calls.push(call);
  const filter =
    (name: string) =>
    (...a: unknown[]) => {
      call.filters.push([name, ...a]);
      return b;
    };
  const b = {
    select: () => b,
    insert: (p: Record<string, unknown>) =>
      Object.assign(call, { op: "insert", payload: p }) && b,
    update: (p: Record<string, unknown>) =>
      Object.assign(call, { op: "update", payload: p }) && b,
    eq: filter("eq"),
    is: filter("is"),
    in: filter("in"),
    not: filter("not"),
    order: filter("order"),
    maybeSingle: async () => ({
      data: state.single[table] ?? null,
      error: null,
    }),
    then: (ok: (v: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(ok),
  };
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => ({ from }),
}));
vi.mock("./metrics", () => ({ getCurrentEmployeeId: async () => state.me }));
vi.mock("@/lib/roles/current", () => ({
  currentCan: async (p: string) => state.perms.includes(p),
}));
vi.mock("@/lib/presence/availability", () => ({
  loadLimits: async () => DEFAULT_LIMITS,
}));
vi.mock("./audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/telegram/staff-bot", () => ({
  escapeHtml: (s: string) => s,
  staffSend: vi.fn(),
}));
import { endMyStatus, saveMyClient, startMyStatus } from "./presence-status";

const ME = "11111111-1111-4111-8111-111111111111";
const RASHA = "22222222-2222-4222-8222-222222222222";
const writes = () =>
  state.calls.filter(
    (c) => c.op !== "select" && c.table === "employee_status_events",
  );

beforeEach(() => {
  state.me = ME;
  state.perms = ["status.client", "status.call", "status.prayer"];
  state.calls = [];
  state.single = {};
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-29T09:00:00.000Z"));
});
afterEach(() => vi.useRealTimers());

describe("«لدي عميل» / «لدي اتصال» start at the press", () => {
  it("the minutes run from the press — nothing to fill first", async () => {
    expect(await startMyStatus("call")).toEqual({ ok: true });
    const [closeOld, open] = writes();
    // whatever was on ends at the same second
    expect(closeOld).toMatchObject({
      op: "update",
      payload: { ended_at: "2026-10-29T09:00:00.000Z", ended_by: "employee" },
    });
    expect(open).toMatchObject({
      op: "insert",
      payload: {
        employee_id: ME,
        kind: "call",
        started_at: "2026-10-29T09:00:00.000Z",
        cap_at: new Date(
          Date.parse("2026-10-29T09:00:00.000Z") + DEFAULT_LIMITS.call * 60_000,
        ).toISOString(),
        details: {},
        client_phone: null,
      },
    });
  });

  it("only with the button's permission", async () => {
    state.perms = ["status.prayer"];
    expect(await startMyStatus("client")).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(writes()).toEqual([]);
  });
});

describe("the client is typed while the status runs", () => {
  it("kept on the open client / call — the phone as digits for routing, the colleague asked for checked", async () => {
    state.single.employees = { arabic_name: " رشا " };
    const r = await saveMyClient({
      want: "بكج",
      name: "أبو فهد",
      phone: "0500000000",
      destination: "",
      note: "",
      for_employee: RASHA,
    });
    expect(r).toEqual({ ok: true, badPhone: false });
    const [save] = writes();
    expect(save.payload).toEqual({
      details: {
        want: "بكج",
        destination: "",
        name: "أبو فهد",
        phone: "966500000000",
        note: "",
        for_employee: RASHA,
        for_name: "رشا",
      },
      client_phone: "966500000000",
    });
    // only the running client / call of this colleague
    expect(save.filters).toEqual([
      ["eq", "employee_id", ME],
      ["is", "ended_at", null],
      ["in", "kind", ["client", "call"]],
    ]);
  });

  it("a colleague who cannot take clients is dropped; a bad phone is kept as typed and finds nobody", async () => {
    const r = await saveMyClient({
      name: "سارة",
      phone: "12",
      for_employee: RASHA,
    });
    expect(r).toEqual({ ok: true, badPhone: true });
    expect(writes()[0].payload).toMatchObject({
      details: { name: "سارة", phone: "12", for_employee: "", for_name: "" },
      client_phone: null,
    });
  });
});

describe("ending stops the timer — nothing else", () => {
  it("nothing typed: it just ends", async () => {
    expect(await endMyStatus()).toEqual({ ok: true });
    expect(writes()).toEqual([
      {
        table: "employee_status_events",
        op: "update",
        payload: { ended_at: "2026-10-29T09:00:00.000Z", ended_by: "employee" },
        filters: [
          ["eq", "employee_id", ME],
          ["is", "ended_at", null],
        ],
      },
    ]);
  });

  it("a phone typed: kept for routing, then it ends", async () => {
    expect(
      await endMyStatus({
        want: "",
        name: "",
        phone: "0555555555",
        destination: "",
        note: "",
        for_employee: "",
      }),
    ).toEqual({ ok: true });
    const [save, end] = writes();
    expect(save.payload).toMatchObject({ client_phone: "966555555555" });
    expect(end.payload).toEqual({
      ended_at: "2026-10-29T09:00:00.000Z",
      ended_by: "employee",
    });
  });

  it("nobody signed in: nothing", async () => {
    state.me = null;
    expect(await endMyStatus()).toEqual({ ok: false, error: "forbidden" });
    expect(await saveMyClient({ name: "x" })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(writes()).toEqual([]);
  });
});
