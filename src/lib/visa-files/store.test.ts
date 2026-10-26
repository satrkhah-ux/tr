/* eslint-disable @typescript-eslint/no-explicit-any -- a hand-made stand-in for the query builder */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const world = {
  row: null as Record<string, any> | null,
  events: [] as any[],
  writes: 0,
  permissions: ["visas.work"] as string[],
  /** runs just before an update is applied — where a colleague saves in between */
  beforeWrite: null as null | (() => void),
};

vi.mock("@/lib/supabase/server", () => ({
  getServerUser: async () => ({ id: "user" }),
  createSupabaseServiceClient: () => ({
    from: () => {
      const q = { op: "select", filters: {} as Record<string, unknown>, patch: {} as Record<string, unknown> };
      const api: any = {
        select: () => api,
        update: (patch: Record<string, unknown>) => {
          q.op = "update";
          q.patch = patch;
          return api;
        },
        insert: async (rows: any[]) => {
          world.events.push(...rows);
          return { error: null };
        },
        eq: (key: string, value: unknown) => {
          q.filters[key] = value;
          return api;
        },
        maybeSingle: async () => ({ data: world.row ? { ...world.row } : null, error: null }),
        // awaiting the update chain
        then: (resolve: (v: unknown) => void) => {
          world.beforeWrite?.();
          if (q.op === "update" && world.row && world.row.rev === q.filters.rev) {
            Object.assign(world.row, q.patch);
            world.writes += 1;
            return resolve({ data: [{ id: world.row.id }], error: null });
          }
          return resolve({ data: [], error: null });
        },
      };
      return api;
    },
  }),
}));
vi.mock("@/lib/roles/current", () => ({ currentPermissions: async () => world.permissions }));
vi.mock("@/lib/data/metrics", () => ({ getCurrentEmployeeId: async () => ME }));
vi.mock("@/lib/data/audit", () => ({ logAudit: async () => true }));

const { gate, mutateFile, ERR } = await import("./store");
const { visaCaller } = await import("./access");

const fresh = () => ({ id: ID, serial: "VF-26-0001", status: "new", country: "جورجيا", applicants: 1, client_name: "عميل", assigned_to: ME, rev: 0, currency: "SAR", fee_service: 0, fee_embassy: 0, paid: 0, note: null });

beforeEach(() => {
  world.row = fresh();
  world.events = [];
  world.writes = 0;
  world.permissions = ["visas.work"];
  world.beforeWrite = null;
});

describe("gate — who is asking", () => {
  it("lets a worker work, and only the management run the department", async () => {
    expect(await gate()).toMatchObject({ ok: true, caller: { work: true, manage: false, employeeId: ME } });
    expect(await gate("manage")).toEqual({ ok: false, error: ERR.forbidden });
    world.permissions = ["visas.manage"];
    expect(await gate("manage")).toMatchObject({ ok: true });
  });

  it("the management account passes both with nothing granted", async () => {
    world.permissions = ["dashboard.admin"];
    expect(await gate()).toMatchObject({ ok: true, caller: { work: true, manage: true } });
    expect(await gate("manage")).toMatchObject({ ok: true });
    world.permissions = ["developer.access"];
    expect(await gate("manage")).toMatchObject({ ok: true });
  });

  it("refuses everybody else", async () => {
    world.permissions = ["offers.write", "followups.work"];
    expect(await gate()).toEqual({ ok: false, error: ERR.forbidden });
  });
});

describe("mutateFile — two colleagues never overwrite each other", () => {
  const caller = visaCaller(["visas.work"], ME)!;

  it("writes the change, bumps the rev and records the events", async () => {
    const r = await mutateFile(caller, ID, () => ({ patch: { note: "x" }, events: [{ kind: "note", text: "t" }] }));
    expect(r.ok).toBe(true);
    expect(world.row).toMatchObject({ note: "x", rev: 1 });
    expect(world.events).toEqual([{ file_id: ID, by: ME, kind: "note", text: "t" }]);
  });

  it("when somebody saved in between, it reads again and decides again on the new row", async () => {
    let calls = 0;
    let raced = false;
    world.beforeWrite = () => {
      if (raced) return;
      raced = true;
      Object.assign(world.row!, { note: "colleague", rev: 1 });
    };
    const seen: unknown[] = [];
    const r = await mutateFile(caller, ID, (file) => {
      calls += 1;
      seen.push(file.note);
      return { patch: { client_name: `${file.note ?? "-"}!` } };
    });
    expect(r.ok).toBe(true);
    expect(calls).toBe(2);
    expect(seen).toEqual([null, "colleague"]);
    expect(world.row).toMatchObject({ client_name: "colleague!", note: "colleague", rev: 2 });
    expect(world.writes).toBe(1);
  });

  it("gives up with a plain message after three clashes, writing nothing", async () => {
    world.beforeWrite = () => {
      world.row!.rev += 1;
    };
    const r = await mutateFile(caller, ID, () => ({ patch: { note: "x" }, events: [{ kind: "note", text: "t" }] }));
    expect(r).toEqual({ ok: false, error: ERR.clash });
    expect(world.writes).toBe(0);
    expect(world.events).toEqual([]);
  });

  it("an empty change writes nothing", async () => {
    const r = await mutateFile(caller, ID, () => ({ patch: {}, events: [{ kind: "note", text: "t" }] }));
    expect(r.ok).toBe(true);
    expect(world.writes).toBe(0);
    expect(world.events).toEqual([]);
  });

  it("the build's refusal comes back as it is, and nothing is written", async () => {
    const r = await mutateFile(caller, ID, () => ({ error: "ممنوع" }));
    expect(r).toEqual({ ok: false, error: "ممنوع" });
    expect(world.writes).toBe(0);
  });

  it("a worker cannot touch a colleague's file; the management can", async () => {
    world.row!.assigned_to = OTHER;
    expect(await mutateFile(caller, ID, () => ({ patch: { note: "x" } }))).toEqual({ ok: false, error: ERR.missing });
    expect(await mutateFile(visaCaller(["visas.manage"], ME)!, ID, () => ({ patch: { note: "x" } }))).toMatchObject({ ok: true });
  });

  it("a file that is not there, or an id that is not an id, is the same plain answer", async () => {
    world.row = null;
    expect(await mutateFile(caller, ID, () => ({ patch: {} }))).toEqual({ ok: false, error: ERR.missing });
    expect(await mutateFile(caller, "nope", () => ({ patch: {} }))).toEqual({ ok: false, error: ERR.missing });
  });
});
