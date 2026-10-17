"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Copy, History, Loader2, Search } from "lucide-react";
import { DirText } from "@/components/DirText";
import { normalizeName } from "@/lib/offer/pricing-suggest";
import type { DraftSummary } from "@/lib/data/drafts";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { nightsText, useBasicLabels } from "./labels";
import { OfferVersions } from "../OfferVersions";
import { FileStateChip } from "./FileStateChip";
import type { FileStatusRow } from "@/lib/data/file-status-core";
import { FILE_STATES, type FileState } from "@/lib/offer/file-state";

type ServiceKey = DraftSummary["services"][number];
const SERVICES: { key: ServiceKey; label: "svcHotels" | "svcFlightsIntl" | "svcFlightsDom" | "svcTransport" | "svcVisas" }[] = [
  { key: "hotels", label: "svcHotels" },
  { key: "flights_intl", label: "svcFlightsIntl" },
  { key: "flights_domestic", label: "svcFlightsDom" },
  { key: "transport", label: "svcTransport" },
  { key: "visas", label: "svcVisas" },
];

const select = "h-8 rounded-[8px] border border-[#cfe0d9] bg-white px-2 text-[12px] font-bold text-[#185045]";

/** one column grid for the header and every row, so the columns line up (lg and up; below, a row stacks) */
const COLS = "lg:grid-cols-[8.5rem_minmax(0,1fr)_9.5rem_7.5rem_8.5rem_23rem]";

/** the company's day, whatever the browser's clock zone */
const dayKey = (iso: string | Date) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });

/**
 * «آخر الملفات» — by day, the employee's own first (the owner, 2026-10-15):
 * «ملفاتي», everyone's, or one colleague's; and by country, service or a word.
 * Files made before the maker was recorded have none: they show under everyone.
 */
export function RecentFiles({
  drafts,
  states = {},
  meId,
  allByDefault = false,
  busy,
  onCopy,
}: {
  drafts: DraftSummary[];
  /** where each issued file stands (sent, confirmed, paid…), by draft id — staff only */
  states?: Record<string, FileStatusRow>;
  /** the signed-in employee; null for a partner (all their files are their company's) */
  meId: string | null;
  /** the administration opens on everyone's files */
  allByDefault?: boolean;
  busy: string | null;
  onCopy: (id: string) => void;
}) {
  const tx = useBasicLabels();
  const { language } = useTraveliunUI();
  const [who, setWho] = useState<string>(meId && !allByDefault ? "mine" : "all");
  const [country, setCountry] = useState("");
  const [service, setService] = useState<ServiceKey | "">("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "draft" | "issued">("all");
  // one state of the ladder («أُرسل للعميل», «مؤكّد»…), on top of the tabs
  const [state, setState] = useState<FileState | "">("");
  // an issued file the lookup missed claims nothing: «صدر»
  const stateOf = (d: DraftSummary): FileState => states[d.id]?.state ?? (d.produced_serial ? "published" : "draft");
  const [history, setHistory] = useState<string | null>(null);

  const makers = useMemo(
    () =>
      [...new Map(drafts.filter((d) => d.created_by && d.created_by !== meId).map((d) => [d.created_by as string, d.created_by_name ?? "—"])).entries()].sort(
        (a, b) => a[1].localeCompare(b[1], "ar"),
      ),
    [drafts, meId],
  );
  // one entry per country however it was spelled («إندونيسيا» / «اندونيسيا»)
  const countries = useMemo(
    () =>
      [...new Map(drafts.filter((d) => d.country).map((d) => [normalizeName(d.country), d.country as string])).entries()].sort((a, b) =>
        a[1].localeCompare(b[1], "ar"),
      ),
    [drafts],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return drafts.filter(
      (d) =>
        (who === "all" || (who === "mine" ? d.created_by === meId : d.created_by === who)) &&
        (!country || normalizeName(d.country) === country) &&
        (!service || d.services.includes(service)) &&
        (!q ||
          [d.title, d.destination, d.customer_name, d.company, d.produced_serial, d.created_by_name].some((v) => v?.toLowerCase().includes(q))),
    );
  }, [drafts, who, meId, country, service, query]);
  const inState = useMemo(
    () => filtered.filter((d) => !state || stateOf(d) === state),
    // stateOf reads states, which is a prop
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, state, states],
  );
  // «مسودات / مُصدرة» on top of the other filters (the state's too), each with how many it holds
  const counts = { all: inState.length, draft: inState.filter((d) => !d.produced_serial).length, issued: inState.filter((d) => d.produced_serial).length };
  const shown = useMemo(() => inState.filter((d) => status === "all" || (status === "issued") === Boolean(d.produced_serial)), [inState, status]);
  const presentStates = FILE_STATES.filter((s) => drafts.some((d) => stateOf(d) === s));

  const days = useMemo(() => {
    const groups = new Map<string, DraftSummary[]>();
    for (const d of shown) {
      const key = dayKey(d.updated_at);
      groups.set(key, [...(groups.get(key) ?? []), d]);
    }
    return [...groups.entries()];
  }, [shown]);

  const now = new Date();
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000));
  const dayTitle = (key: string) =>
    key === today
      ? tx("today")
      : key === yesterday
        ? tx("yesterday")
        : new Date(`${key}T12:00:00Z`).toLocaleDateString(language === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long",
          });

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-1.5" role="tablist">
        {(
          [
            ["all", tx("filesAll")],
            ["draft", tx("filesDrafts")],
            ["issued", tx("filesIssued")],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={status === key}
            onClick={() => setStatus(key)}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-bold ${status === key ? "bg-[#185045] text-white" : "border border-[#cfe0d9] bg-white text-[#557d78] hover:bg-[#f4f8f6]"}`}
          >
            {label}
            <span className={`tv-tnum rounded-full px-1.5 text-[10.5px] ${status === key ? "bg-white/20" : "bg-[#eef4f1]"}`}>{counts[key]}</span>
          </button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {meId ? (
          <select value={who} onChange={(e) => setWho(e.target.value)} aria-label={tx("recent")} className={select}>
            <option value="mine">{tx("mine")}</option>
            <option value="all">{tx("everyone")}</option>
            {makers.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        ) : null}
        <select value={country} onChange={(e) => setCountry(e.target.value)} aria-label={tx("allCountries")} className={select}>
          <option value="">{tx("allCountries")}</option>
          {countries.map(([key, name]) => (
            <option key={key} value={key}>{name}</option>
          ))}
        </select>
        {Object.keys(states).length > 0 ? (
          <select value={state} onChange={(e) => setState(e.target.value as FileState | "")} aria-label={tx("allStates")} className={select}>
            <option value="">{tx("allStates")}</option>
            {presentStates.map((s) => (
              <option key={s} value={s}>{tx(`st_${s}`)}</option>
            ))}
          </select>
        ) : null}
        <select value={service} onChange={(e) => setService(e.target.value as ServiceKey | "")} aria-label={tx("allServices")} className={select}>
          <option value="">{tx("allServices")}</option>
          {SERVICES.map((s) => (
            <option key={s.key} value={s.key}>{tx(s.label)}</option>
          ))}
        </select>
        <label className="relative min-w-40 flex-1">
          <Search className="pointer-events-none absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-[#8aa29b]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tx("searchFiles")}
            className="h-8 w-full rounded-[8px] border border-[#cfe0d9] bg-white pe-2 ps-7 text-[12px] font-semibold text-[#185045]"
          />
        </label>
      </div>

      {days.length === 0 ? (
        <p className="text-[12.5px] font-semibold text-[#93aaa3]">
          {drafts.length === 0 ? tx("emptyList") : who === "mine" ? tx("mineEmpty") : tx("noMatch")}
          {who === "mine" && drafts.length > 0 ? (
            <button type="button" onClick={() => setWho("all")} className="ms-2 font-bold text-[#2aa87a] hover:underline">
              {tx("everyone")}
            </button>
          ) : null}
        </p>
      ) : (
        <div className="space-y-3">
          {days.map(([key, list]) => (
            <div key={key}>
              <h3 className="mb-1 flex items-center gap-2 text-[11.5px] font-extrabold text-[#557d78]">
                {dayTitle(key)}
                <span className="tv-tnum rounded-full bg-[#eef4f1] px-1.5 text-[10.5px]">{list.length}</span>
              </h3>
              <div className="overflow-hidden rounded-[10px] border border-[#e3ece8]">
                {/* the columns, said once per day */}
                <div className={`${COLS} hidden bg-[#f6f9f8] px-3 py-1.5 text-[10.5px] font-extrabold text-[#78948f] lg:grid`}>
                  <span>{tx("colStatus")}</span>
                  <span>{tx("colClient")}</span>
                  <span>{tx("colTrip")}</span>
                  <span>{tx("colTotal")}</span>
                  <span>{tx("colMaker")}</span>
                  <span className="text-end">{tx("colActions")}</span>
                </div>
                <ul className="divide-y divide-[#edf3f0]">
                  {list.map((d) => {
                    const name = d.customer_name || (d.title && d.title !== d.destination ? d.title : null);
                    return (
                      <li key={d.id} className={history === d.id ? "bg-[#fbfdfc]" : ""}>
                        <div className={`${COLS} grid items-center gap-x-3 gap-y-1.5 px-3 py-2.5`}>
                          {/* where the file stands — the first thing to read */}
                          <span className="flex flex-col items-start gap-0.5">
                            <FileStateChip
                              state={stateOf(d)}
                              version={d.version}
                              sentVersion={states[d.id]?.sent_version}
                              stale={states[d.id]?.stale}
                            />
                          </span>
                          <Link href={`/basic/${d.id}`} className="min-w-0">
                            <span className={`block truncate text-[13px] font-bold hover:underline ${name ? "text-[#185045]" : "text-[#a3b5b0]"}`}>{name ?? tx("unnamed")}</span>
                            <span className="block truncate text-[11px] font-semibold text-[#78948f]">
                              {d.destination ?? ""}
                              {d.destination && d.produced_serial ? " · " : ""}
                              {d.produced_serial ? <DirText>{d.produced_serial}</DirText> : null}
                            </span>
                          </Link>
                          <span className="tv-tnum text-[11.5px] font-semibold text-[#557d78]">
                            {d.travel_date ? <DirText className="block">{d.travel_date}</DirText> : null}
                            <span className="block text-[#93aaa3]">
                              {[d.nights ? nightsText(d.nights, language) : "", d.travelers ? tx("travellersN", { n: d.travelers }) : ""].filter(Boolean).join(" · ") || "—"}
                            </span>
                          </span>
                          <span className="tv-tnum text-[12px] font-extrabold text-[#185045]">
                            {d.total != null ? <DirText>{`${Math.round(d.total).toLocaleString("en-US")} ${d.currency}`}</DirText> : <span className="font-semibold text-[#a3b5b0]">—</span>}
                          </span>
                          <span className="truncate text-[11.5px] font-semibold text-[#557d78]">{d.created_by_name ?? "—"}</span>
                          {/* fixed slots, so the buttons line up row under row */}
                          <span className="flex items-center gap-1.5 lg:justify-end">
                            <Link
                              href={`/basic/${d.id}`}
                              className="inline-flex h-8 w-[7.25rem] items-center justify-center rounded-[8px] bg-[#185045] text-[11.5px] font-bold text-white hover:bg-[#0f4439]"
                            >
                              {d.produced_serial ? tx("openFile") : tx("continueEntry")}
                            </Link>
                            {d.produced_serial && meId ? (
                              <button
                                type="button"
                                aria-expanded={history === d.id}
                                onClick={() => setHistory(history === d.id ? null : d.id)}
                                className={`inline-flex h-8 w-[6.25rem] items-center justify-center gap-1 rounded-[8px] border text-[11.5px] font-bold text-[#185045] ${history === d.id ? "border-[#185045] bg-[#f0f7f4]" : "border-[#cfe0d9] hover:bg-[#f4f8f6]"}`}
                              >
                                <History className="size-3.5" />
                                {tx("versionsBtn")}
                              </button>
                            ) : (
                              <span className="hidden w-[6.25rem] lg:block" aria-hidden />
                            )}
                            {/* the same programme for the next client */}
                            <button
                              type="button"
                              title={tx("copyHint")}
                              aria-label={tx("copyForNew")}
                              disabled={busy !== null}
                              onClick={() => onCopy(d.id)}
                              className="inline-flex h-8 w-[8.5rem] items-center justify-center gap-1 rounded-[8px] border border-[#cfe0d9] text-[11px] font-bold text-[#557d78] hover:bg-[#f4f8f6] disabled:opacity-60"
                            >
                              {busy === `c-${d.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <Copy className="size-3.5" />}
                              {tx("copyForNew")}
                            </button>
                          </span>
                        </div>
                        {history === d.id && d.produced_serial ? (
                          <div className="px-3 pb-3">
                            <OfferVersions serial={d.produced_serial} draftId={d.id} defaultOpen />
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
