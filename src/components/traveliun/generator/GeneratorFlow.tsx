"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  CircleDot,
  Eye,
  EyeOff,
  Loader2,
  Rocket,
  XCircle,
} from "lucide-react";
import { DirText } from "@/components/DirText";
import { produceOfferFromDraft } from "@/lib/data/drafts";
import {
  STAGES,
  stageHref,
  visibleStagesFor,
  type DraftData,
  type GeneratorLookups,
  type StageKey,
  type StageMeta,
} from "@/lib/offer/draft-types";
import { resumeStage, stageSummary } from "@/lib/offer/draft-flow";
import { validateDraft, type DraftIssue, type StageStatus } from "@/lib/offer/draft-validation";
import { useRole } from "@/lib/roles/RoleContext";
import { FieldIssueProvider } from "./FieldIssue";
import { STAGE_FORMS } from "./stage-forms";
import { useDraftState } from "./useDraftState";
import { TraveliunShell } from "../TraveliunShell";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { OfferDocument } from "@/components/offer-doc/OfferDocument";
import { draftBrand, draftToPreviewOffer } from "@/lib/offer/preview-dto";

/**
 * The package generator as ONE page of cards.
 *
 * It replaced eleven routes. Every «التالي» was a full server navigation that
 * re-fetched the draft and the lookups, and one file's answers were scattered
 * across eleven screens — the agent who filled in the cities walked to «الفنادق»
 * and was shown a different arrangement of the same trip. Here a finished card
 * folds into its own answer, the next one fades in below it, and the whole file
 * is one scroll.
 *
 * Two rules hold the thing together:
 *
 *   • ONLY THE ACTIVE CARD MOUNTS ITS FORM. Several stage forms do real work on
 *     mount — ItineraryStage writes the day skeleton, CitiesStage asks the
 *     server for reusable programmes. Mounting all eleven at page load would be
 *     eleven round-trips and a write to a draft the agent had not touched.
 *
 *   • FLUSH BEFORE MOVING. The eleven routes got their save-flush for free from
 *     unmounting on navigation. A single page has no navigation, so every card
 *     change asks for it explicitly — this is the one place a half-typed answer
 *     could be lost.
 *
 * «التسعير» is deliberately NOT a card: it is gated behind pricing.view and not
 * every agent may see it, so it keeps its own route and a link in the header.
 */
export function GeneratorFlow({
  draftId,
  initialData,
  lookups,
}: {
  draftId: string;
  initialData: DraftData;
  lookups: GeneratorLookups;
}) {
  const { t, language } = useTraveliunUI();
  const { can } = useRole();
  const canPricing = can("pricing.view");

  const { data, patch, replace, flush, saveState } = useDraftState(draftId, initialData);
  const [previewOpen, setPreviewOpen] = useState(true);

  // Issues that belong to permission-gated stages are hidden from roles without
  // access — a visitor must see NO trace of the pricing stage anywhere.
  const validation = useMemo(() => {
    const raw = validateDraft(data);
    if (canPricing) return raw;
    const gated = new Set(STAGES.filter((s) => s.gated).map((s) => s.key));
    return {
      ...raw,
      blocking: raw.blocking.filter((issue) => !gated.has(issue.stage)),
      warnings: raw.warnings.filter((issue) => !gated.has(issue.stage)),
    };
  }, [data, canPricing]);

  /**
   * The cards, in order. `visibleStagesFor` drops what the scope switches
   * exclude, and «التسعير» with them for a role without pricing.view — so an
   * agent who may not see cost never sees a gap where it would have been.
   */
  const cards: StageMeta[] = useMemo(
    () => visibleStagesFor(data.scope, canPricing),
    [data.scope, canPricing],
  );

  const [active, setActive] = useState<StageKey>(() => resumeStage(cards, validation.stages));

  /**
   * Reopening the scope card and switching a service off can remove the card
   * that is currently open. Recompute rather than render a blank.
   */
  const current = cards.some((s) => s.key === active) ? active : resumeStage(cards, validation.stages);

  const index = cards.findIndex((s) => s.key === current);
  const next = index >= 0 && index < cards.length - 1 ? cards[index + 1] : null;

  const activeRef = useRef<HTMLDivElement | null>(null);
  const firstPaint = useRef(true);
  useEffect(() => {
    // Resuming a half-filled draft must not scroll-jump on load — that reads
    // as a bug rather than as a greeting.
    if (firstPaint.current) {
      firstPaint.current = false;
      return;
    }
    const el = activeRef.current;
    if (!el) return;
    // The CSS reduced-motion switch zeroes animations and transitions; it does
    // not touch scrollIntoView, so this is the one place it is branched by hand.
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    // The HEADING, not the first field: a screen reader announces the section
    // the agent just arrived at, and their next Tab lands on the first input.
    // Autofocusing the input is actively hostile here — the city card opens on
    // a <select>, and focusing a native select on a phone pops the wheel picker
    // over the card the agent was about to read.
    el.querySelector<HTMLElement>("[data-flow-heading]")?.focus({ preventScroll: true });
  }, [current]);

  const open = useCallback(
    (stage: StageKey) => {
      void flush();
      setActive(stage);
    },
    [flush],
  );

  const issueText = useCallback(
    (issue: DraftIssue): string => {
      if (issue.invariant) return language === "ar" ? issue.invariant.message_ar : issue.invariant.message_en;
      return issue.key ? t(issue.key) : "";
    },
    [language, t],
  );

  const StageForm = STAGE_FORMS[current];

  /**
   * «إنشاء البرنامج السياحي» when the next card is the daily programme.
   *
   * Keyed on the NEXT stage rather than on the current one, so it works for
   * every combination of switches: with hotels off, the card before the
   * itinerary is «الشروط» or «التأشيرات», and the label still changes there.
   */
  const nextLabel = !next
    ? null
    : next.key === "itinerary"
      ? t("pg.flow.buildItinerary")
      : t("pg.flow.next", { stage: t(next.labelKey) });

  return (
    <TraveliunShell title="nav.packageGenerator">
      <div className="tv-fade-up">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/package-generator"
              className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[12.5px] font-bold text-[#557d78] transition-colors hover:bg-[#f4f8f6]"
            >
              <ArrowRight className="size-4 ltr:rotate-180 rtl:rotate-0" />
              {t("pg.backToDrafts")}
            </Link>
            {canPricing ? (
              <Link
                href={stageHref(draftId, "pricing")}
                className="inline-flex h-9 items-center gap-2 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[12.5px] font-bold text-[#557d78] transition-colors hover:bg-[#f4f8f6]"
              >
                {t("pg.flow.pricingLink")}
              </Link>
            ) : null}
          </div>
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
              {saveState === "saving" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : saveState === "error" ? (
                <XCircle className="size-3.5" />
              ) : (
                <Check className="size-3.5" />
              )}
              {saveState === "saving" ? t("pg.saving") : saveState === "error" ? t("pg.saveFailed") : t("pg.saved")}
            </span>
            {current !== "preview" ? (
              <button
                type="button"
                onClick={() => setPreviewOpen((v) => !v)}
                className="hidden h-9 items-center gap-2 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[12.5px] font-bold text-[#557d78] transition-colors hover:bg-[#f4f8f6] xl:inline-flex"
              >
                {previewOpen ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                {previewOpen ? t("pg.hidePreview") : t("pg.showPreview")}
              </button>
            ) : null}
            <Link
              href={stageHref(draftId, current === "hotels" ? "cities" : current)}
              className="inline-flex h-9 items-center gap-2 rounded-[9px] px-2 text-[11.5px] font-bold text-[#93aaa3] transition-colors hover:text-[#557d78]"
            >
              {t("pg.flow.classic")}
            </Link>
          </div>
        </div>

        <div
          className={`grid gap-4 ${
            current === "preview" || !previewOpen ? "" : "xl:grid-cols-[minmax(0,1fr)_380px]"
          }`}
        >
          <div className="order-1 min-w-0 space-y-3">
            {cards.map((meta) => {
              const isActive = meta.key === current;
              const status = validation.stages[meta.key];

              if (!isActive) {
                return (
                  <ClosedCard
                    key={meta.key}
                    label={t(meta.labelKey)}
                    status={status}
                    summary={stageSummary(meta.key, data)}
                    notStarted={t("pg.flow.notStarted")}
                    editLabel={t("pg.flow.edit")}
                    onOpen={() => open(meta.key)}
                  />
                );
              }

              return (
                <div key={meta.key} ref={activeRef} className="tv-fade-up scroll-mt-32 space-y-3">
                  {/* The heading lives OUTSIDE the stage's own card shell, so
                      an active card is not a card inside a card. */}
                  <div className="flex items-center gap-2 px-1">
                    <CircleDot className="size-4 text-[#2aa87a]" />
                    <h2
                      data-flow-heading
                      tabIndex={-1}
                      className="text-[13px] font-extrabold text-[#185045] outline-none"
                    >
                      {t(meta.labelKey)}
                    </h2>
                  </div>

                  {/* `key` remounts the form per card change, which replays the
                      fade and runs the stage's own effects once per opening —
                      exactly what a route navigation used to do. */}
                  <FieldIssueProvider
                    key={meta.key}
                    issues={[...validation.blocking, ...validation.warnings]}
                    render={issueText}
                  >
                    <StageForm
                      draftId={draftId}
                      data={data}
                      patch={patch}
                      replace={replace}
                      flush={flush}
                      lookups={lookups}
                    />
                  </FieldIssueProvider>

                  {meta.key === "itinerary" ? (
                    <ProduceBar draftId={draftId} data={data} patch={patch} ok={validation.ok} />
                  ) : null}

                  {nextLabel ? (
                    <div className="flex justify-end px-1">
                      <button
                        type="button"
                        onClick={() => next && open(next.key)}
                        className="inline-flex h-11 items-center gap-2 rounded-[11px] bg-[#185045] px-5 text-sm font-bold text-white transition-colors hover:bg-[#0f4439]"
                      >
                        {nextLabel}
                        <ChevronLeft className="size-4 ltr:rotate-180 rtl:rotate-0" />
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          {current !== "preview" && previewOpen ? (
            <aside className="order-2 hidden xl:block">
              <div className="sticky top-[90px] overflow-hidden rounded-2xl border border-[#e2ebe7] bg-white p-3">
                <div className="origin-top scale-[0.62]" style={{ width: "161%" }}>
                  <OfferDocument
                    variant="client"
                    offer={draftToPreviewOffer(data, lookups.airlines)}
                    {...draftBrand(data, lookups.partners)}
                  />
                </div>
              </div>
            </aside>
          ) : null}
        </div>
      </div>
    </TraveliunShell>
  );
}

const STATUS_DOT: Record<StageStatus, string> = {
  complete: "bg-[#2aa87a]",
  partial: "bg-[#e0a92a]",
  error: "bg-[#c22850]",
  empty: "bg-[#d8e3de]",
};

/** A finished card, folded into what it says. The whole row reopens it. */
function ClosedCard({
  label,
  status,
  summary,
  notStarted,
  editLabel,
  onOpen,
}: {
  label: string;
  status: StageStatus;
  summary: string[];
  notStarted: string;
  editLabel: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full flex-wrap items-center gap-3 rounded-2xl border bg-white px-4 py-3 text-start transition-colors hover:bg-[#f8fbfa] ${
        status === "error" ? "border-[#f2d0d7]" : "border-[#e2ebe7]"
      }`}
    >
      <span className={`size-2.5 shrink-0 rounded-full ${STATUS_DOT[status]}`} />
      <span className="text-[13px] font-extrabold text-[#185045]">{label}</span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {summary.length === 0 ? (
          <span className="text-[11.5px] font-semibold text-[#b6c9c2]">{notStarted}</span>
        ) : (
          summary.map((chip) => (
            <span
              key={chip}
              className="truncate rounded-full bg-[#f2f7f5] px-2.5 py-1 text-[11.5px] font-bold text-[#557d78]"
            >
              {chip}
            </span>
          ))
        )}
      </span>
      <span className="shrink-0 text-[11.5px] font-bold text-[#93aaa3]">{editLabel}</span>
    </button>
  );
}

/**
 * «إصدار العرض» — under the last day card, which is where the agent finishes
 * reading the programme they just had built.
 *
 * Producing mints the serial and publishes the client link, so it waits for a
 * press the agent can see. The gate is `validateDraft().ok` because the server
 * re-validates and refuses anyway — a button that looked enabled and then
 * failed would be a lie, so the blockers are listed right here instead.
 */
function ProduceBar({
  draftId,
  data,
  patch,
  ok,
}: {
  draftId: string;
  data: DraftData;
  patch: (slice: Partial<DraftData>) => void;
  ok: boolean;
}) {
  const { t } = useTraveliunUI();
  const [producing, setProducing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const produced = data.produced_serial;

  async function produce() {
    if (producing || !ok) return;
    setProducing(true);
    setError(null);
    const result = await produceOfferFromDraft(draftId);
    setProducing(false);
    if (!result.ok) {
      setError(t(result.error));
      return;
    }
    patch({ produced_serial: result.serial });
  }

  if (produced) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#bfe5d4] bg-[#e9f7f0] px-4 py-3">
        <Check className="size-4 text-[#0f7a52]" />
        <span className="text-[12.5px] font-extrabold text-[#0f7a52]">{t("pg.producedSerial")}</span>
        <DirText dir="ltr" className="tv-tnum text-[12.5px] font-extrabold text-[#0f7a52]">
          {produced}
        </DirText>
        <Link
          href={`/client-offer/${produced}`}
          target="_blank"
          className="ms-auto inline-flex h-9 items-center gap-2 rounded-[9px] bg-[#185045] px-3.5 text-[12px] font-bold text-white hover:bg-[#0f4439]"
        >
          {t("pg.openClientLink")}
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#e2ebe7] bg-white px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px] font-semibold text-[#93aaa3]">{t("pg.previewNote")}</p>
        <button
          type="button"
          onClick={() => void produce()}
          disabled={producing || !ok}
          title={!ok ? t("pg.err.blockingLeft") : undefined}
          className="inline-flex h-11 items-center gap-2 rounded-[11px] bg-[#185045] px-5 text-sm font-bold text-white transition-colors hover:bg-[#0f4439] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {producing ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
          {producing ? t("pg.producing") : t("pg.produce")}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-[12.5px] font-semibold text-[#c22850]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
