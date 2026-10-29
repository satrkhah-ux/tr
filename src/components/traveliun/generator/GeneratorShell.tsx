"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Eye,
  EyeOff,
  Loader2,
  XCircle,
} from "lucide-react";
import { DirText } from "@/components/DirText";
import { saveDraftStages } from "@/lib/data/drafts";
import {
  STAGES,
  stageHref,
  visibleStagesFor,
  type DraftData,
  type GeneratorLookups,
  type StageKey,
} from "@/lib/offer/draft-types";
import { validateDraft, type DraftIssue, type StageStatus } from "@/lib/offer/draft-validation";
import { useRole } from "@/lib/roles/RoleContext";
import { usePartnerBrand } from "@/lib/partners/PartnerContext";
import { FieldIssueProvider, fieldAnchorId } from "./FieldIssue";
import { TraveliunShell } from "../TraveliunShell";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { OfferDocument } from "@/components/offer-doc/OfferDocument";
import { draftBrand, draftPaymentLines, draftToPreviewOffer } from "@/lib/offer/preview-dto";
import { STAGE_FORMS } from "./stage-forms";
import { useDraftState } from "./useDraftState";

/**
 * Shared chrome for every /package-generator/[draftId]/* page:
 * owns the live draft, auto-saves (debounced, flushed on unmount), renders the
 * jumpable progress rail, the validation panel (blocking vs warnings), the
 * nights indicator (cities/hotels only) and the live PDF-accurate preview pane.
 */
export function GeneratorShell({
  draftId,
  stage,
  initialData,
  lookups,
}: {
  draftId: string;
  stage: StageKey;
  initialData: DraftData;
  lookups: GeneratorLookups;
}) {
  const { t, language } = useTraveliunUI();
  const { can } = useRole();
  // a partner sees prices, always at their own terms (the server quotes them so)
  const partnerFile = usePartnerBrand() !== null;
  const canPricing = can("pricing.view") || partnerFile;

  const { data, patch, replace, flush, saveState } = useDraftState(draftId, initialData);
  const [previewOpen, setPreviewOpen] = useState(true);

  // Issues that belong to permission-gated stages are hidden from roles without
  // access — a visitor must see NO trace of the pricing stage anywhere.
  // (validateDraft already drops issues for out-of-scope stages.)
  const validation = useMemo(() => {
    const raw = validateDraft(data, { partnerFile });
    if (canPricing) return raw;
    const gatedStages = new Set(STAGES.filter((s) => s.gated).map((s) => s.key));
    return {
      ...raw,
      blocking: raw.blocking.filter((issue) => !gatedStages.has(issue.stage)),
      warnings: raw.warnings.filter((issue) => !gatedStages.has(issue.stage)),
    };
  }, [data, canPricing, partnerFile]);
  const visibleStages = useMemo(() => visibleStagesFor(data.scope, canPricing), [data.scope, canPricing]);
  // «الفنادق» has no chip of its own any more — the stays live inside their
  // city. A /hotels deep link still renders, under the city card's chip.
  const railStage: StageKey = stage === "hotels" ? "cities" : stage === "scope" ? "trip" : stage;

  // Linear position drives the mobile prev/next bar and the "step N of M" chip.
  const stageIndex = visibleStages.findIndex((s) => s.key === railStage);
  const prevStage = stageIndex > 0 ? visibleStages[stageIndex - 1] : null;
  const nextStage = stageIndex >= 0 && stageIndex < visibleStages.length - 1 ? visibleStages[stageIndex + 1] : null;

  // Keep the active chip visible in the horizontally-scrolling mobile stepper.
  const activeChipRef = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    activeChipRef.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [stage]);

  const issueText = useCallback(
    (issue: DraftIssue): string => {
      if (issue.invariant) return language === "ar" ? issue.invariant.message_ar : issue.invariant.message_en;
      return issue.key ? t(issue.key) : "";
    },
    [language, t],
  );

  const StageForm = STAGE_FORMS[stage];

  return (
    <TraveliunShell title="nav.packageGenerator">
      <div className="tv-fade-up">
        {/* top bar: back + save state + preview toggle */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Link
            href="/package-generator"
            className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[12.5px] font-bold text-[#557d78] transition-colors hover:bg-[#f4f8f6]"
          >
            <ArrowRight className="size-4 rtl:rotate-0 ltr:rotate-180" />
            {t("pg.backToDrafts")}
          </Link>
          <div className="flex items-center gap-2">
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
            {stage !== "preview" ? (
              <button
                type="button"
                onClick={() => setPreviewOpen((v) => !v)}
                className="hidden h-9 items-center gap-2 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[12.5px] font-bold text-[#557d78] transition-colors hover:bg-[#f4f8f6] xl:inline-flex"
              >
                {previewOpen ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                {previewOpen ? t("pg.hidePreview") : t("pg.showPreview")}
              </button>
            ) : null}
          </div>
        </div>

        {/* THE stepper — one horizontal bar at every width.
            It used to be a vertical rail beside the form on desktop and a
            separate chip row on phones: two components drawing the same eleven
            steps, and a 230px column spent on a list that reads perfectly well
            as a line. Across the top it costs one row, gives the form the width
            back, and shows the whole journey at once instead of a column the
            eye has to travel down.
            The dot carries the state — number normally, tick when the stage is
            done, cross when it blocks — so status needs no second icon. */}
        <nav
          aria-label={t("pg.progress")}
          className="mb-4 rounded-2xl border border-[#e2ebe7] bg-white p-1.5 shadow-[0_1px_2px_rgba(0,60,58,0.04)]"
        >
          <ol className="flex gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {visibleStages.map((meta, index) => {
              const active = meta.key === stage;
              const status = validation.stages[meta.key];
              return (
                <li key={meta.key} className="min-w-0 flex-1">
                  <Link
                    ref={active ? activeChipRef : undefined}
                    href={stageHref(draftId, meta.key)}
                    aria-current={active ? "step" : undefined}
                    title={t(meta.labelKey)}
                    className={`flex min-w-[86px] flex-col items-center gap-1.5 rounded-[11px] px-1.5 py-2 transition-colors ${
                      active ? "bg-[#185045]" : "hover:bg-[#f0f7f4]"
                    }`}
                  >
                    <StepDot index={index} status={status} active={active} />
                    <span
                      className={`w-full truncate text-center text-[12px] font-bold ${
                        active ? "text-white" : "text-[#185045]"
                      }`}
                    >
                      {t(meta.labelKey)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>

        <div
          // Two columns now, and the form takes the width the rail used to
          // hold. The right one widens only when the live document is in it —
          // a 400px column with nothing but an issue list is wasted paper.
          className={`grid gap-4 items-start ${
            stage !== "preview" && previewOpen
              ? "xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]"
              : "xl:grid-cols-[minmax(0,1fr)_minmax(280px,320px)]"
          }`}
        >
          {/* Everything the agent CHECKS rather than fills: nights, the issue
              list, and the live document. One column now that the steps left
              it — on mobile it still drops below the form (order-2) so the
              agent lands straight on the inputs. */}
          <aside className="order-2 space-y-4">
            {/* «فحص العرض» — the FINAL check, and only there.
                On a working stage it now duplicates what the form already says
                under each box, and a list on the far side of the screen was the
                worse of the two ways to say it. At «المعاينة» it answers the
                other question — "is this whole file ready to go out" — and each
                row is a link straight to the box that is wrong. */}
            {stage === "preview" ? (
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
                    <IssueList
                      title={t("pg.blocking")}
                      titleClass="text-[#c22850]"
                      issues={validation.blocking}
                      draftId={draftId}
                      issueText={issueText}
                      icon={<XCircle className="mt-0.5 size-3.5 shrink-0 text-[#c22850]" />}
                    />
                  ) : null}
                  {validation.warnings.length > 0 ? (
                    <IssueList
                      title={t("pg.warnings")}
                      titleClass="text-[#a86a10]"
                      issues={validation.warnings}
                      draftId={draftId}
                      issueText={issueText}
                      icon={<AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[#a86a10]" />}
                    />
                  ) : null}
                </div>
              )}
            </div>
            ) : null}

            {/* live document, in the same column — it is something to LOOK at,
                like the issue list above it, not something to fill in. */}
            {stage !== "preview" && previewOpen ? (
              <div className="hidden xl:block">
                <div className="sticky top-[90px]">
                  <p className="mb-2 text-[11px] font-bold text-[#93aaa3]">{t("pg.previewHint")}</p>
                  <div className="max-h-[calc(100vh/var(--tv-zoom)_-_160px)] overflow-y-auto rounded-[14px]">
                    <div className="origin-top scale-[0.62] rtl:origin-top-right ltr:origin-top-left" style={{ width: "161%" }}>
                      <OfferDocument variant="client" offer={draftToPreviewOffer(data, lookups.airlines, lookups.sarPer, draftPaymentLines(data, lookups))} {...draftBrand(data, lookups.partners, canPricing && !can("pricing.view"))} />
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </aside>

          {/* stage form */}
          <main className="order-1 min-w-0 xl:col-start-1 xl:row-start-1">
            {/* Both lists, so a field shows its warning as readily as its
                blocking error — an agent typing does not care which bucket we
                filed it under, only that this box is wrong. */}
            <FieldIssueProvider issues={[...validation.blocking, ...validation.warnings]} render={issueText}>
              <StageForm draftId={draftId} data={data} patch={patch} replace={replace} flush={flush} lookups={lookups} />
            </FieldIssueProvider>

            {/* MOBILE prev/next — the primary way to move through the wizard on a
                phone. Sits inline under the form (not fixed) so it never covers
                inputs and the agent reaches it by finishing the step. */}
            <div className="mt-4 flex items-center gap-2 xl:hidden">
              {prevStage ? (
                <Link
                  href={stageHref(draftId, prevStage.key)}
                  className="inline-flex h-12 flex-1 items-center justify-center gap-1.5 rounded-[12px] border border-[#dbe6e1] bg-white px-3 text-[13px] font-bold text-[#185045]"
                >
                  <ChevronRight className="size-4 ltr:rotate-180" />
                  <span className="truncate">{t(prevStage.labelKey)}</span>
                </Link>
              ) : (
                <span className="flex-1" />
              )}
              <span className="tv-tnum shrink-0 rounded-full bg-[#eef4f1] px-2.5 py-1 text-[11px] font-extrabold text-[#557d78]">
                <DirText dir="ltr">{`${stageIndex + 1}/${visibleStages.length}`}</DirText>
              </span>
              {nextStage ? (
                <Link
                  href={stageHref(draftId, nextStage.key)}
                  className="inline-flex h-12 flex-1 items-center justify-center gap-1.5 rounded-[12px] bg-[#185045] px-3 text-[13px] font-bold text-white shadow-[0_2px_8px_rgba(24,80,69,0.25)]"
                >
                  <span className="truncate">{t(nextStage.labelKey)}</span>
                  <ChevronLeft className="size-4 ltr:rotate-180" />
                </Link>
              ) : (
                <span className="flex-1" />
              )}
            </div>
          </main>

        </div>
      </div>
    </TraveliunShell>
  );
}

/**
 * One step's dot: its number, or what happened to it.
 *
 * A number and a status badge side by side is two things to read per step, and
 * eleven of those across a bar is noise. The dot IS the status — a tick when the
 * stage is done, a cross when it blocks, the number when there is nothing to
 * say. The number stays visible on the current step because "where am I in the
 * eleven" is the one thing the bar exists to answer.
 */
function StepDot({ index, status, active }: { index: number; status: StageStatus; active: boolean }) {
  const shell = "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold";
  if (active) {
    return (
      <span className={`${shell} bg-white text-[#185045]`}>
        <DirText dir="ltr">{String(index + 1)}</DirText>
      </span>
    );
  }
  if (status === "complete") return <CheckCircle2 className="size-6 shrink-0 text-[#0f7a52]" />;
  if (status === "error") return <XCircle className="size-6 shrink-0 text-[#c22850]" />;
  if (status === "partial") return <CircleDot className="size-6 shrink-0 text-[#d99a00]" />;
  return (
    <span className={`${shell} bg-[#eef4f1] text-[#93aaa3]`}>
      <DirText dir="ltr">{String(index + 1)}</DirText>
    </span>
  );
}

function IssueList({
  title,
  titleClass,
  issues,
  draftId,
  issueText,
  icon,
}: {
  title: string;
  titleClass: string;
  issues: DraftIssue[];
  draftId: string;
  issueText: (issue: DraftIssue) => string;
  icon: React.ReactNode;
}) {
  return (
    <div>
      <p className={`mb-1.5 text-[11.5px] font-extrabold ${titleClass}`}>{title}</p>
      <ul className="space-y-1">
        {issues.map((issue, index) => {
          // The WHOLE row is the link, not a small button beside it. The
          // sentence is what the eye lands on and what the hand goes for; a
          // separate «إصلاح» made the obvious target the wrong one.
          // The hash carries the field, so the browser scrolls to the exact box
          // rather than dropping the agent at the top of a long stage.
          const href = `${stageHref(draftId, issue.stage)}${issue.field ? `#${fieldAnchorId(issue.field)}` : ""}`;
          return (
            <li key={index}>
              <Link
                href={href}
                className="flex items-start gap-2 rounded-[8px] px-2 py-1.5 text-[12px] leading-5 text-[#0f3d38] transition-colors hover:bg-[#f0f7f4]"
              >
                {icon}
                <span className="flex-1">{issueText(issue)}</span>
                <ChevronLeft className="mt-0.5 size-3.5 shrink-0 text-[#b6c9c2] ltr:rotate-180" />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
