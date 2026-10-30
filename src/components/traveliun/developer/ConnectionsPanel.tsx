"use client";

import { useState } from "react";
import { Loader2, RefreshCw, Server } from "lucide-react";
import type { TranslationKey } from "@/lib/i18n";
import type { ServerInfo } from "@/lib/developer/checks";
import { whenText, type CheckGroup, type CheckResult, type CheckStatus } from "@/lib/developer/health";
import { recheckAllConnections, recheckConnection, testFlightLookupApi } from "@/lib/data/developer-actions";
import { Skeleton } from "@/components/ui/Skeleton";
import { useTraveliunUI } from "../TraveliunUIProvider";

import { buttonTone } from "@/components/ui/button-variants";
/**
 * «الارتباطات الخارجية» — one card per connection, as the server last saw it.
 * The page streams the first round in; each card re-checks on its own, and the
 * metered flight API only on its «اختبار» button.
 */

const GROUPS: { group: CheckGroup; label: TranslationKey }[] = [
  { group: "core", label: "dev.group.core" },
  { group: "api", label: "dev.group.api" },
  { group: "bots", label: "dev.group.bots" },
  { group: "jobs", label: "dev.group.jobs" },
];

const TONES: Record<CheckStatus, { label: TranslationKey; badge: string; dot: string }> = {
  ok: { label: "dev.status.ok", badge: "bg-[#e3f6ee] text-[#0f7a52] dark:bg-[#123a2c] dark:text-[#6fe0b0]", dot: "bg-[#0f7a52] dark:bg-[#6fe0b0]" },
  warn: { label: "dev.status.warn", badge: "bg-[#fdf3e1] text-[#a86a10] dark:bg-[#3a2c10] dark:text-[#f2c46b]", dot: "bg-[#a86a10] dark:bg-[#f2c46b]" },
  down: { label: "dev.status.down", badge: "bg-[#fdeaef] text-[#c22850] dark:bg-[#3d1621] dark:text-[#f68aa5]", dot: "bg-[#c22850] dark:bg-[#f68aa5]" },
  unconfigured: { label: "dev.status.unconfigured", badge: "bg-[#eef1f4] text-[#5b6b78] dark:bg-[#1b2d27] dark:text-[#9fb3ac]", dot: "bg-[#5b6b78] dark:bg-[#9fb3ac]" },
  idle: { label: "dev.status.idle", badge: "bg-[#dff1f4] text-[#0e7490] dark:bg-[#0f3440] dark:text-[#7fd0e0]", dot: "bg-[#0e7490] dark:bg-[#7fd0e0]" },
};

const sectionClass = "rounded-[14px] border border-[#cfe0d9] bg-white p-4";
const cardClass = "flex min-w-0 flex-col gap-1.5 rounded-[12px] border border-[#e2ebe7] bg-[#f7faf8] p-3.5";
const smallButton =
  `${buttonTone({ variant: "secondary" })} inline-flex h-8 items-center gap-1.5 rounded-[9px] border px-2.5 text-[11.5px] font-extrabold disabled:opacity-60 max-sm:min-h-10`;

function StatusBadge({ status }: { status: CheckStatus }) {
  const { t } = useTraveliunUI();
  const tone = TONES[status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-extrabold ${tone.badge}`}>
      <span className={`size-[7px] rounded-full ${tone.dot}`} />
      {t(tone.label)}
    </span>
  );
}

function ConnectionCard({ result, busy, onRecheck }: { result: CheckResult; busy: boolean; onRecheck: () => void }) {
  const { t } = useTraveliunUI();
  return (
    <article className={cardClass}>
      <div className="flex items-start justify-between gap-2">
        <h4 className="text-[13px] font-extrabold text-[#0f3d38]">{t(result.label)}</h4>
        <StatusBadge status={result.status} />
      </div>
      <p className="break-words text-[12px] font-semibold text-[#557d78]">{t(result.detail.key, result.detail.params)}</p>
      {result.extra?.map((line, i) => (
        <p key={i} className="break-words text-[11.5px] font-semibold text-tv-text-faint">
          {t(line.key, line.params)}
        </p>
      ))}
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-dashed border-[#dce7e2] pt-2 text-[11px] font-bold text-tv-text-faint">
        <span dir="ltr">{result.latencyMs === null ? "— ms" : `${result.latencyMs} ms`}</span>
        <span>
          {result.lastRunAt
            ? t("dev.lastRun", { time: whenText(result.lastRunAt, true) })
            : t("dev.checkedAt", { time: whenText(result.checkedAt) })}
        </span>
        <button type="button" disabled={busy} onClick={onRecheck} className={`${smallButton} ms-auto`}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
          {t(result.manual ? "dev.test" : "dev.recheck")}
        </button>
      </div>
    </article>
  );
}

function ServerCard({ info }: { info: ServerInfo }) {
  const { t } = useTraveliunUI();
  const d = Math.floor(info.uptimeSec / 86_400);
  const h = Math.floor((info.uptimeSec % 86_400) / 3600);
  const m = Math.floor((info.uptimeSec % 3600) / 60);
  const rows: [TranslationKey, string][] = [
    ["dev.server.deploy", info.deploymentId ?? t("dev.server.deployNone")],
    ["dev.server.env", `${info.nodeEnv} · ${info.platform}`],
    ["dev.server.node", info.node],
    ["dev.server.uptime", t("dev.server.uptimeValue", { d, h, m })],
    ["dev.server.memory", t("dev.server.memoryValue", { rss: info.rssMb, heap: info.heapUsedMb, total: info.heapTotalMb })],
    [
      "dev.server.time",
      `${new Date(info.now).toLocaleString("en-GB", { timeZone: info.timeZone, dateStyle: "medium", timeStyle: "medium" })} (${info.timeZone})`,
    ],
  ];
  return (
    <article className={`${cardClass} sm:col-span-2`}>
      <h4 className="flex items-center gap-1.5 text-[13px] font-extrabold text-[#0f3d38]">
        <Server className="size-4 text-[#185045]" />
        {t("dev.server")}
      </h4>
      <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <dt className="text-[11.5px] font-bold text-tv-text-faint">{t(label)}</dt>
            <dd dir="ltr" className="min-w-0 break-all text-[12px] font-bold text-[#0f3d38]">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function SectionHeader({ action }: { action?: React.ReactNode }) {
  const { t } = useTraveliunUI();
  return (
    <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
      <div>
        <h2 className="text-[14px] font-extrabold text-[#185045]">{t("dev.connections")}</h2>
        <p className="mt-1 text-[12px] font-semibold text-tv-text-faint">{t("dev.connections.hint")}</p>
      </div>
      {action}
    </header>
  );
}

export function ConnectionsPanel({ initial, server }: { initial: CheckResult[]; server: ServerInfo }) {
  const { t } = useTraveliunUI();
  const [results, setResults] = useState(initial);
  const [info, setInfo] = useState(server);
  // one at a time: server actions queue anyway, and a second click must not spend a second flight-API request
  const [busy, setBusy] = useState<string | null>(null);

  async function recheck(result: CheckResult) {
    setBusy(result.id);
    try {
      const next = result.manual ? await testFlightLookupApi() : await recheckConnection(result.id);
      if (next) setResults((all) => all.map((r) => (r.id === next.id ? next : r)));
    } finally {
      setBusy(null);
    }
  }

  async function recheckAll() {
    setBusy("*");
    try {
      const next = await recheckAllConnections();
      if (next) {
        setResults(next.results);
        setInfo(next.server);
      }
    } finally {
      setBusy(null);
    }
  }

  const counts = (["ok", "warn", "down", "idle", "unconfigured"] as const)
    .map((status) => [status, results.filter((r) => r.status === status).length] as const)
    .filter(([, n]) => n > 0);

  return (
    <section className={sectionClass}>
      <SectionHeader
        action={
          <button type="button" disabled={busy !== null} onClick={() => void recheckAll()} className={smallButton}>
            {busy === "*" ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
            {t("dev.recheckAll")}
          </button>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {counts.map(([status, n]) => (
          <span key={status} className={`rounded-full px-2.5 py-1 text-[11px] font-extrabold ${TONES[status].badge}`}>
            {t(TONES[status].label)} · {n}
          </span>
        ))}
      </div>
      <div className="grid gap-5">
        {GROUPS.map(({ group, label }) => (
          <div key={group}>
            <h3 className="mb-2 text-[12.5px] font-extrabold text-[#557d78]">{t(label)}</h3>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {group === "core" ? <ServerCard info={info} /> : null}
              {results
                .filter((r) => r.group === group)
                .map((r) => (
                  <ConnectionCard key={r.id} result={r} busy={busy !== null} onRecheck={() => void recheck(r)} />
                ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** While the first round of checks is still out (at most the per-check timeout). */
export function ConnectionsSkeleton() {
  const { t } = useTraveliunUI();
  return (
    <section className={sectionClass} aria-busy="true">
      <SectionHeader />
      <p className="mb-3 flex items-center gap-1.5 text-[12px] font-bold text-[#557d78]">
        <Loader2 className="size-3.5 animate-spin" />
        {t("dev.checking")}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-[12px]" />
        ))}
      </div>
    </section>
  );
}
