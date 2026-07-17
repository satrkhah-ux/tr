"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  CircleDot,
  Loader2,
  MoonStar,
  XCircle,
} from "lucide-react";
import { DirText } from "@/components/DirText";
import { saveRepackageStages } from "@/lib/data/repackage";
import { STAGES, stageHref, type RepackageData, type StageKey } from "@/lib/repackage/repackage-types";
import { validateRepackage, type RepackageIssue, type StageStatus } from "@/lib/repackage/repackage-validation";
import { useRole } from "@/lib/roles/RoleContext";
import { TraveliunShell } from "../TraveliunShell";
import { useTraveliunUI } from "../TraveliunUIProvider";
import type { RepackageStageProps } from "./stage-props";
import { ImportStage } from "./stages/ImportStage";
import { ReviewStage } from "./stages/ReviewStage";
import { EditStage } from "./stages/EditStage";
import { PreviewStage } from "./stages/PreviewStage";

const STAGE_FORMS: Record<StageKey, (props: RepackageStageProps) => React.ReactNode> = {
  import: ImportStage,
  review: ReviewStage,
  edit: EditStage,
  preview: PreviewStage,
};

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Shared chrome for every /repackage/[draftId]/* page. Mirrors GeneratorShell:
 * live state + debounced auto-save (flushed on unmount), a jumpable progress
 * rail, a nights indicator (review), and the confidence-gated validation panel.
 */
export function RepackageShell({
  draftId,
  stage,
  initialData,
}: {
  draftId: string;
  stage: StageKey;
  initialData: RepackageData;
}) {
  const { t, language } = useTraveliunUI();
  const { can } = useRole();
  const canPricing = can("pricing.view");

  const [data, setData] = useState<RepackageData>(initialData);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const pendingRef = useRef<Partial<RepackageData>>({});
  const timerRef = useRef<number | null>(null);

  const flush = useCallback(async () => {
    const slice = pendingRef.current;
    pendingRef.current = {};
    if (Object.keys(slice).length === 0) return;
    setSaveState("saving");
    const result = await saveRepackageStages(draftId, slice);
    setSaveState(result.ok ? "saved" : "error");
  }, [draftId]);

  const patch = useCallback(
    (slice: Partial<RepackageData>) => {
      setData((current) => ({ ...current, ...slice }));
      pendingRef.current = { ...pendingRef.current, ...slice };
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => void flush(), 700);
    },
    [flush],
  );

  const replace = useCallback((next: RepackageData) => {
    pendingRef.current = {};
    setData(next);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      void flush();
    };
  }, [flush]);

  // Hide gated-stage issues from roles without pricing.view.
  const validation = useMemo(() => {
    const raw = validateRepackage(data);
    if (canPricing) return raw;
    const gated = new Set(STAGES.filter((s) => s.gated).map((s) => s.key));
    return {
      ...raw,
      blocking: raw.blocking.filter((i) => !gated.has(i.stage)),
      warnings: raw.warnings.filter((i) => !gated.has(i.stage)),
    };
  }, [data, canPricing]);
  const visibleStages = useMemo(() => STAGES.filter((s) => !s.gated || canPricing), [canPricing]);
  const showNights = stage === "review" && data.extracted != null && (data.extracted?.cities.length ?? 0) > 0;

  const issueText = useCallback(
    (issue: RepackageIssue): string => {
      if (issue.invariant) return language === "ar" ? issue.invariant.message_ar : issue.invariant.message_en;
      return issue.key ? t(issue.key) : "";
    },
    [language, t],
  );

  const StageForm = STAGE_FORMS[stage];

  return (
    <TraveliunShell title="nav.repackage">
      <div className="tv-fade-up">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/repackage"
            className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[12.5px] font-bold text-[#557d78] transition-colors hover:bg-[#f4f8f6]"
          >
            <ArrowRight className="size-4 rtl:rotate-0 ltr:rotate-180" />
            {t("rp.title")}
          </Link>
          <span
            role="status"
            className={`inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[12px] font-bold ${
              saveState === "error"
                ? "bg-[#fdeef2] text-[#c22850]"
                : saveState === "saving"
                  ? "bg-[#fff8e8] text-[#a86a10]"
                  : "bg-[#e9f7f0] text-[#0f7a52]"
            }`}
          >
            {saveState === "saving" ? <Loader2 className="size-3.5 animate-spin" /> : saveState === "error" ? <XCircle className="size-3.5" /> : <Check className="size-3.5" />}
            {saveState === "saving" ? t("pg.saving") : saveState === "error" ? t("pg.saveFailed") : t("pg.saved")}
          </span>
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-[230px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <nav className="rounded-2xl border border-[#e2ebe7] bg-white p-3 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
              <p className="mb-2 px-2 text-[11px] font-extrabold tracking-wide text-[#93aaa3]">{t("pg.progress")}</p>
              <ol className="space-y-0.5">
                {visibleStages.map((meta, index) => {
                  const status = validation.stages[meta.key];
                  const active = meta.key === stage;
                  return (
                    <li key={meta.key}>
                      <Link
                        href={stageHref(draftId, meta.key)}
                        aria-current={active ? "step" : undefined}
                        className={`flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 text-[13px] font-bold transition-colors ${
                          active ? "bg-[#185045] text-white" : "text-[#185045] hover:bg-[#f0f7f4]"
                        }`}
                      >
                        <StatusIcon status={status} active={active} />
                        <span className="flex-1">{t(meta.labelKey)}</span>
                        <span className={`tv-tnum text-[10px] font-extrabold ${active ? "text-[#8fe3c4]" : "text-[#b6c9c2]"}`}>
                          <DirText dir="ltr">{String(index + 1)}</DirText>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </nav>

            {showNights ? (
              <div
                className={`rounded-2xl border p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)] ${
                  validation.nights.match ? "border-[#bfe5d4] bg-[#e9f7f0]" : "border-[#f2e2b4] bg-[#fff8e8]"
                }`}
              >
                <p className="flex items-center gap-2 text-[12px] font-extrabold text-[#185045]">
                  <MoonStar className="size-4" />
                  {t("pg.nightsIndicator")}
                </p>
                <p className="tv-tnum mt-1.5 text-[13px] font-bold text-[#0f3d38]">
                  {t("pg.nightsOf", { used: validation.nights.used, total: validation.nights.total })}
                </p>
                <p className={`mt-1 text-[11.5px] font-bold ${validation.nights.match ? "text-[#0f7a52]" : "text-[#a86a10]"}`}>
                  {validation.nights.match ? t("rp.nights.match") : t("rp.nights.mismatch")}
                </p>
              </div>
            ) : null}

            <div className="rounded-2xl border border-[#e2ebe7] bg-white p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
              <p className="mb-2 text-[11px] font-extrabold tracking-wide text-[#93aaa3]">{t("pg.validationPanel")}</p>
              {validation.blocking.length === 0 && validation.warnings.length === 0 ? (
                <p className="flex items-start gap-2 text-[12px] font-bold text-[#0f7a52]">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                  {t("pg.allClear")}
                </p>
              ) : (
                <div className="space-y-3">
                  {validation.blocking.length > 0 ? (
                    <IssueList title={t("pg.blocking")} titleClass="text-[#c22850]" issues={validation.blocking} draftId={draftId} currentStage={stage} issueText={issueText} fixLabel={t("pg.fix")} icon={<XCircle className="mt-0.5 size-3.5 shrink-0 text-[#c22850]" />} />
                  ) : null}
                  {validation.warnings.length > 0 ? (
                    <IssueList title={t("pg.warnings")} titleClass="text-[#a86a10]" issues={validation.warnings} draftId={draftId} currentStage={stage} issueText={issueText} fixLabel={t("pg.fix")} icon={<AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[#a86a10]" />} />
                  ) : null}
                </div>
              )}
            </div>
          </aside>

          <main className="min-w-0">
            <StageForm draftId={draftId} data={data} patch={patch} replace={replace} />
          </main>
        </div>
      </div>
    </TraveliunShell>
  );
}

function StatusIcon({ status, active }: { status: StageStatus; active: boolean }) {
  const base = active ? "text-white" : "";
  if (status === "complete") return <CheckCircle2 className={`size-4 shrink-0 ${base || "text-[#0f7a52]"}`} />;
  if (status === "error") return <XCircle className={`size-4 shrink-0 ${base || "text-[#c22850]"}`} />;
  if (status === "partial") return <CircleDot className={`size-4 shrink-0 ${base || "text-[#d99a00]"}`} />;
  return <Circle className={`size-4 shrink-0 ${base || "text-[#c2cfca]"}`} />;
}

function IssueList({
  title,
  titleClass,
  issues,
  draftId,
  currentStage,
  issueText,
  fixLabel,
  icon,
}: {
  title: string;
  titleClass: string;
  issues: RepackageIssue[];
  draftId: string;
  currentStage: StageKey;
  issueText: (issue: RepackageIssue) => string;
  fixLabel: string;
  icon: React.ReactNode;
}) {
  return (
    <div>
      <p className={`mb-1.5 text-[11.5px] font-extrabold ${titleClass}`}>{title}</p>
      <ul className="space-y-1.5">
        {issues.map((issue, index) => (
          <li key={index} className="flex items-start gap-2 text-[12px] leading-5 text-[#0f3d38]">
            {icon}
            <span className="flex-1">{issueText(issue)}</span>
            {issue.stage !== currentStage ? (
              <Link href={stageHref(draftId, issue.stage)} className="shrink-0 rounded-md bg-[#f0f7f4] px-2 py-0.5 text-[10.5px] font-extrabold text-[#185045] hover:bg-[#e2ede9]">
                {fixLabel}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
