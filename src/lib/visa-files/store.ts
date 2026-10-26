import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { currentPermissions } from "@/lib/roles/current";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { logAudit, type AuditAction } from "@/lib/data/audit";
import { canSee, visaCaller, type VisaCaller } from "./access";
import { isUuid } from "./rules";
import { rowToFile, type VisaRowDb } from "./rows";
import type { VisaEvent, VisaFile } from "./types";

/**
 * The visa files' storage helpers (server only). Every action in data/visa-files.ts goes through `gate()` first
 * (who is asking), reads and writes with the SERVICE client (the three tables are closed to sessions), and writes
 * a changed file through `mutateFile()` so two colleagues saving the same file never overwrite each other.
 */
export const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
export const BUCKET = "visas";

export const ERR = {
  session: "سجّل الدخول من جديد.",
  forbidden: "لا تملك صلاحية على هذا الإجراء.",
  missing: "الملف غير موجود أو لا تملك صلاحية عليه.",
  db: "تعذّر الحفظ. حاول مرة أخرى.",
  load: "تعذّر التحميل. حاول مرة أخرى.",
  clash: "عدّل زميل الملف في اللحظة نفسها. أعد المحاولة.",
} as const;

export type Gated = { ok: true; caller: VisaCaller } | { ok: false; error: string };

/** Signed in, and allowed to work files (or, with `need: "manage"`, the whole department). The view-as role is already applied. */
export async function gate(need: "work" | "manage" = "work"): Promise<Gated> {
  if (!(await getServerUser())) return { ok: false, error: ERR.session };
  const caller = visaCaller(await currentPermissions(), await getCurrentEmployeeId());
  if (!caller || (need === "manage" && !caller.manage)) return { ok: false, error: ERR.forbidden };
  return { ok: true, caller };
}

export async function loadRow(id: string): Promise<VisaRowDb | null> {
  if (!isUuid(id)) return null;
  const { data, error } = await db().from("visa_files").select("*").eq("id", id).maybeSingle();
  return error ? null : ((data as VisaRowDb | null) ?? null);
}

/** The file, when it exists and this caller may open it. */
export async function readFile(caller: VisaCaller, id: string): Promise<{ ok: true; row: VisaRowDb; file: VisaFile } | { ok: false; error: string }> {
  const row = await loadRow(id);
  const file = row ? rowToFile(row) : null;
  return row && file && canSee(file, caller) ? { ok: true, row, file } : { ok: false, error: ERR.missing };
}

export type NewEvent = { kind: VisaEvent["kind"]; text: string };

export async function addEvents(fileId: string, by: string | null, events: NewEvent[]): Promise<void> {
  if (events.length === 0) return;
  // the timeline is a convenience: a lost line must not undo the change it describes
  await db().from("visa_file_events").insert(events.map((e) => ({ file_id: fileId, by, kind: e.kind, text: e.text.slice(0, 2000) })));
}

export const audit = (action: AuditAction, fileId: string, meta: Record<string, unknown> = {}) =>
  logAudit({ action, entity: "visa_files", entity_id: fileId, meta });

export type Change = { patch: Record<string, unknown>; events?: NewEvent[] } | { error: string };

/**
 * Read → decide → write one file. `build` gets the freshly read row and returns the columns to set (never `paid`:
 * the payments' trigger owns it); the write names the rev it read, so when somebody saved in between it reads
 * again and decides again, up to three times. Events are written after the file is.
 */
export async function mutateFile(
  caller: VisaCaller,
  id: string,
  build: (file: VisaFile, row: VisaRowDb) => Change | Promise<Change>,
): Promise<{ ok: true; file: VisaFile } | { ok: false; error: string }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const read = await readFile(caller, id);
    if (!read.ok) return read;
    const change = await build(read.file, read.row);
    if ("error" in change) return { ok: false, error: change.error };
    if (Object.keys(change.patch).length === 0) return { ok: true, file: read.file };
    const { data, error } = await db()
      .from("visa_files")
      .update({ ...change.patch, rev: read.row.rev + 1, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("rev", read.row.rev)
      .select("id");
    if (error) return { ok: false, error: ERR.db };
    if ((data ?? []).length > 0) {
      await addEvents(id, caller.employeeId, change.events ?? []);
      return { ok: true, file: read.file };
    }
  }
  return { ok: false, error: ERR.clash };
}

/** employee id → Arabic name, for the timeline and the board */
export async function employeeNames(ids: (string | null | undefined)[]): Promise<Record<string, string>> {
  const want = [...new Set(ids.filter((i): i is string => isUuid(i)))];
  if (want.length === 0) return {};
  const { data } = await db().from("employees").select("id, arabic_name").in("id", want);
  return Object.fromEntries(((data ?? []) as { id: string; arabic_name: string }[]).map((e) => [e.id, e.arabic_name]));
}
