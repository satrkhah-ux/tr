"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient, getServerUser } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { partnerCaller } from "@/lib/partners/price-view";
import { normalizeDraftData, type DraftData } from "@/lib/offer/draft-types";
import type { ClientOfferDTO } from "@/lib/offer/dto";
import { versionHistory, type OfferVersion } from "@/lib/offer/version-history";
import { loadDraft, writeDraftStages } from "./draft-store";
import { newestFrozen, reissueLocked, type FrozenDraft } from "./issued-draft";
import { produceOfferFromDraft, type ProduceResult } from "./drafts";
import { logAudit } from "./audit";

/**
 * «سجل النسخ» of an issued offer, and «استعادة نسخة سابقة».
 *
 * Every version the client was sent is already kept: its client document
 * (offer_renders, variant client — append-only) and, for an issue or a
 * re-issue, the draft it was issued from (frozen beside the internal render).
 * This reads them as a history, and puts an older version back the only honest
 * way: its frozen draft becomes the file again and is ISSUED as the next
 * version under the same serial. Nothing is rewritten in place — the version
 * the client is leaving stays in the history too, and the restore says which
 * version it came from and who did it. The draft as it stood before the restore
 * (changes never issued included) is kept in that audit row, so even those can
 * be read back.
 *
 * Staff only (offers.write). A partner company's confirmed / invoiced file is
 * locked like a re-issue (reissueLocked): its invoice stands on what was issued.
 */

export type { OfferVersion, OfferVersionKind } from "@/lib/offer/version-history";

type RenderRow = { version: number; rendered_at: string; snapshot_json: Record<string, unknown> };

const service = () => createSupabaseServiceClient() as unknown as SupabaseClient;

async function staffGate(): Promise<string | null> {
  if (!(await getServerUser())) return "err.session";
  if ((await partnerCaller()) || !(await currentCan("offers.write"))) return "err.forbidden";
  return null;
}

async function offerOf(db: SupabaseClient, serial: string): Promise<{ id: string } | null> {
  const { data } = await db.from("offers").select("id").eq("serial", serial).maybeSingle();
  return (data as { id: string } | null) ?? null;
}

export async function listOfferVersions(serial: string): Promise<{ ok: true; versions: OfferVersion[] } | { ok: false; error: string }> {
  try {
    const denied = await staffGate();
    if (denied) return { ok: false, error: denied };
    const db = service();
    const offer = await offerOf(db, serial);
    if (!offer) return { ok: false, error: "err.loadFailed" };

    const [{ data: renders }, { data: audits }, { data: frozenRows }] = await Promise.all([
      db
        .from("offer_renders")
        .select("version, rendered_at, snapshot_json")
        .eq("offer_id", offer.id)
        .eq("variant", "client")
        .order("version", { ascending: true }),
      db
        .from("audit_logs")
        .select("action, actor_email, created_at, meta")
        .eq("entity_id", offer.id)
        .in("action", ["offer.reissued", "offer.version_restored"]),
      // whether each version froze a draft — one small field, not the draft itself
      db.from("offer_renders").select("version, frozen:snapshot_json->source_draft->data->>produced_serial").eq("offer_id", offer.id).eq("variant", "internal"),
    ]);

    const frozen = ((frozenRows ?? []) as { version: number; frozen: string | null }[]).filter((r) => r.frozen).map((r) => r.version);
    const versions = versionHistory((renders ?? []) as RenderRow[], frozen, (audits ?? []) as { action: string; actor_email: string | null; meta: Record<string, unknown> | null }[]);
    return { ok: true, versions };
  } catch {
    return { ok: false, error: "err.db" };
  }
}

/** The client document of one version, as it was sent — for the staff «عرض». */
export async function getOfferVersionDocument(serial: string, version: number): Promise<ClientOfferDTO | null> {
  try {
    if (await staffGate()) return null;
    const db = service();
    const offer = await offerOf(db, serial);
    if (!offer) return null;
    const { data } = await db
      .from("offer_renders")
      .select("snapshot_json")
      .eq("offer_id", offer.id)
      .eq("variant", "client")
      .eq("version", version)
      .maybeSingle();
    return ((data as { snapshot_json: Record<string, unknown> } | null)?.snapshot_json as unknown as ClientOfferDTO) ?? null;
  } catch {
    return null;
  }
}

/**
 * Put version N back and issue it as the next version. The frozen draft of N
 * (or of the issue N re-published) replaces the file's draft — every top-level
 * key, so a section added after N does not linger — keeping the serial. Then
 * the ordinary re-issue runs: same validation, same gates, same «ما تغيّر».
 */
export async function restoreOfferVersion(draftId: string, version: number): Promise<ProduceResult | { ok: false; error: string }> {
  try {
    const denied = await staffGate();
    if (denied) return { ok: false, error: denied };
    const record = await loadDraft(draftId);
    const serial = record?.data.produced_serial;
    if (!record || !serial) return { ok: false, error: "err.loadFailed" };
    const db = service();
    if (await reissueLocked(db, serial)) return { ok: false, error: "pg.err.issuedLocked" };
    const offer = await offerOf(db, serial);
    if (!offer) return { ok: false, error: "err.loadFailed" };

    const { data: rows } = await db
      .from("offer_renders")
      .select("version, source:snapshot_json->source_draft")
      .eq("offer_id", offer.id)
      .eq("variant", "internal")
      .lte("version", version);
    const frozen = newestFrozen((rows ?? []) as { version: number; source: FrozenDraft | null }[]);
    if (!frozen?.data) return { ok: false, error: "pg.versions.noDraft" };

    const back = normalizeDraftData(frozen.data);
    const now = record.data as unknown as Record<string, unknown>;
    // every key: what N had, and nothing N did not have
    const slices = Object.fromEntries(
      [...new Set([...Object.keys(now), ...Object.keys(back)])].map((k) => [k, (back as unknown as Record<string, unknown>)[k]]),
    ) as Partial<DraftData>;
    slices.produced_serial = serial;
    const { data: last } = await db
      .from("offer_renders")
      .select("version")
      .eq("offer_id", offer.id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const leaving = (last as { version: number } | null)?.version ?? 0;

    const written = await writeDraftStages(draftId, slices);
    if (!written.ok) return { ok: false, error: written.error ?? "err.updateFailed" };
    const issued = await produceOfferFromDraft(draftId);
    if (!issued.ok) {
      // the file is not left half-way: the draft goes back to what it was
      await writeDraftStages(draftId, now as Partial<DraftData>);
      return issued;
    }
    await logAudit({
      action: "offer.version_restored",
      entity: "offers",
      entity_id: offer.id,
      meta: { serial, version: issued.version ?? null, restored_from: version, replaced_version: leaving, draft_id: draftId, draft_before: now },
    });
    return issued;
  } catch {
    return { ok: false, error: "err.db" };
  }
}
