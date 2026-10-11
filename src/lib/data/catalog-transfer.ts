"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import { can } from "@/lib/roles/roles";
import { getCurrentRole } from "./metrics";
import { normalizeName } from "@/lib/offer/pricing-suggest";
import { logAudit } from "./audit";

/**
 * Export and import the reference catalogue — the lists every package is built
 * from, as one JSON file.
 *
 * Why it exists: the catalogue took a legacy import and a lot of hand-curation
 * to fill, and until now it lived only in one database. A JSON export is a
 * backup an owner can keep, and the way to carry the catalogue to a second
 * environment (a staging copy, a fresh install) without re-running the whole
 * legacy pipeline.
 *
 * Reference data ONLY. Customers, offers, drafts, employees and anything with a
 * price the agency pays are NOT exported here — a file that leaves the system
 * must not carry what a person or a margin would be harmed by.
 */

async function db(): Promise<SupabaseClient> {
  return (await createSupabaseServerClient()) as unknown as SupabaseClient;
}

/**
 * The tables that travel, and the column each is de-duplicated on when a file
 * is imported back. Order matters for import: a city needs its country, a hotel
 * needs its city.
 */
const CATALOG = [
  { table: "countries", nameCol: "arabic_name" },
  { table: "cities", nameCol: "arabic_name" },
  { table: "hotels", nameCol: "arabic_name" },
  { table: "room_types", nameCol: "arabic_name" },
  { table: "service_types", nameCol: "arabic_name" },
  { table: "services", nameCol: "arabic_name" },
  { table: "transportation_types", nameCol: "arabic_name" },
  { table: "transfers", nameCol: "from_city" },
  { table: "tours", nameCol: "arabic_name" },
  { table: "terms", nameCol: "arabic_text" },
  { table: "airports", nameCol: "arabic_name" },
  { table: "airlines", nameCol: "iata" },
] as const;

export type CatalogExport = {
  exported_at: string;
  version: 1;
  tables: Record<string, Record<string, unknown>[]>;
};

async function guard(): Promise<"ok" | "err.session" | "err.forbidden"> {
  const user = await getServerUser();
  if (!user) return "err.session";
  // The same gate the supplier/credential screens use — managing the catalogue
  // is an administrative act, not every employee's.
  return can(await getCurrentRole(), "employees.manage") ? "ok" : "err.forbidden";
}

export type ExportResult =
  | { ok: true; data: CatalogExport; counts: Record<string, number> }
  | { ok: false; error: "err.session" | "err.forbidden" | "err.db" };

export async function exportCatalog(): Promise<ExportResult> {
  const gate = await guard();
  if (gate !== "ok") return { ok: false, error: gate };

  try {
    const supabase = await db();
    const tables: Record<string, Record<string, unknown>[]> = {};
    const counts: Record<string, number> = {};

    for (const { table } of CATALOG) {
      const { data, error } = await supabase.from(table).select("*");
      if (error) return { ok: false, error: "err.db" };
      const rows = (data ?? []) as Record<string, unknown>[];
      tables[table] = rows;
      counts[table] = rows.length;
    }

    return { ok: true, data: { exported_at: new Date().toISOString(), version: 1, tables }, counts };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

export type ImportResult =
  | { ok: true; added: Record<string, number>; skipped: Record<string, number> }
  | { ok: false; error: "err.session" | "err.forbidden" | "err.db" | "pg.err.badImport" };

/**
 * Add what the file has and the catalogue does not — MERGE, never replace.
 *
 * A row is inserted only when its name is not already present, so importing a
 * file onto a live catalogue tops it up instead of duplicating it or wiping a
 * curated row. Ids are dropped and regenerated: the file's ids belong to the
 * system it came from, and forcing them here would collide with ours.
 */
export async function importCatalog(payload: unknown): Promise<ImportResult> {
  const gate = await guard();
  if (gate !== "ok") return { ok: false, error: gate };

  const parsed = payload as Partial<CatalogExport> | null;
  if (!parsed || typeof parsed !== "object" || !parsed.tables || typeof parsed.tables !== "object") {
    return { ok: false, error: "pg.err.badImport" };
  }

  try {
    const supabase = await db();
    const added: Record<string, number> = {};
    const skipped: Record<string, number> = {};

    for (const { table, nameCol } of CATALOG) {
      const incoming = (parsed.tables[table] ?? []) as Record<string, unknown>[];
      if (!Array.isArray(incoming) || incoming.length === 0) {
        added[table] = 0;
        skipped[table] = 0;
        continue;
      }

      // What is already here, by normalized name — the dedup key.
      const { data: existingRows, error: readErr } = await supabase.from(table).select(nameCol);
      if (readErr) return { ok: false, error: "err.db" };
      const seen = new Set(
        ((existingRows ?? []) as Record<string, unknown>[]).map((r) => normalizeName(String(r[nameCol] ?? ""))),
      );

      const toInsert: Record<string, unknown>[] = [];
      let skip = 0;
      for (const raw of incoming) {
        const key = normalizeName(String(raw[nameCol] ?? ""));
        if (!key || seen.has(key)) {
          skip += 1;
          continue;
        }
        seen.add(key);
        // The id and timestamps belong to the source system; let ours assign.
        const { id: _id, created_at: _c, updated_at: _u, ...rest } = raw as Record<string, unknown>;
        toInsert.push(rest);
      }

      if (toInsert.length > 0) {
        const { error: insErr } = await supabase.from(table).insert(toInsert);
        if (insErr) return { ok: false, error: "err.db" };
      }
      added[table] = toInsert.length;
      skipped[table] = skip;
    }

    await logAudit({
      action: "catalog.imported",
      entity: "countries",
      entity_id: "catalog",
      meta: { added },
    });

    return { ok: true, added, skipped };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
