"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleDot,
  Eye,
  EyeOff,
  Loader2,
  MoonStar,
  XCircle,
} from "lucide-react";
import { DirText } from "@/components/DirText";
import { saveDraftStages } from "@/lib/data/drafts";
import {
  STAGES,
  stageHref,
  type DraftData,
  type GeneratorLookups,
  type StageKey,
} from "@/lib/offer/draft-types";
import { validateDraft, type DraftIssue, type StageStatus } from "@/lib/offer/draft-validation";
import { nightsStatus } from "@/lib/offer/schedule";
import { useRole } from "@/lib/roles/RoleContext";
import { TraveliunShell } from "../TraveliunShell";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { OfferDocument } from "./OfferDocument";
import type { StageFormProps } from "./stage-props";
import { CustomerStage } from "./stages/CustomerStage";
import { TripStage } from "./stages/TripStage";
import { CitiesStage } from "./stages/CitiesStage";
import { HotelsStage } from "./stages/HotelsStage";
import { FlightsStage } from "./stages/FlightsStage";
import { TransportStage } from "./stages/TransportStage";
import { ServicesStage } from "./stages/ServicesStage";
import { VisasStage } from "./stages/VisasStage";
import { PricingStage } from "./stages/PricingStage";
import { PreviewStage } from "./stages/PreviewStage";

const STAGE_FORMS: Record<StageKey, (props: StageFormProps) => React.ReactNode> = {
  customer: CustomerStage,
  trip: TripStage,
  cities: CitiesStage,
  hotels: HotelsStage,
  flights: FlightsStage,
  transport: TransportStage,
  services: ServicesStage,
  visas: VisasStage,
  pricing: PricingStage,
  preview: PreviewStage,
};

type SaveState = "idle" | "saving" | "saved" | "error";

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
  const router = useRouter();
  const { t, language } = useTraveliunUI();
  const { can } = useRole();
  const canPricing = can("pricing.view");

  const [data, setData] = useState<DraftData>(initialData);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [previewOpen, setPreviewOpen] = useState(true);
  const pendingRef = useRef<Partial<DraftData>>({});
  const timerRef = useRef<number | null>(null);

  const flush = useCallback(async () => {
    const slice = pendingRef.current;
    pendingRef.current = {};
    if (Object.keys(slice).length === 0) return;
    setSaveState("saving");
    const result = await saveDraftStages(draftId, slice);
    setSaveState(result.ok ? "saved" : "error");
  }, [draftId]);

  const patch = useCallback(
    (slice: Partial<DraftData>) => {
      setData((current) => ({ ...current, ...slice }));
      pendingRef.current = { ...pendingRef.current, ...slice };
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => void flush(), 700);
    },
    [flush],
  );

  const replace = useCallback((next: DraftData) => {
    pendingRef.current = {};
    setData(next);
  }, []);

  // never lose pending work on unmount / stage navigation
  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      void flush();
    };
  }, [flush]);

  // Issues that belong to permission-gated stages are hidden from roles without
  // access — a visitor must see NO trace of the pricing stage anywhere.
  const validation = useMemo(() => {
    const raw = validateDraft(data);
    if (canPricing) return raw;
    const gatedStages = new Set(STAGES.filter((s) => s.gated).map((s) => s.key));
    return {
      ...raw,
      blocking: raw.blocking.filter((issue) => !gatedStages.has(issue.stage)),
      warnings: raw.warnings.filter((issue) => !gatedStages.has(issue.stage)),
    };
  }, [data, canPricing]);
  const visibleStages = useMemo(() => STAGES.filter((s) => !s.gated || canPricing), [canPricing]);
  const showNights = stage === "cities" || stage === "hotels";

  // Linear position drives the mobile prev/next bar and the "step N of M" chip.
  const stageIndex = visibleStages.findIndex((s) => s.key === stage);
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

        {/* MOBILE stepper — horizontal, tappable, current chip auto-scrolled into
            view. Replaces the vertical rail below xl so the form is the first
            thing the agent sees on a phone. */}
        <nav aria-label={t("pg.progress")} className="mb-3 xl:hidden">
          <div className="flex gap-1.5 overflow-x-auto pb-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {visibleStages.map((meta, index) => {
              const active = meta.key === stage;
              const status = validation.stages[meta.key];
              return (
                <Link
                  key={meta.key}
                  ref={active ? activeChipRef : undefined}
                  href={stageHref(draftId, meta.key)}
                  aria-current={active ? "step" : undefined}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-[12.5px] font-bold transition-colors ${
                    active
                      ? "border-[#185045] bg-[#185045] text-white"
                      : "border-[#dbe6e1] bg-white text-[#185045]"
                  }`}
                >
                  <StatusIcon status={status} active={active} />
                  <span>{t(meta.labelKey)}</span>
                  <span className={`tv-tnum text-[10px] font-extrabold ${active ? "text-[#8fe3c4]" : "text-[#b6c9c2]"}`}>
                    <DirText dir="ltr">{String(index + 1)}</DirText>
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>

        <div
          className={`grid gap-4 items-start ${
            stage !== "preview" && previewOpen
              ? "xl:grid-cols-[230px_minmax(0,1fr)_minmax(320px,420px)]"
              : "xl:grid-cols-[230px_minmax(0,1fr)]"
          }`}
        >
          {/* progress rail + validation panel — on mobile this drops BELOW the
              form (order-2) so the agent lands straight on the inputs. */}
          <aside className="order-2 space-y-4 xl:order-none">
            <nav className="hidden rounded-2xl border border-[#e2ebe7] bg-white p-3 shadow-[0_1px_2px_rgba(0,60,58,0.04)] xl:block">
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

            {/* nights indicator — cities & hotels stages ONLY */}
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
                  {(() => {
                    if (validation.nights.match) return t("pg.nightsComplete");
                    const ns = nightsStatus(validation.nights.used, validation.nights.total);
                    return ns.status === "excess"
                      ? t("pg.nightsExcessN", { n: ns.diff })
                      : t("pg.nightsRemainingN", { n: ns.diff });
                  })()}
                </p>
              </div>
            ) : null}

            {/* validation panel */}
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
                      currentStage={stage}
                      issueText={issueText}
                      fixLabel={t("pg.fix")}
                      icon={<XCircle className="mt-0.5 size-3.5 shrink-0 text-[#c22850]" />}
                    />
                  ) : null}
                  {validation.warnings.length > 0 ? (
                    <IssueList
                      title={t("pg.warnings")}
                      titleClass="text-[#a86a10]"
                      issues={validation.warnings}
                      draftId={draftId}
                      currentStage={stage}
                      issueText={issueText}
                      fixLabel={t("pg.fix")}
                      icon={<AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[#a86a10]" />}
                    />
                  ) : null}
                </div>
              )}
            </div>
          </aside>

          {/* stage form */}
          <main className="order-1 min-w-0 xl:order-none">
            <StageForm draftId={draftId} data={data} patch={patch} replace={replace} lookups={lookups} />

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

          {/* live preview pane (desktop; hidden on the preview stage itself) */}
          {stage !== "preview" && previewOpen ? (
            <aside className="hidden xl:block">
              <div className="sticky top-[90px]">
                <p className="mb-2 text-[11px] font-bold text-[#93aaa3]">{t("pg.previewHint")}</p>
                <div className="max-h-[calc(100vh-160px)] overflow-y-auto rounded-[14px]">
                  <div className="origin-top scale-[0.62] rtl:origin-top-right ltr:origin-top-left" style={{ width: "161%" }}>
                    <OfferDocument data={data} onSectionClick={(target) => router.push(stageHref(draftId, target))} />
                  </div>
                </div>
              </div>
            </aside>
          ) : null}
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
  issues: DraftIssue[];
  draftId: string;
  currentStage: StageKey;
  issueText: (issue: DraftIssue) => string;
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
              <Link
                href={stageHref(draftId, issue.stage)}
                className="shrink-0 rounded-md bg-[#f0f7f4] px-2 py-0.5 text-[10.5px] font-extrabold text-[#185045] hover:bg-[#e2ede9]"
              >
                {fixLabel}
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
