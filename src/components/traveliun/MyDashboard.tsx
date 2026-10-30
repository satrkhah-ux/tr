"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { CheckCircle2, Clock, FilePen, FileText, Globe2, Percent, Receipt, Search, UserX, Users, type LucideIcon } from "lucide-react";
import { DirText } from "@/components/DirText";
import { EmptyState } from "@/components/ui/EmptyState";
import { normAr } from "@/lib/catalog/norm";
import { isConfirmed, type MyClient, type MyDashboard as MyDashboardData, type MyDraft, type MyOffer } from "@/lib/dashboard/my-stats";
import { useRole } from "@/lib/roles/RoleContext";
import { canOpenLink } from "@/lib/roles/section-access";
import type { TranslationKey } from "@/lib/i18n";
import type { FollowUpItem, FollowUpTone } from "@/lib/operations/wizard/followup";
import { useTraveliunUI } from "./TraveliunUIProvider";
import { ChartCard, KpiCard } from "./ExecutiveDashboardClient";
import { DestinationBar, StageBar } from "./charts/ExecutiveCharts";

/**
 * «لوحتي» — the owner's order of 2026-10-17: every account opens on its own
 * numbers. Four cards (issued / not finished / confirmed / clients), each opening
 * its list, and «تحليلي» under them. Everything arrives from the server already
 * scoped to the signed-in employee (data/my-dashboard.ts); this file only
 * filters, pages and draws.
 */

type ListKey = "issued" | "incomplete" | "confirmed" | "clients";

const PAGE = 50;
const INT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const fmt = (n: number) => INT.format(Math.round(n));
/** the company's calendar day */
const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });

const STATUS: Record<string, { key: TranslationKey; color: string }> = {
  confirmed: { key: "status.confirmed", color: "#0f7a52" },
  sent: { key: "status.sent", color: "#3457a8" },
  draft: { key: "status.draft", color: "#9a6a00" },
  cancelled: { key: "status.cancelled", color: "#c22850" },
};

const EMPTY: Record<ListKey, TranslationKey> = {
  issued: "dash.mine.emptyIssued",
  incomplete: "dash.mine.emptyIncomplete",
  confirmed: "dash.mine.emptyConfirmed",
  clients: "dash.mine.emptyClients",
};

const CARD = "rounded-2xl border border-[#e2ebe7] bg-white shadow-[0_1px_2px_rgba(0,60,58,0.04)]";

export function MyDashboard({ data }: { data: MyDashboardData }) {
  const { t } = useTraveliunUI();
  // no dashboard permission: the page's own empty state already says so
  if (!data.ok && data.reason === "forbidden") return null;
  if (!data.ok) {
    const noEmployee = data.reason === "noEmployee";
    return (
      <section className={CARD}>
        <EmptyState
          icon={UserX}
          title={t(noEmployee ? "dash.mine.noEmployee" : "dash.mine.loadError")}
          description={t(noEmployee ? "dash.mine.noEmployeeDesc" : "dash.mine.loadErrorDesc")}
        />
      </section>
    );
  }
  return <MyBoard data={data} />;
}

function MyBoard({ data }: { data: Extract<MyDashboardData, { ok: true }> }) {
  const { t } = useTraveliunUI();
  const [list, setList] = useState<ListKey>("issued");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const s = data.stats;

  function open(key: ListKey, q = "") {
    setList(key);
    setQuery(q);
    setLimit(PAGE);
  }

  const q = normAr(query);
  const match = (...fields: (string | null | undefined)[]) => !q || fields.some((f) => f && normAr(f).includes(q));
  const offers = (list === "confirmed" ? data.offers.filter(isConfirmed) : data.offers).filter((o) =>
    match(o.serial, o.client, o.phone, o.destination, o.country, ...o.cities),
  );
  const drafts = data.drafts.filter((d) => match(d.title, d.client, d.phone, d.country, ...d.cities));
  const clients = data.clients.filter((c) => match(c.name, c.phone, ...c.countries));

  const base = list === "incomplete" ? data.drafts.length : list === "clients" ? data.clients.length : list === "confirmed" ? s.confirmed : s.issued;
  const total = list === "incomplete" ? drafts.length : list === "clients" ? clients.length : offers.length;

  const cards: { key: ListKey; label: TranslationKey; value: number; hint: string; icon: LucideIcon; color: string }[] = [
    { key: "issued", label: "dash.mine.issued", value: s.issued, hint: t("dash.mine.issuedHint", { n: s.issuedThisMonth }), icon: FileText, color: "#0e9bb5" },
    { key: "incomplete", label: "dash.mine.incomplete", value: s.incomplete, hint: t("dash.mine.incompleteHint"), icon: FilePen, color: "#d99a00" },
    { key: "confirmed", label: "dash.mine.confirmed", value: s.confirmed, hint: t("dash.mine.confirmedHint", { n: s.openOperations }), icon: CheckCircle2, color: "#0f7a52" },
    { key: "clients", label: "dash.mine.clients", value: s.clients, hint: t("dash.mine.clientsHint", { n: s.newClientsThisMonth }), icon: Users, color: "#185045" },
  ];
  const listTitle = cards.find((c) => c.key === list)!.label;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-extrabold text-[#003c3a]">{t("dash.tab.mine")}</h2>
        <p className="text-[11.5px] font-semibold text-tv-text-faint">{t("dash.mine.hint")}</p>
      </div>

      <FollowUpList items={data.followUp} />

      {/* the four numbers — each one is the switch for its list */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => {
          const active = list === c.key;
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={active}
              onClick={() => open(c.key)}
              className={`rounded-[15px] border bg-white p-3.5 text-start shadow-[0_1px_2px_rgba(0,60,58,0.04)] transition-[transform,box-shadow] duration-150 hover:-translate-y-0.5 hover:shadow-[0_8px_22px_rgba(0,60,58,0.09)] sm:p-[18px] ${
                active ? "border-[#2aa87a] ring-2 ring-[#2aa87a]/25" : "border-[#e2ebe7]"
              }`}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="text-[12.5px] font-bold text-tv-text-faint">{t(c.label)}</span>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-[11px]" style={{ color: c.color, background: `${c.color}1a` }}>
                  <c.icon className="size-[18px]" />
                </span>
              </span>
              <span className="tv-tnum mt-1.5 block text-[26px] font-extrabold text-[#003c3a]">
                <DirText>{fmt(c.value)}</DirText>
              </span>
              <span className="mt-1 block text-[11.5px] font-semibold text-tv-text-faint">{c.hint}</span>
            </button>
          );
        })}
      </section>

      {/* the list the chosen card opens */}
      <section className={`${CARD} p-4 lg:p-5`}>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 className="text-[14px] font-extrabold text-[#003c3a]">{t(listTitle)}</h3>
          <span className="tv-tnum rounded-full bg-[#eef4f1] px-2 py-0.5 text-[11px] font-bold text-[#557d78]">
            <DirText>{t("dash.mine.count", { shown: fmt(Math.min(limit, total)), total: fmt(total) })}</DirText>
          </span>
          <label className="relative w-full sm:ms-auto sm:w-80">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-tv-text-faint" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setLimit(PAGE);
              }}
              placeholder={t("dash.mine.search")}
              aria-label={t("dash.mine.search")}
              className="h-10 w-full rounded-[10px] border border-[#dbe6e1] bg-[#f5f8f7] pe-3 ps-9 text-[13px] font-semibold text-[#185045] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus focus:border-[#2aa87a]"
            />
          </label>
        </div>

        {total === 0 ? (
          <p className="py-8 text-center text-[13px] font-semibold text-tv-text-faint">{t(base === 0 ? EMPTY[list] : "dash.mine.noMatch")}</p>
        ) : (
          <ul className="divide-y divide-[#eef2f0] dark:divide-[#294039]">
            {list === "incomplete"
              ? drafts.slice(0, limit).map((d) => <DraftItem key={d.id} d={d} />)
              : list === "clients"
                ? clients.slice(0, limit).map((c) => <ClientItem key={c.id} c={c} onOpen={() => open("issued", c.phone ?? c.name ?? "")} />)
                : offers.slice(0, limit).map((o) => <OfferItem key={o.id} o={o} />)}
          </ul>
        )}

        {total > limit ? (
          <button
            type="button"
            onClick={() => setLimit((n) => n + PAGE)}
            className="mt-3 w-full rounded-[10px] border border-[#dbe6e1] py-2 text-[13px] font-bold text-[#185045] transition-colors hover:bg-[#f4f8f6] dark:hover:bg-[#1b2d27]"
          >
            {t("dash.mine.more")}
          </button>
        ) : null}
      </section>

      <Analysis data={data} />
    </div>
  );
}

// ---------- «قائمة متابعتك اليوم» ----------
const TONE: Record<FollowUpTone, string> = {
  grey: "border-[#e2ebe7] bg-[#f6f8f7]",
  yellow: "border-[#f0d9a8] bg-[#fff8e8]",
  red: "border-[#f2c7c7] bg-[#fdecef]",
};

/**
 * The cases I answer for whose «ينتظر» day has come — red when the trip is
 * within a day, yellow past the day, grey due today. Opening one lands on its
 * first step with work left (the case page does that by itself).
 */
function FollowUpList({ items }: { items: FollowUpItem[] }) {
  const { t } = useTraveliunUI();
  if (items.length === 0) return null;
  return (
    <section className={`${CARD} p-4`}>
      <h3 className="mb-2 flex items-center gap-1.5 text-[14px] font-extrabold text-[#003c3a]">
        <Clock className="size-4" />
        {t("wz.follow.title")}
        <span className="tv-tnum rounded-full bg-[#eef4f1] px-2 py-0.5 text-[11px] font-bold text-[#557d78]">
          <DirText>{fmt(items.length)}</DirText>
        </span>
      </h3>
      <ul className="grid gap-1.5">
        {items.map((f) => (
          <li key={f.operationId}>
            <Link href={`/operations/${f.operationId}`} className={`block rounded-[11px] border px-3 py-2 transition-opacity hover:opacity-85 ${TONE[f.tone]}`}>
              <span className="flex flex-wrap items-center gap-2 text-[13px] font-extrabold text-[#185045]">
                <DirText>{f.serial}</DirText>
                <span className="font-bold text-[#557d78]">{f.client ?? t("dash.mine.noClient")}</span>
                {f.travelStart ? (
                  <span className="tv-tnum ms-auto text-[11.5px] font-bold text-[#557d78]">
                    {t("wz.follow.travel")} <DirText>{f.travelStart}</DirText>
                  </span>
                ) : null}
              </span>
              {f.steps.map((w) => (
                <span key={w.step} className="mt-0.5 block text-[12px] font-semibold text-[#0f3d38]">
                  {t(`wz.step.${w.step}` as TranslationKey)}: {t("wz.wait.from", { from: t(`wz.from.${w.from}` as TranslationKey), until: w.until })}
                  {w.note ? <span className="text-[#557d78]"> — {w.note}</span> : null}
                </span>
              ))}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- rows ----------
function Chip({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-bold" style={{ color, background: `${color}1a` }}>
      {children}
    </span>
  );
}

/** the second, quieter line of a row: who, where, when, last touched */
function Meta({ client, phone, place, cities, start, end, updated }: {
  client: string | null;
  phone: string | null;
  place: string | null;
  cities: string[];
  start: string | null;
  end: string | null;
  updated: string;
}) {
  const { t } = useTraveliunUI();
  return (
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] font-semibold text-[#557d78]">
      <span>
        {client ?? t("dash.mine.noClient")}
        {phone ? (
          <>
            {" · "}
            <DirText>{phone}</DirText>
          </>
        ) : null}
      </span>
      {place || cities.length > 0 ? <span>{[place, cities.join(" · ")].filter(Boolean).join(" — ")}</span> : null}
      {start ? (
        <span className="tv-tnum">
          <DirText>{end ? `${start} → ${end}` : start}</DirText>
        </span>
      ) : null}
      <span className="text-tv-text-faint">
        {t("dash.mine.updated")} <DirText className="tv-tnum">{day(updated)}</DirText>
      </span>
    </div>
  );
}

function Money({ total, currency }: { total: number | null; currency: string | null }) {
  if (total == null) return null;
  return (
    <span className="tv-tnum ms-auto text-[13px] font-extrabold text-[#0f3d38]">
      <DirText>{`${fmt(total)} ${currency ?? ""}`.trim()}</DirText>
    </span>
  );
}

function OfferItem({ o }: { o: MyOffer }) {
  const { t } = useTraveliunUI();
  const { can } = useRole();
  const status = STATUS[o.status];
  const op = o.operation;
  // sales may not hold the operations section (or only their own files) — the link follows section-access
  const opHref = op && canOpenLink({ href: `/operations/${op.id}` }, can) ? `/operations/${op.id}` : null;
  const opChip = op ? (
    <Chip color={op.live ? "#185045" : "#8aa29b"}>
      {t("dash.mine.operation")}: {t(`ops.exec.${op.executionStatus}` as TranslationKey)}
    </Chip>
  ) : null;
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/offer/${encodeURIComponent(o.serial)}/preview`} className="text-[13px] font-extrabold text-[#185045] hover:underline">
          <DirText>{o.serial}</DirText>
        </Link>
        {status ? <Chip color={status.color}>{t(status.key)}</Chip> : null}
        {opHref ? (
          <Link href={opHref} className="hover:opacity-80">
            {opChip}
          </Link>
        ) : (
          opChip
        )}
        <Money total={o.total} currency={o.currency} />
      </div>
      <Meta client={o.client} phone={o.phone} place={o.country ?? o.destination} cities={o.cities} start={o.start} end={o.end} updated={o.updatedAt} />
    </li>
  );
}

function DraftItem({ d }: { d: MyDraft }) {
  const { t } = useTraveliunUI();
  return (
    <li>
      <Link href={`/basic/${d.id}`} className="-mx-2 block rounded-[10px] px-2 py-2.5 transition-colors hover:bg-[#f7faf8] dark:hover:bg-[#1b2d27]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 truncate text-[13px] font-extrabold text-[#185045]">{d.title || d.client || d.country || "—"}</span>
          {d.missing.length > 0 ? (
            <Chip color="#a86a10">{t("dash.mine.missing", { list: d.missing.map((s) => t(`pg.stage.${s}` as TranslationKey)).join("، ") })}</Chip>
          ) : (
            <Chip color="#0f7a52">{t("dash.mine.ready")}</Chip>
          )}
          <Money total={d.total} currency={d.currency} />
        </div>
        <Meta client={d.client} phone={d.phone} place={d.country} cities={d.cities} start={d.start} end={d.end} updated={d.updatedAt} />
      </Link>
    </li>
  );
}

function ClientItem({ c, onOpen }: { c: MyClient; onOpen: () => void }) {
  const { t } = useTraveliunUI();
  return (
    <li>
      {/* a client opens their files in «العروض المصدرة» */}
      <button type="button" onClick={onOpen} className="-mx-2 block w-[calc(100%+1rem)] rounded-[10px] px-2 py-2.5 text-start transition-colors hover:bg-[#f7faf8] dark:hover:bg-[#1b2d27]">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-extrabold text-[#185045]">{c.name ?? t("dash.mine.noClient")}</span>
          {c.phone ? (
            <span className="tv-tnum text-[12px] font-semibold text-[#557d78]">
              <DirText>{c.phone}</DirText>
            </span>
          ) : null}
          <span className="ms-auto flex gap-1.5">
            <Chip color="#3457a8">{t("dash.mine.offersN", { n: c.offers })}</Chip>
            {c.confirmed > 0 ? <Chip color="#0f7a52">{t("dash.mine.confirmedN", { n: c.confirmed })}</Chip> : null}
          </span>
        </span>
        <span className="mt-1 flex flex-wrap gap-x-3 text-[12px] font-semibold text-[#557d78]">
          {c.countries.length > 0 ? <span>{c.countries.join(" · ")}</span> : null}
          <span className="text-tv-text-faint">
            {t("dash.mine.lastOffer")} <DirText className="tv-tnum">{day(c.lastAt)}</DirText>
          </span>
        </span>
      </button>
    </li>
  );
}

// ---------- «تحليلي» ----------
function Analysis({ data }: { data: Extract<MyDashboardData, { ok: true }> }) {
  const { t, dir, language } = useTraveliunUI();
  const s = data.stats;
  const locale = language === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB";
  const monthly = s.monthly.map((m) => ({
    label: new Date(`${m.month}-01T12:00:00Z`).toLocaleDateString(locale, { month: "short", timeZone: "UTC" }),
    value: m.value,
  }));
  const top = s.topCountries[0];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-extrabold text-[#003c3a]">{t("dash.mine.analysis")}</h2>
        <p className="text-[11.5px] font-semibold text-tv-text-faint">{t("dash.mine.analysisHint")}</p>
      </div>
      {s.issued === 0 ? (
        <section className={CARD}>
          <EmptyState icon={Globe2} title={t("dash.mine.emptyIssued")} description={t("dash.mine.noAnalysis")} />
        </section>
      ) : (
        <>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
            <KpiCard
              label={t("dash.mine.conversion")}
              value={String(s.conversion)}
              unit="%"
              hint={t("dash.mine.conversionHint", { confirmed: fmt(s.confirmed), issued: fmt(s.issued) })}
              icon={Percent}
              color="#d99a00"
            />
            <KpiCard
              label={t("dash.mine.avgValue")}
              value={s.avgSar != null ? fmt(s.avgSar) : "—"}
              unit={s.avgSar != null ? t("exec.currency") : undefined}
              hint={t("dash.mine.avgValueHint")}
              icon={Receipt}
              color="#0e9bb5"
            />
            <KpiCard
              label={t("dash.mine.topCountry")}
              value={top?.label ?? "—"}
              hint={top ? t("dash.mine.offersN", { n: top.value }) : t("dash.mine.noData")}
              icon={Globe2}
              color="#c2603b"
            />
          </div>
          <ChartCard title={t("dash.mine.monthly")} caption={t("dash.mine.monthlyHint")}>
            <StageBar data={monthly} dir={dir} />
          </ChartCard>
          <div className="grid gap-3 lg:grid-cols-2">
            <ChartCard title={t("dash.mine.topCountries")} caption={t("dash.mine.byOffers")}>
              {s.topCountries.length > 0 ? <DestinationBar data={s.topCountries} dir={dir} /> : <NoData />}
            </ChartCard>
            <ChartCard title={t("dash.mine.topCities")} caption={t("dash.mine.byOffers")}>
              {s.topCities.length > 0 ? <DestinationBar data={s.topCities} dir={dir} /> : <NoData />}
            </ChartCard>
          </div>
        </>
      )}
    </section>
  );
}

function NoData() {
  const { t } = useTraveliunUI();
  return <p className="py-10 text-center text-[13px] font-semibold text-tv-text-faint">{t("dash.mine.noData")}</p>;
}
