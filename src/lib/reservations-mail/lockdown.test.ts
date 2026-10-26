import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * reservation_emails holds guest names and confirmation numbers from every
 * case — a closed table (the coordinator's review, 2026-10-26: the first draft
 * opened it to every staff session, the «authenticated all» pattern 0045/0047
 * closed). The SQL comments explain the policy that was dropped, so they are
 * stripped before looking for one.
 */
const SQL = readFileSync(
  fileURLToPath(new URL("../../../supabase/migrations/20261026200000_reservation_emails.sql", import.meta.url)),
  "utf8",
);
const statements = SQL.split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .toLowerCase();

describe("reservation_emails is a closed table", () => {
  it("turns RLS on and revokes the default grants from anon AND authenticated", () => {
    expect(statements).toContain("alter table public.reservation_emails enable row level security");
    expect(statements).toMatch(/revoke all on public\.reservation_emails from anon,\s*authenticated/);
  });

  it("creates no policy at all — the service role behind the gated actions is the only door", () => {
    expect(statements).not.toMatch(/create policy/);
    expect(statements).not.toMatch(/grant\s+[\w, ]+\s+on\s+public\.reservation_emails/);
  });

  it("drops the earlier draft's open policy so a re-run cannot leave it behind", () => {
    expect(statements).toContain("drop policy if exists reservation_emails_staff_all on public.reservation_emails");
  });
});
