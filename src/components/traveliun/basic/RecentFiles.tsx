"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Copy, FolderOpen, History, Loader2, Search, Settings2 } from "lucide-react";
import { DirText } from "@/components/DirText";
import { normalizeName } from "@/lib/offer/pricing-suggest";
import type { DraftSummary } from "@/lib/data/drafts";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { nightsText, useBasicLabels } from "./labels";
import { OfferVersions } from "../OfferVersions";
import { FileStateChip } from "./FileStateChip";
import { BasicFileStatus, prefetchFileStatus } from "./BasicFileStatus";
import { ClientConfirmedButton } from "./ClientConfirmedButton";
import type { ServiceKind, ServiceSummary } from "@/lib/operations/booking-summary";
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
const COLS = "lg:grid-cols-[minmax(0,1fr)_9.5rem_7.5rem_8.5rem_10rem_25.5rem]";
const PRIMARY = "inline-flex h-8 w-[7.5rem] items-center justify-center rounded-[8px] text-[11.5px] font-bold";
const ICON = "inline-flex size-8 shrink-0 items-center justify-center rounded-[8px] border border-[#cfe0d9] bg-white text-[#185045] hover:bg-[#f4f8f6]";

/** the row's own colour — a stripe on the start edge and a wash — by where the file stands */
const ROW_TONE: Record<FileState, string> = {
  draft: "border-[#d5dcd9] bg-white",
  issued: "border-[#e0a92a] bg-[#fffbf1]",
  published: "border-[#9fb8b1] bg-[#f8fbfa]",
  sent: "border-[#2f7fc0] bg-[#f3f8fd]",
  expired: "border-[#d9772b] bg-[#fdf6f0]",
  confirmed: "border-[#16a06a] bg-[#f1faf5]",
  paid_partial: "border-[#16a06a] bg-[#eef9f3]",
  paid_full: "border-[#0b6140] bg-[#eaf7f0]",
  ready: "border-[#0b8b8b] bg-[#eef9f9]",
  travelled: "border-[#6b7a99] bg-[#f5f7fa]",
  cancelled: "border-[#d14268] bg-[#fdf3f6]",
};

/** the one thing the file asks for next — on the left, beside its state */
function nextAction(state: FileState, staff: boolean): "continue" | "send" | "confirm" | "bookings" | "open" {
  if (state === "draft") return "continue";
  if (!staff) return "open";
  if (state === "issued" || state === "published" || state === "expired") return "send";
  if (state === "sent") return "confirm";
  if (state === "confirmed" || state === "paid_partial" || state === "paid_full" || state === "ready") return "bookings";
  return "open";
}

const SVC_LABEL: Record<ServiceKind, "svcK_flight" | "svcK_hotel" | "svcK_transport" | "svcK_service" | "svcK_visa"> = {
  flight: "svcK_flight",
  hotel: "svcK_hotel",
  transport: "svcK_transport",
  service: "svcK_service",
  visa: "svcK_visa",
};
const SVC_TONE: Record<ServiceSummary["state"], string> = {
  done: "border-[#bfe5d4] bg-[#e9f7f0] text-[#0f7a52]",
  progress: "border-[#f4d9a6] bg-[#fff8e8] text-[#a86a10]",
  problem: "border-[#f2b8c6] bg-[#fdeef2] text-[#c22850]",
};

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
  services = {},
  meId,
  allByDefault = false,
  initialTab = "all",
  busy,
  onCopy,
}: {
  drafts: DraftSummary[];
  /** where each issued file stands (sent, confirmed, paid…), by draft id — staff only */
  states?: Record<string, FileStatusRow>;
  /** a confirmed file's services in operations, by operation id */
  services?: Record<string, ServiceSummary[]>;
  /** the signed-in employee; null for a partner (all their files are their company's) */
  meId: string | null;
  /** the administration opens on everyone's files */
  allByDefault?: boolean;
  initialTab?: "all" | "draft" | "issued";
  busy: string | null;
  onCopy: (id: string) => void;
}) {
  const tx = useBasicLabels();
  const { language } = useTraveliunUI();
  const [who, setWho] = useState<string>(meId && !allByDefault ? "mine" : "all");
  const [country, setCountry] = useState("");
  const [service, setService] = useState<ServiceKey | "">("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | "draft" | "issued">(initialTab);
  // one state of the ladder («أُرسل للعميل», «مؤكّد»…), on top of the tabs
  const [state, setState] = useState<FileState | "">("");
  // an issued file the lookup missed claims nothing: «صدر»
  const stateOf = (d: DraftSummary): FileState => states[d.id]?.state ?? (d.produced_serial ? "published" : "draft");
  // one panel open under a row: the file's state and actions, or its versions
  const [panel, setPanel] = useState<{ id: string; kind: "status" | "versions" } | null>(null);
  const toggle = (id: string, kind: "status" | "versions") => setPanel(panel?.id === id && panel.kind === kind ? null : { id, kind });
  const router = useRouter();

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
              {/* no overflow clip: «العميل أكّد» opens its choice over the rows */}
              <div className="rounded-[10px] border border-[#e3ece8] [&>ul>li:last-child]:rounded-b-[10px]">
                {/* the columns, said once per day */}
                <div className={`${COLS} hidden border-s-4 border-transparent bg-[#f6f9f8] px-3 py-1.5 text-[10.5px] font-extrabold text-[#78948f] lg:grid`}>
                  <span>{tx("colClient")}</span>
                  <span>{tx("colTrip")}</span>
                  <span>{tx("colTotal")}</span>
                  <span>{tx("colMaker")}</span>
                  <span>{tx("colStatus")}</span>
                  <span className="text-end">{tx("colActions")}</span>
                </div>
                <ul className="divide-y divide-[#e6eeea]">
                  {list.map((d) => {
                    const name = d.customer_name || (d.title && d.title !== d.destination ? d.title : null);
                    const state = stateOf(d);
                    const opId = states[d.id]?.operation_id ?? null;
                    const svc = opId ? (services[opId] ?? []) : [];
                    const next = nextAction(state, Boolean(meId));
                    return (
                      // the whole row in the state's colour: what the eye reads first
                      <li key={d.id} className={`border-s-4 ${ROW_TONE[state]}`}>
                        {/* narrower than lg: client · trip · total · maker on one line, the state and the buttons under them */}
                        <div className={`${COLS} flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2.5 lg:grid lg:gap-x-3`}>
                          <span className="min-w-[11rem] flex-1">
                            <Link href={`/basic/${d.id}`} className={`block truncate text-[13px] font-bold hover:underline ${name ? "text-[#103f37]" : "text-[#a3b5b0]"}`}>
                              {name ?? tx("unnamed")}
                            </Link>
                            <span className="block truncate text-[11px] font-semibold text-[#78948f]">
                              {d.destination ?? ""}
                              {d.destination && d.produced_serial ? " · " : ""}
                              {d.produced_serial ? <DirText>{d.produced_serial}</DirText> : null}
                            </span>
                            {/* a confirmed file: its services as operations holds them */}
                            {svc.length > 0 && opId ? (
                              <span className="mt-1 flex flex-wrap gap-1">
                                {svc.map((s) => (
                                  <Link
                                    key={s.kind}
                                    href={`/operations/${opId}`}
                                    title={tx("svcOf", { done: s.confirmed, total: s.total })}
                                    className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${SVC_TONE[s.state]}`}
                                  >
                                    {s.state === "done" ? "✓" : s.state === "problem" ? "!" : `${s.confirmed}/${s.total}`} {tx(SVC_LABEL[s.kind])}
                                  </Link>
                                ))}
                              </span>
                            ) : null}
                          </span>
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
                          {/* the state, beside the action it calls for */}
                          <FileStateChip state={state} version={d.version} sentVersion={states[d.id]?.sent_version} stale={states[d.id]?.stale} />
                          <span className="ms-auto flex items-center gap-1.5 lg:ms-0 lg:justify-end">
                            {next === "continue" ? (
                              <Link href={`/basic/${d.id}`} className={`${PRIMARY} bg-[#185045] text-white hover:bg-[#0f4439]`}>
                                {tx("continueEntry")}
                              </Link>
                            ) : next === "bookings" && opId ? (
                              <Link href={`/operations/${opId}`} className={`${PRIMARY} bg-[#0f7a52] text-white hover:bg-[#0b6140]`}>
                                {tx("actBookings")}
                              </Link>
                            ) : next === "send" || next === "confirm" ? (
                              // waiting on the client: «العميل أكّد» is always in sight — it is how a file reaches its bookings
                              <ClientConfirmedButton draftId={d.id} expired={state === "expired"} className="w-[7.5rem]" />
                            ) : (
                              <Link href={`/basic/${d.id}`} className={`${PRIMARY} border border-[#cfe0d9] bg-white text-[#185045] hover:bg-[#f4f8f6]`}>
                                {tx("openFile")}
                              </Link>
                            )}
                            {next === "send" ? (
                              <button
                                type="button"
                                aria-expanded={panel?.id === d.id && panel.kind === "status"}
                                onClick={() => toggle(d.id, "status")}
                                onMouseEnter={() => prefetchFileStatus(d.id)}
                                onFocus={() => prefetchFileStatus(d.id)}
                                className={`${PRIMARY} bg-[#1d5f8a] text-white hover:bg-[#174d70]`}
                              >
                                {tx("actSend")}
                              </button>
                            ) : (
                              <span className="hidden w-[7.5rem] lg:block" aria-hidden />
                            )}
                            {d.produced_serial ? (
                              <Link href={`/basic/${d.id}`} title={tx("openFile")} aria-label={tx("openFile")} className={ICON}>
                                <FolderOpen className="size-4" />
                              </Link>
                            ) : (
                              <span className="hidden size-8 lg:block" aria-hidden />
                            )}
                            {d.produced_serial && meId ? (
                              <button
                                type="button"
                                title={tx("fileMore")}
                                aria-label={tx("fileMore")}
                                aria-expanded={panel?.id === d.id && panel.kind === "status"}
                                onClick={() => toggle(d.id, "status")}
                                onMouseEnter={() => prefetchFileStatus(d.id)}
                                onFocus={() => prefetchFileStatus(d.id)}
                                className={`${ICON} ${panel?.id === d.id && panel.kind === "status" ? "border-[#185045] bg-[#f0f7f4]" : ""}`}
                              >
                                <Settings2 className="size-4" />
                              </button>
                            ) : (
                              <span className="hidden size-8 lg:block" aria-hidden />
                            )}
                            {d.produced_serial && meId ? (
                              <button
                                type="button"
                                title={tx("versionsBtn")}
                                aria-label={tx("versionsBtn")}
                                aria-expanded={panel?.id === d.id && panel.kind === "versions"}
                                onClick={() => toggle(d.id, "versions")}
                                className={`${ICON} ${panel?.id === d.id && panel.kind === "versions" ? "border-[#185045] bg-[#f0f7f4]" : ""}`}
                              >
                                <History className="size-4" />
                              </button>
                            ) : (
                              <span className="hidden size-8 lg:block" aria-hidden />
                            )}
                            {/* the same programme for the next client */}
                            <button type="button" title={tx("copyHint")} aria-label={tx("copyForNew")} disabled={busy !== null} onClick={() => onCopy(d.id)} className={`${ICON} disabled:opacity-60`}>
                              {busy === `c-${d.id}` ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />}
                            </button>
                          </span>
                        </div>
                        {panel?.id === d.id && d.produced_serial ? (
                          <div className="border-t border-[#e6eeea] bg-white px-3 py-3">
                            {panel.kind === "versions" ? (
                              <OfferVersions serial={d.produced_serial} draftId={d.id} defaultOpen />
                            ) : (
                              <BasicFileStatus
                                draftId={d.id}
                                serial={d.produced_serial}
                                variant="panel"
                                onChanged={() => router.refresh()}
                                known={{ state, version: d.version, sentVersion: states[d.id]?.sent_version ?? null, stale: Boolean(states[d.id]?.stale), operationId: opId }}
                              />
                            )}
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
