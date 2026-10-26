"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardCheck, FileUp, PlaneTakeoff, Search, SlidersHorizontal, Users, Wallet, type LucideIcon } from "lucide-react";
import { GlassFolder, hashString, type ArtPreset, type FolderFile, type GlassFolderStrings } from "@/components/ui/glass-folder-cards";
import { DirText } from "@/components/DirText";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/EmptyState";
import type { OperationCard } from "@/lib/data/operations";
import type { OperationSignal } from "@/lib/operations/signals";
import { byLastProgress } from "@/lib/operations/last-progress";
import type { ServiceKind, ServiceSummary } from "@/lib/operations/booking-summary";
import { matchesFilters, matchesQuery, NO_FILTERS, type ListFilters } from "@/lib/operations/case-list";
import type { StaffOption } from "@/lib/data/operation-case";
import { ArrivalsCalendar, OperationsFilters } from "./OperationsListControls";
import { MoneyLinks } from "./MoneyReports";
import type { TranslationKey } from "@/lib/i18n";
import { TraveliunShell } from "../TraveliunShell";
import { SuggestInput } from "../SuggestInput";
import { resolvePlace } from "@/lib/leads/places";
import type { Place } from "@/lib/leads/auto";
import { useTraveliunUI } from "../TraveliunUIProvider";

/**
 * The operations board.
 *
 * Bespoke rather than the config-driven table, because every «يحتاج إجراءً»
 * signal is DERIVED and time-dependent — "travel is approaching" becomes true
 * with no UPDATE anywhere — so there is no column for the generic engine to
 * filter on. Live cases number in the tens, so loading once and grouping in
 * memory is the honest trade.
 */

const EXEC_KEY = (s: string) => `ops.exec.${s}` as TranslationKey;
const SIGNAL_KEY = (c: string) => `ops.signal.${c}` as TranslationKey;

type Filter = "needs_action" | "all" | "unpaid" | "travelling_soon";

/** A case as the board gets it: its signals, «آخر إنجاز» and its services (operations-work.ts). */
type BoardCase = OperationCard & { signals: OperationSignal[]; last_progress_at?: string | null; services?: ServiceSummary[] };

const NO_PLACES: Place[] = [];

export function OperationsBoard({
  operations,
  today,
  owners,
  staff,
  canSeeMoney,
  places = NO_PLACES,
}: {
  /**
   * ONLY confirmed cases. The board deliberately does not list unconfirmed
   * offers: ops staff work what sales has handed over, and showing the whole
   * customer pipeline here made the one screen they live in unreadable.
   */
  operations: BoardCase[];
  /** injected by the server page so the board and the signals agree on "now". */
  today: string;
  /** operation id → its owner's employee id (0064). */
  owners?: Record<string, string>;
  staff?: StaffOption[];
  /** pricing.internal: links to the money pages (order 11). Courtesy — each page checks again. */
  canSeeMoney?: boolean;
  /** the catalogue's countries and cities — «الوجهة» lists each country once, however the case spelled it */
  places?: Place[];
}) {
  const { t } = useTraveliunUI();
  const [query, setQuery] = useState("");
  // every client's card, newest progress first (the owner, 2026-10-23: «كل عميل بطاقته تظهر اول شيء، اول البطاقات هي اخر الانجاز»)
  const [filter, setFilter] = useState<Filter>("all");
  const [filters, setFilters] = useState<ListFilters>(NO_FILTERS);
  // the dates, destination, owner and state fold away, so the clients' cards are the first thing on the page
  const [showFilters, setShowFilters] = useState(false);
  const activeFilters = (Object.keys(NO_FILTERS) as (keyof ListFilters)[]).filter((k) => filters[k] !== NO_FILTERS[k]).length;

  const listed = useMemo(
    () =>
      operations.map((op) => {
        // «تايلند» and «تايلاند» are one destination (the evaluator, 2026-10-23): the catalogue's country, else the text
        const place = op.destination ? resolvePlace(op.destination, places) : null;
        return { ...op, assignee_id: owners?.[op.id] ?? null, destination_key: place?.kind === "destination" ? place.country : (op.destination?.trim() ?? null) };
      }),
    [operations, owners, places],
  );
  // the default list: live cases only — cancelled and travelled ones do not crowd it
  const base = useMemo(() => listed.filter((op) => matchesFilters(op, filters)), [listed, filters]);
  const staffName = useMemo(() => new Map((staff ?? []).map((s) => [s.id, s.label])), [staff]);

  const rows = useMemo(() => {
    const q = query.trim();
    // a search reaches every case, closed ones too — the client on the phone may have travelled already
    const pool = q
      ? listed.filter((op) => matchesQuery(op, q) && matchesFilters(op, filters, true))
      : base.filter((op) => {
          if (filter === "needs_action" && op.signals.length === 0) return false;
          if (filter === "unpaid" && !op.signals.some((s) => s.code === "unpaid_confirmed")) return false;
          if (filter === "travelling_soon" && !op.signals.some((s) => s.code === "travel_approaching_incomplete")) return false;
          return true;
        });
    return pool.sort((a, b) => byLastProgress({ last_progress_at: a.last_progress_at ?? null }, { last_progress_at: b.last_progress_at ?? null }));
  }, [listed, base, filters, query, filter]);

  const counts = useMemo(
    () => ({
      needs_action: base.filter((o) => o.signals.length > 0).length,
      all: base.length,
      unpaid: base.filter((o) => o.signals.some((s) => s.code === "unpaid_confirmed")).length,
      travelling_soon: base.filter((o) => o.signals.some((s) => s.code === "travel_approaching_incomplete")).length,
    }),
    [base],
  );
  const destinations = useMemo(() => [...new Set(listed.map((o) => o.destination_key).filter((d): d is string => Boolean(d)))].sort(), [listed]);

  // a card per list, in the colour of what it holds (the owner, 2026-10-18: «حولها الى بطاقات … يحتاج اجراء لون احمر»)
  const FILTERS: { key: Filter; labelKey: TranslationKey; icon: LucideIcon; tone: string; ring: string }[] = [
    { key: "needs_action", labelKey: "ops.needsAction", icon: AlertTriangle, tone: "border-[#f3c9c9] bg-[#fdf0f0] text-[#b42318]", ring: "ring-[#b42318]" },
    { key: "travelling_soon", labelKey: "ops.signal.travel_approaching_incomplete", icon: PlaneTakeoff, tone: "border-[#f6d3b3] bg-[#fff4ea] text-[#b54708]", ring: "ring-[#b54708]" },
    { key: "unpaid", labelKey: "ops.signal.unpaid_confirmed", icon: Wallet, tone: "border-[#efdc9f] bg-[#fdf8e6] text-[#8a6100]", ring: "ring-[#8a6100]" },
    { key: "all", labelKey: "all", icon: ClipboardCheck, tone: "border-[#cfe0d9] bg-[#eef6f2] text-[#185045]", ring: "ring-[#185045]" },
  ];

  return (
    <TraveliunShell title="nav.operations">
      <div className="tv-fade-up space-y-4">
        {/* a slim head — the title, the four lists as chips, search, upload — so the cards come first (the owner, 2026-10-23) */}
        <section className="rounded-2xl border border-[#e2ebe7] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-lg font-extrabold text-[#003c3a]">{t("ops.title")}</h1>
            <p className="text-[12px] font-semibold text-[#93aaa3]">{t("ops.subtitle")}</p>
          </div>
          {canSeeMoney ? <MoneyLinks /> : null}

          {/* a chip per list, in the colour of what it holds (the owner, 2026-10-18: «يحتاج اجراء لون احمر») */}
          <div className="-mx-1 mt-2.5 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {FILTERS.map((f) => {
              const Icon = f.icon;
              const on = filter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setFilter(f.key)}
                  className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12px] font-bold", f.tone, on && `ring-2 ring-offset-1 ${f.ring}`)}
                >
                  <Icon className="size-4" />
                  <span className="tv-tnum text-[14px] font-extrabold">
                    <DirText dir="ltr">{String(counts[f.key])}</DirText>
                  </span>
                  {t(f.labelKey)}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex flex-wrap items-start gap-2">
            <Link
              href="/operations/day"
              className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[#185045] bg-white px-4 text-[12.5px] font-extrabold text-[#185045] hover:bg-[#f0f7f4]"
            >
              <ClipboardCheck className="size-4" />
              {t("nav.opsDay")}
            </Link>
            <UploadPicker operations={listed} />
            <button
              type="button"
              aria-expanded={showFilters}
              onClick={() => setShowFilters((v) => !v)}
              className={cn(
                "inline-flex h-10 items-center gap-1.5 rounded-[10px] border px-3 text-[12.5px] font-bold",
                showFilters || activeFilters > 0 ? "border-[#185045] bg-[#f0f7f4] text-[#185045]" : "border-[#dbe6e1] bg-white text-[#557d78]",
              )}
            >
              <SlidersHorizontal className="size-4" />
              {t("ops.filtersToggle")}
              {activeFilters > 0 ? <span className="tv-tnum rounded-full bg-[#185045] px-1.5 text-[10.5px] text-white">{activeFilters}</span> : null}
            </button>
            <div className="relative basis-full sm:ms-auto sm:basis-auto">
              <Search className="absolute end-3 top-1/2 size-4 -translate-y-1/2 text-[#8aa29b]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("ops.list.searchHint")}
                className="h-10 w-full rounded-[10px] border border-[#dbe6e1] bg-white px-3 pe-9 text-sm text-[#185045] outline-none focus:border-[#2aa87a] sm:w-64"
              />
            </div>
          </div>
          {showFilters ? <OperationsFilters filters={filters} onChange={setFilters} destinations={destinations} staff={staff ?? []} /> : null}
        </section>

        {rows.length === 0 ? (
          <section className="rounded-2xl border border-[#e2ebe7] bg-white shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
            <EmptyState
              icon={filter === "needs_action" && counts.all > 0 ? CheckCircle2 : ClipboardCheck}
              title={filter === "needs_action" && counts.all > 0 ? t("ops.allClear") : t("ops.noOperations")}
              description={counts.all === 0 ? t("ops.noOperationsHint") : ""}
            />
          </section>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] justify-items-center gap-x-4 gap-y-7">
            {rows.map((op, i) => (
              <CaseFolder key={op.id} op={op} index={i} owner={op.assignee_id ? (staffName.get(op.assignee_id) ?? null) : null} />
            ))}
          </div>
        )}

        <ArrivalsCalendar operations={listed} today={today} />

        {/* today is injected so the server and the client agree on the clock */}
        <span className="hidden" data-today={today} />
      </div>
    </TraveliunShell>
  );
}

const KIND_LABEL: Record<ServiceKind, TranslationKey> = {
  flight: "pg.stage.flights",
  hotel: "pg.stage.hotels",
  transport: "pg.stage.transport",
  service: "pg.stage.services",
  visa: "pg.stage.visas",
};

const FOLDER_AR: Partial<GlassFolderStrings> = {
  open: "افتح",
  close: "أغلق",
  openFolder: "اعرض الخدمات",
  closeFolder: "أغلق المجلد",
  items: (n) => (n === 1 ? "خدمة واحدة" : n === 2 ? "خدمتان" : n >= 3 && n <= 10 ? `${n} خدمات` : `${n} خدمة`),
  contents: "— الخدمات",
  more: "خيارات",
  options: "— خيارات",
};

/**
 * One client, one glass folder (the owner, 2026-10-23, with the component he
 * chose): the client on the glass, what the case waits on above it, its
 * services inside — each opens the case — and under the folder the owner,
 * the travellers, the money and «آخر إنجاز», which orders the board.
 */
function CaseFolder({ op, owner, index }: { op: BoardCase; owner: string | null; index: number }) {
  const { t, language } = useTraveliunUI();
  const router = useRouter();
  const href = `/operations/${op.id}`;
  const top = op.signals.find((s) => s.severity === "critical") ?? op.signals.find((s) => s.severity === "warn") ?? op.signals[0];
  const services = op.services ?? [];
  const allDone = services.length > 0 && services.every((s) => s.state === "done");
  // one calm palette (the owner, 2026-10-26: «بلون واحد … بالالوان المزعجة»): red ink only
  // for a critical signal; everything in progress shares the quiet default
  const art: ArtPreset = top?.severity === "critical"
    ? "ember"
    : op.execution_status === "travelled"
      ? "glacier"
      : allDone
        ? "verdant"
        : "aurora";
  // the badge says THE WORD the case lacks: the signal when one fires, else the first unfinished service
  const firstOpen = services.find((s) => s.state !== "done");
  const files: FolderFile[] = services.length
    ? services.map((s) => ({
        name: t(KIND_LABEL[s.kind]),
        meta: s.state === "done" ? "✓" : `${s.confirmed}/${s.total}`,
        art: s.state === "done" ? "verdant" : s.state === "problem" ? "ember" : undefined,
        href,
      }))
    : [{ name: t("ops.openCase"), href }];
  const when = op.last_progress_at
    ? new Date(op.last_progress_at).toLocaleString(language === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", {
        timeZone: "Asia/Riyadh",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  return (
    <div className="flex w-[300px] max-w-full flex-col items-stretch">
      <GlassFolder
        width={300}
        dir={language === "ar" ? "rtl" : "ltr"}
        strings={language === "ar" ? FOLDER_AR : undefined}
        label={op.customer_name || "—"}
        meta={[op.serial, op.destination].filter(Boolean).join(" · ")}
        badge={
          top
            ? { text: t(SIGNAL_KEY(top.code)), tone: top.severity === "critical" ? "danger" : "warn" }
            : firstOpen
              ? { text: t("ops.card.lacks", { what: t(KIND_LABEL[firstOpen.kind]) }), tone: "warn" }
              : { text: t(EXEC_KEY(op.execution_status)), tone: "ok" }
        }
        art={art}
        seed={(hashString(op.serial) % 4) + 1}
        files={files}
        action="more"
        menu={[
          { label: t("ops.openCase"), onSelect: () => router.push(href) },
          { label: t("wz.up.button"), onSelect: () => router.push(`${href}?upload=1`) },
        ]}
        appearDelay={Math.min(index, 8) * 70}
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-[11.5px] font-bold text-[#557d78]">
        {when ? (
          <span className="tv-tnum text-[#185045]">
            {t("ops.lastProgress")} <DirText dir="ltr">{when}</DirText>
          </span>
        ) : null}
        {owner ? <span className="rounded-full bg-[#eaf1ff] px-2 py-0.5 text-[10.5px] text-[#2b57c4]">{owner}</span> : null}
        {op.partner_name ? (
          <span className="rounded-full bg-[#f0e9f9] px-2 py-0.5 text-[10.5px] text-[#6a3fa0]">{t("ops.partnerTag", { name: op.partner_name })}</span>
        ) : null}
        <span className="inline-flex items-center gap-1">
          <Users className="size-3" />
          <DirText dir="ltr">{String(op.travelers_count)}</DirText>
        </span>
        {op.travel_start ? (
          <span className="tv-tnum">
            {t("ops.travelWindow")} <DirText dir="ltr">{op.travel_start}</DirText>
          </span>
        ) : null}
        {op.total != null ? (
          <span className={op.paid >= op.total ? "text-[#0f7a52]" : "text-[#a86a10]"}>
            <DirText dir="ltr">
              <span className="tv-tnum">{`${op.paid} / ${op.total} ${op.currency ?? ""}`}</span>
            </DirText>
          </span>
        ) : null}
        <Link href={href} className="ms-auto inline-flex items-center gap-1 text-[#185045] hover:underline">
          {t("ops.openCase")}
          <ArrowLeft className="size-3.5 ltr:rotate-180" />
        </Link>
      </div>
    </div>
  );
}

/**
 * «ارفع ملفات عميل» (the owner, 2026-10-22): pick the client — by name or
 * file number, any case — and its page opens on «ارفع كل الملفات».
 */
function UploadPicker({ operations }: { operations: OperationCard[] }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const label = (op: OperationCard) => `${op.customer_name || "—"} · ${op.serial}`;
  const byLabel = useMemo(() => new Map(operations.map((op) => [label(op), op.id])), [operations]);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#185045] px-4 text-[12.5px] font-extrabold text-white hover:bg-[#0f4439]"
      >
        <FileUp className="size-4" />
        {t("wz.up.pick")}
      </button>
    );
  }
  return (
    <div className="w-72 max-w-full">
      <SuggestInput
        value={value}
        items={operations.map((op) => ({ value: label(op), hint: op.destination ?? undefined, keywords: `${op.serial} ${op.customer_name ?? ""}` }))}
        onChange={(next, picked) => {
          setValue(next);
          const id = byLabel.get(next);
          if (picked && id) router.push(`/operations/${id}?upload=1`);
        }}
        placeholder={t("wz.up.pickHint")}
        ariaLabel={t("wz.up.pick")}
        className="h-10 w-full rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-sm text-[#185045] outline-none focus:border-[#2aa87a]"
      />
    </div>
  );
}
