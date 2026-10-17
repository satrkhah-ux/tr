import type { ClientOfferDTO } from "./dto";
import { offerChanges, type OfferChange } from "./version-diff";

/**
 * «سجل النسخ» from what is stored: the client renders (one per version), the
 * versions that froze a draft, and the audit rows of re-issues and restores.
 * Pure, so the history reads the same everywhere it is shown.
 */
export type OfferVersionKind = "issued" | "reissued" | "republished" | "restored";

export type OfferVersion = {
  version: number;
  at: string;
  kind: OfferVersionKind;
  /** the version this one put back, for «restored». */
  restored_from: number | null;
  /** who issued it, when the history says (audit row). */
  by: string | null;
  total: number | null;
  currency: string | null;
  arrival_date: string | null;
  departure_date: string | null;
  hotels: string[];
  /** «ما تغيّر» against the version before it; empty for the first. */
  changes: OfferChange[];
  /** a frozen draft can be put back for it. */
  restorable: boolean;
  /** the client's link shows this one. */
  current: boolean;
};

export type VersionAudit = { action: string; actor_email: string | null; meta: Record<string, unknown> | null };

/** «فلان» from «falan@x.com» — enough to say who, never the whole address on screen. */
const who = (email: string | null) => (email ? email.split("@")[0] : null);

/** Newest first. */
export function versionHistory(
  clients: { version: number; rendered_at: string; snapshot_json: unknown }[],
  frozenVersions: number[],
  audits: VersionAudit[],
): OfferVersion[] {
  const sorted = [...clients].sort((a, b) => a.version - b.version);
  const frozen = new Set(frozenVersions);
  const of = (action: string, version: number) => audits.find((a) => a.action === action && Number(a.meta?.version) === version);
  const latest = sorted.at(-1)?.version ?? 0;
  return sorted
    .map((row, i): OfferVersion => {
      const doc = row.snapshot_json as ClientOfferDTO;
      const prev = i > 0 ? (sorted[i - 1].snapshot_json as ClientOfferDTO) : null;
      const restored = of("offer.version_restored", row.version);
      const reissued = of("offer.reissued", row.version);
      const kind: OfferVersionKind =
        row.version === 1 ? "issued" : restored ? "restored" : reissued || frozen.has(row.version) ? "reissued" : "republished";
      return {
        version: row.version,
        at: row.rendered_at,
        kind,
        restored_from: restored ? Number(restored.meta?.restored_from) || null : null,
        by: who((restored ?? reissued)?.actor_email ?? null),
        total: doc.total ?? null,
        currency: doc.currency ?? null,
        arrival_date: doc.arrival_date ?? null,
        departure_date: doc.departure_date ?? null,
        hotels: (doc.hotels ?? []).map((h) => [h.hotel_name, h.city_name].filter(Boolean).join(" — ")).filter(Boolean),
        changes: prev ? offerChanges(prev, doc) : [],
        // a plain re-publish froze nothing, but it published the same rows as the issue before it
        restorable: [...frozen].some((v) => v <= row.version),
        current: row.version === latest,
      };
    })
    .reverse();
}
