/**
 * Repackage validation — pure + testable. This is HOW "just enter the price"
 * stays safe: it encodes the confidence gate as blocking issues.
 *
 *  - Any CRITICAL field still low-confidence (unreviewed) → BLOCKING on /review,
 *    so a messy import can never be published without a human confirming it.
 *  - Nights invariant sum(cities.nights)===trip_nights → BLOCKING (reuses the
 *    shared offer/invariants module for a bilingual message).
 *  - A missing sell price, or a sell BELOW the supplier cost → BLOCKING on /edit.
 *
 * When NO critical is uncertain and nights reconcile, /review has zero blocking
 * issues → the import stage auto-advances straight to /edit (the clean-file path).
 *
 * Mirrors draft-validation.ts (DraftIssue/StageStatus) so the shell renders it
 * unchanged. No React, no Supabase.
 */

import type { TranslationKey } from "@/lib/i18n";
import { validateInvariants, type InvariantViolation } from "@/lib/offer/invariants";
import {
  CRITICAL_FIELDS,
  isFieldConfident,
  uncertainFields,
  type RepackageData,
  type StageKey,
} from "./repackage-types";

export type RepackageIssue = {
  severity: "blocking" | "warning";
  stage: StageKey;
  key?: TranslationKey;
  invariant?: InvariantViolation;
};

export type StageStatus = "empty" | "partial" | "complete" | "error";

export type RepackageValidation = {
  ok: boolean;
  blocking: RepackageIssue[];
  warnings: RepackageIssue[];
  stages: Record<StageKey, StageStatus>;
  nights: { used: number; total: number; match: boolean };
  /** true when every critical field is confident AND nights reconcile → /review skippable. */
  reviewClear: boolean;
};

export function validateRepackage(data: RepackageData): RepackageValidation {
  const blocking: RepackageIssue[] = [];
  const warnings: RepackageIssue[] = [];
  const pkg = data.extracted;

  // ── import ────────────────────────────────────────────────────────────
  if (!pkg) {
    return {
      ok: false,
      blocking: [{ severity: "blocking", stage: "import", key: "rp.err.noFile" }],
      warnings: [],
      stages: { import: "empty", review: "empty", edit: "empty", preview: "empty" },
      nights: { used: 0, total: 0, match: false },
      reviewClear: false,
    };
  }

  // ── confidence gate (the core safety) ─────────────────────────────────
  const uncertainCriticals = CRITICAL_FIELDS.filter((k) => !isFieldConfident(data, k));
  if (uncertainCriticals.length > 0) {
    blocking.push({ severity: "blocking", stage: "review", key: "rp.err.reviewCritical" });
  }
  // Non-critical uncertain fields are advisory only.
  const uncertainOptional = uncertainFields(data).filter((k) => !CRITICAL_FIELDS.includes(k));
  if (uncertainOptional.length > 0) {
    warnings.push({ severity: "warning", stage: "review", key: "rp.warn.reviewOptional" });
  }

  // ── nights invariant sum(cities.nights) === trip_nights ───────────────
  const used = pkg.cities.reduce((s, c) => s + (c.nights ?? 0), 0);
  const total = pkg.trip_nights ?? 0;
  const nightsMatch = total > 0 && used === total;
  if (pkg.cities.length > 0 && total > 0 && !nightsMatch) {
    const { violations } = validateInvariants({
      trip_nights: total,
      cities: pkg.cities.map((c) => ({ city_name: c.city_name, nights: c.nights, check_in: null, check_out: null })),
      hotels: [],
    });
    const mismatch = violations.find((v) => v.code === "nights_sum_mismatch");
    if (mismatch) blocking.push({ severity: "blocking", stage: "review", invariant: mismatch });
  }

  // ── edit: price / floor ───────────────────────────────────────────────
  if (data.final_total == null) {
    blocking.push({ severity: "blocking", stage: "edit", key: "rp.err.noPrice" });
  } else if (pkg.supplier_total != null && data.final_total < pkg.supplier_total) {
    // selling below the supplier cost = negative profit — hard block (prompt #4).
    blocking.push({ severity: "blocking", stage: "edit", key: "rp.err.priceBelowCost" });
  } else if (data.final_total <= 0) {
    blocking.push({ severity: "blocking", stage: "edit", key: "rp.err.priceInvalid" });
  }

  // ── advisory ──────────────────────────────────────────────────────────
  if (pkg.hotels.length === 0) warnings.push({ severity: "warning", stage: "review", key: "rp.warn.noHotels" });
  if (pkg.includes.length === 0) warnings.push({ severity: "warning", stage: "edit", key: "rp.warn.noServices" });
  if (data.source.ocr_unavailable) warnings.push({ severity: "warning", stage: "import", key: "rp.warn.ocrUnavailable" });

  const reviewClear = uncertainCriticals.length === 0 && (pkg.cities.length === 0 || nightsMatch);

  return {
    ok: blocking.length === 0,
    blocking,
    warnings,
    stages: stageStatuses(data, blocking, reviewClear),
    nights: { used, total, match: nightsMatch },
    reviewClear,
  };
}

function stageStatuses(
  data: RepackageData,
  blocking: RepackageIssue[],
  reviewClear: boolean,
): Record<StageKey, StageStatus> {
  const hasBlocking = (stage: StageKey) => blocking.some((i) => i.stage === stage);
  const imported = data.extracted != null;
  const priced = data.final_total != null;

  return {
    import: imported ? "complete" : "empty",
    review: !imported ? "empty" : hasBlocking("review") ? "error" : reviewClear ? "complete" : "partial",
    edit: !imported ? "empty" : hasBlocking("edit") ? "error" : priced ? "complete" : "partial",
    preview: data.produced_serial ? "complete" : "empty",
  };
}
