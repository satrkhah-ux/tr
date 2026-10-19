import { describe, expect, it } from "vitest";
import { backupHealth } from "./backup-health";

const now = Date.parse("2026-10-20T01:00:00Z");
const run = (o: object) => JSON.stringify({ day: "2026-10-20", ok: true, at: "2026-10-20T00:02:00Z", dump_bytes: 1_710_721, objects: 66, ...o });

describe("pkg's nightly backup, as «الربط الخارجي» reads it", () => {
  it("last night's good run is healthy", () => {
    expect(backupHealth(run({}), now)).toMatchObject({ status: "ok", day: "2026-10-20", mb: 1.7, objects: 66 });
  });
  it("never ran, failed, older than 26 hours, or a cut-off dump is down", () => {
    expect(backupHealth(null, now)).toMatchObject({ status: "down", reason: "never" });
    expect(backupHealth(run({ ok: false, error: "pg_dump exited 1" }), now)).toMatchObject({ status: "down", reason: "failed", error: "pg_dump exited 1" });
    expect(backupHealth(run({ at: "2026-10-18T22:00:00Z" }), now)).toMatchObject({ status: "down", reason: "stale", hours: 27 });
    expect(backupHealth(run({ dump_bytes: 4_000 }), now)).toMatchObject({ status: "down", reason: "small" });
  });
});
