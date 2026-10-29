/**
 * An in-memory PostgREST for the data-layer tests: select / insert / update /
 * delete with the filters the app uses (eq, neq, in, is, not-in, ilike), run when
 * awaited. A row's columns are whatever the test put there — `select()` returns
 * whole rows, and an embedded relation (`offers(...)`) is a property the test
 * gives the row. Not a query planner: it exists so the code under test talks to
 * something that behaves like the tables, and the test reads what was written.
 */
export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

export type FakeDb = ReturnType<typeof fakeDb>;

export function fakeDb(tables: Tables, log: { writes: { table: string; op: string; payload: unknown }[] } = { writes: [] }) {
  let seq = 0;
  const api = {
    tables,
    log,
    from(table: string) {
      const rows = () => (tables[table] ??= []);
      const filters: ((r: Row) => boolean)[] = [];
      let op: { kind: "select" | "insert" | "update" | "delete" | "upsert"; payload?: unknown } = { kind: "select" };
      let single: "one" | "maybe" | null = null;
      const run = (): { data: unknown; error: { message: string; code?: string } | null } => {
        const match = (r: Row) => filters.every((f) => f(r));
        if (op.kind === "insert" || op.kind === "upsert") {
          log.writes.push({ table, op: op.kind, payload: op.payload });
          const added = ([] as Row[]).concat(op.payload as Row | Row[]).map((r) => ({ id: `new-${table}-${++seq}`, ...r }));
          rows().push(...added);
          return { data: single ? added[0] : added, error: null };
        }
        if (op.kind === "update") {
          log.writes.push({ table, op: "update", payload: op.payload });
          rows().filter(match).forEach((r) => Object.assign(r, op.payload));
          return { data: null, error: null };
        }
        if (op.kind === "delete") {
          log.writes.push({ table, op: "delete", payload: null });
          tables[table] = rows().filter((r) => !match(r));
          return { data: null, error: null };
        }
        const found = rows().filter(match);
        return { data: single ? (found[0] ?? null) : found, error: null };
      };
      const builder = {
        select: () => builder,
        insert: (payload: unknown) => ((op = { kind: "insert", payload }), builder),
        upsert: (payload: unknown) => ((op = { kind: "upsert", payload }), builder),
        update: (payload: unknown) => ((op = { kind: "update", payload }), builder),
        delete: () => ((op = { kind: "delete" }), builder),
        eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), builder),
        neq: (col: string, v: unknown) => (filters.push((r) => r[col] !== v), builder),
        in: (col: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[col])), builder),
        is: (col: string, v: null) => (filters.push((r) => (r[col] ?? null) === v), builder),
        not: (col: string, _op: string, list: string) => {
          const vs = list.replace(/^\(|\)$/g, "").split(",");
          filters.push((r) => !vs.includes(String(r[col])));
          return builder;
        },
        ilike: (col: string, v: string) => (filters.push((r) => String(r[col] ?? "").toLowerCase() === v.toLowerCase()), builder),
        order: () => builder,
        limit: () => builder,
        range: () => builder,
        maybeSingle: () => ((single = "maybe"), builder),
        single: () => ((single = "one"), builder),
        then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, ko),
      };
      return builder;
    },
  };
  return api;
}
