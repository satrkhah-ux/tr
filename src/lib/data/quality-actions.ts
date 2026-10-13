"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServerClient, getServerUser } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { listEntityAudit, logAudit, type AuditEntry } from "./audit";
import { getCurrentEmployeeId } from "./metrics";
import { allTableConfigs } from "./table-config";
import { qualityCounts } from "./quality-weekly";
import {
  QUALITY_ISSUES,
  guardHotels,
  verifyBlockers,
  type GuardIssue,
  type GuardProblem,
  type GuardRecord,
  type IssueKey,
} from "./quality";

async function db(): Promise<SupabaseClient> {
  return (await createSupabaseServerClient()) as unknown as SupabaseClient;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------- /data-quality (order 3) ----------

export type QualityTop = { id: string; name: string; uses: number };
export type QualityCard = { key: IssueKey; total: number | null; used: number | null; top: QualityTop[] };
export type QualityReport = { ok: true; cards: QualityCard[] } | { ok: false; error: TranslationKey };

const TOP = 5;

/**
 * Every card's number (one RPC), and for the hotel cards the five hotels the
 * offers and bookings use most — the ones a client is most likely to see.
 */
export async function getDataQualityReport(): Promise<QualityReport> {
  if (!(await currentCan("data.write"))) return { ok: false, error: "err.forbidden" };
  try {
    const supabase = await db();
    const rows = await qualityCounts(supabase);
    if (!rows) return { ok: false, error: "data.quality.err.notReady" };
    const counts = new Map(rows.map((r) => [r.issue, r]));

    const hotelIssues = QUALITY_ISSUES.filter((issue) => issue.table === "hotels" && (counts.get(issue.key)?.total ?? 0) > 0);
    const lists = await Promise.all(
      hotelIssues.map(async (issue) => {
        const { data } = await supabase
          .rpc("data_quality_hotels", { p_issue: issue.key })
          .select("id, arabic_name, english_name")
          .range(0, TOP - 1);
        return [issue.key, (data ?? []) as { id: string; arabic_name: string | null; english_name: string | null }[]] as const;
      }),
    );
    const ids = [...new Set(lists.flatMap(([, list]) => list.map((h) => h.id)))];
    const { data: usesData } = ids.length
      ? await supabase.rpc("data_quality_hotel_uses").select("hotel_id, uses").in("hotel_id", ids)
      : { data: [] };
    const uses = new Map(((usesData ?? []) as { hotel_id: string; uses: number }[]).map((u) => [u.hotel_id, u.uses]));
    const tops = new Map<string, QualityTop[]>(
      lists.map(([key, list]) => [
        key,
        list.map((h) => ({ id: h.id, name: (h.arabic_name ?? "").trim() || h.english_name || "—", uses: uses.get(h.id) ?? 0 })),
      ]),
    );

    return {
      ok: true,
      cards: QUALITY_ISSUES.map((issue) => ({
        key: issue.key,
        total: counts.get(issue.key)?.total ?? null,
        used: counts.get(issue.key)?.used ?? null,
        top: tops.get(issue.key) ?? [],
      })),
    };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

// ---------- the issue guard (order 11.1) ----------

export type GuardResult = { issues: GuardIssue[]; canFix: boolean };

/**
 * The catalogue problems of a draft's hotels, for the issue screens — and the
 * check produceOfferFromDraft runs before it issues (a blocking issue refuses).
 * Fails open: an unreadable catalogue is not the agent's problem to solve.
 */
export async function checkHotelIssueGuard(
  lines: { hotel_id: string | null; hotel_name: string | null }[],
): Promise<GuardResult> {
  const none: GuardResult = { issues: [], canFix: false };
  try {
    if (!(await getServerUser())) return none;
    const ids = [...new Set(lines.map((l) => l.hotel_id).filter((id): id is string => typeof id === "string" && UUID.test(id)))].slice(0, 200);
    if (ids.length === 0) return none;
    const { data } = await (await db())
      .from("hotels")
      .select("id, arabic_name, city_id, address, contact_number")
      .in("id", ids);
    const issues = guardHotels(lines, (data ?? []) as GuardRecord[]);
    return { issues, canFix: issues.length > 0 && (await currentCan("data.write")) };
  } catch {
    return none;
  }
}

// ---------- a record's change log (order 11.3) ----------

/** Who changed this row, what and when — from audit_logs, newest first. */
export async function listRecordHistory(table: string, id: string): Promise<AuditEntry[]> {
  if (!UUID.test(id) || !allTableConfigs().some((c) => c.table === table)) return [];
  if (!(await currentCan("data.write"))) return [];
  return listEntityAudit(table, id, 50);
}

// ---------- «الفندق المعتمد» (order 11.5) ----------

export type VerifyResult =
  | { ok: true; verified: boolean; verified_at: string | null }
  | { ok: false; error: TranslationKey; missing?: GuardProblem[] };

/** Mark a reviewed hotel «معتمد» — only when its name, city, stars, address and phone are all there. */
export async function setHotelVerified(id: string, verified: boolean): Promise<VerifyResult> {
  if (!UUID.test(id)) return { ok: false, error: "err.loadFailed" };
  if (!(await getServerUser())) return { ok: false, error: "err.session" };
  if (!(await currentCan("data.write"))) return { ok: false, error: "err.forbidden" };
  try {
    const supabase = await db();
    if (verified) {
      const { data } = await supabase
        .from("hotels")
        .select("id, arabic_name, city_id, stars, address, contact_number")
        .eq("id", id)
        .maybeSingle();
      if (!data) return { ok: false, error: "err.loadFailed" };
      const missing = verifyBlockers(data as GuardRecord);
      if (missing.length > 0) return { ok: false, error: "data.quality.verify.incomplete", missing };
    }
    const verified_at = verified ? new Date().toISOString() : null;
    const { error } = await supabase
      .from("hotels")
      .update({ verified, verified_at, verified_by: verified ? await getCurrentEmployeeId() : null })
      .eq("id", id);
    if (error) return { ok: false, error: "err.updateFailed" };
    await logAudit({ action: verified ? "data.verified" : "data.unverified", entity: "hotels", entity_id: id });
    return { ok: true, verified, verified_at };
  } catch {
    return { ok: false, error: "err.db" };
  }
}
