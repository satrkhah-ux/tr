"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Copy, History, Loader2, MoreHorizontal, Pencil, Search, Settings2, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DirText } from "@/components/DirText";
import { normalizeName } from "@/lib/offer/pricing-suggest";
import type { DraftSummary } from "@/lib/data/drafts";
import { deleteFiles } from "@/lib/data/file-status";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { useCanOpen } from "@/lib/roles/useCanOpen";
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

/**
 * one column grid for the header and every row, so the columns line up — from
 * 1640px, where the client's name still has room beside the buttons (body zoom
 * 1.12); below, a row stacks: its details on one line, the buttons under them
 */
const COLS = "@4xl:grid-cols-[minmax(0,1fr)_7.5rem_7.5rem_12rem_15.5rem]";
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
  const { language, t } = useTraveliunUI();
  const canOpen = useCanOpen();
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
  // «حذف»: one row's button, or the rows ticked — staff only (the owner, 2026-10-17)
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [deleteNote, setDeleteNote] = useState<string | null>(null);
  const pick = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  async function remove(ids: string[]) {
    const one = ids.length === 1 ? drafts.find((d) => d.id === ids[0]) : undefined;
    const ask = one ? tx("deleteOne", { name: one.customer_name || one.title || tx("unnamed") }) : tx("deleteMany", { n: ids.length });
    if (ids.length === 0 || !window.confirm(ask)) return;
    setDeleting(true);
    setDeleteNote(null);
    try {
      const r = await deleteFiles(ids);
      if (!r.ok) return setDeleteNote(tx("deleteFailed"));
      if (r.refused > 0) setDeleteNote(tx("deleteRefused", { n: r.refused }));
      setPicked(new Set());
      router.refresh();
    } catch {
      setDeleteNote(tx("deleteFailed"));
    } finally {
      setDeleting(false);
    }
  }

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
  const pickedShown = shown.filter((d) => picked.has(d.id)).map((d) => d.id);
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
        {/* the same offers by stage — «العروض السياحية» and «لوح الباقات» are one place (the user, 2026-10-23) */}
        {canOpen({ href: "/kanban-board" }) ? (
          <Link href="/kanban-board" className="inline-flex h-8 items-center rounded-full border border-[#cfe0d9] bg-white px-3 text-[12px] font-bold text-[#557d78] hover:bg-[#f4f8f6]">
            {t("nav.kanban")}
          </Link>
        ) : null}
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

      {meId && (pickedShown.length > 0 || deleteNote) ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[10px] border border-[#f2b8c6] bg-[#fdf3f6] px-3 py-2 text-[12px] font-bold text-[#8a1f3c]">
          {pickedShown.length > 0 ? (
            <>
              <span className="tv-tnum">{tx("pickedN", { n: pickedShown.length })}</span>
              <button
                type="button"
                disabled={deleting}
                onClick={() => remove(pickedShown)}
                className="inline-flex h-8 items-center gap-1 rounded-[8px] bg-[#c22850] px-3 text-white hover:bg-[#a51f43] disabled:opacity-60"
              >
                {deleting ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                {tx("deletePicked")}
              </button>
              <button
                type="button"
                onClick={() => setPicked(new Set(shown.filter((d) => !states[d.id]?.operation_id).map((d) => d.id)))}
                className="h-8 rounded-[8px] border border-[#f2b8c6] bg-white px-3 hover:bg-[#fff7f9]"
              >
                {tx("pickAll")}
              </button>
              <button type="button" onClick={() => setPicked(new Set())} className="h-8 rounded-[8px] px-2 text-[#78948f] hover:underline">
                {tx("clearPicked")}
              </button>
            </>
          ) : null}
          {deleteNote ? <span className="font-semibold">{deleteNote}</span> : null}
        </div>
      ) : null}

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
              <div className="@container rounded-[10px] border border-[#e3ece8] [&>ul>li:last-child]:rounded-b-[10px]">
                {/* the columns, said once per day — the rows below keep exactly these */}
                <div className={`${COLS} hidden border-s-4 border-transparent bg-[#f6f9f8] px-3 py-1.5 text-[10.5px] font-extrabold text-[#78948f] @4xl:grid`}>
                  <span>{tx("colClient")}</span>
                  <span>{tx("colTrip")}</span>
                  <span>{tx("colTotal")}</span>
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
                    const statusOpen = panel?.id === d.id && panel.kind === "status";
                    const money = d.total != null ? `${Math.round(d.total).toLocaleString("en-US")} ${d.currency}` : null;
                    return (
                      // the whole row in the state's colour: what the eye reads first
                      <li key={d.id} className={`border-s-4 ${ROW_TONE[state]}`}>
                        {/* one layout for every row: who · the trip · the money · where it stands · the ONE next step */}
                        <div className={`${COLS} grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-2.5`}>
                          <span className="min-w-0">
                            <span className="flex items-center gap-2">
                              {meId ? (
                                <input
                                  type="checkbox"
                                  aria-label={tx("pickFile")}
                                  checked={picked.has(d.id)}
                                  disabled={Boolean(opId)}
                                  title={opId ? tx("deleteInOps") : undefined}
                                  onChange={() => pick(d.id)}
                                  className="size-4 shrink-0 accent-[#c22850] disabled:opacity-30"
                                />
                              ) : null}
                              <Link href={`/basic/${d.id}`} className={`block min-w-0 truncate text-[13px] font-bold hover:underline ${name ? "text-[#103f37]" : "text-[#a3b5b0]"}`}>
                                {name ?? tx("unnamed")}
                              </Link>
                            </span>
                            <span className="block truncate text-[11px] font-semibold text-[#78948f]">
                              {d.destination ?? ""}
                              {d.destination && d.produced_serial ? " · " : ""}
                              {d.produced_serial ? <DirText>{d.produced_serial}</DirText> : null}
                            </span>
                            {d.flights_later || (svc.length > 0 && opId) ? (
                              <span className="mt-1 flex flex-wrap gap-1">
                                {d.flights_later ? (
                                  <span className="inline-flex rounded-full bg-[#fff4dc] px-2 py-0.5 text-[10.5px] font-bold text-[#a86a10]">{tx("flightsLater")}</span>
                                ) : null}
                                {/* a confirmed file: its services as operations holds them */}
                                {opId
                                  ? svc.map((s) => (
                                      <Link
                                        key={s.kind}
                                        href={`/operations/${opId}`}
                                        title={tx("svcOf", { done: s.confirmed, total: s.total })}
                                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-bold ${SVC_TONE[s.state]}`}
                                      >
                                        {s.state === "done" ? "✓" : s.state === "problem" ? "!" : `${s.confirmed}/${s.total}`} {tx(SVC_LABEL[s.kind])}
                                      </Link>
                                    ))
                                  : null}
                              </span>
                            ) : null}
                          </span>
                          <span className="tv-tnum hidden text-[11.5px] font-semibold text-[#557d78] @4xl:block">
                            {d.travel_date ? <DirText className="block">{d.travel_date}</DirText> : null}
                            <span className="block text-[#93aaa3]">
                              {[d.nights ? nightsText(d.nights, language) : "", d.travelers ? tx("travellersN", { n: d.travelers }) : ""].filter(Boolean).join(" · ") || "—"}
                            </span>
                          </span>
                          {/* the money and who made it, one cell */}
                          <span className="tv-tnum hidden min-w-0 @4xl:block">
                            <span className="block text-[12px] font-extrabold text-[#185045]">
                              {money ? <DirText>{money}</DirText> : <span className="font-semibold text-[#a3b5b0]">—</span>}
                            </span>
                            <span className="block truncate text-[11px] font-semibold text-[#93aaa3]">{d.created_by_name ?? "—"}</span>
                          </span>
                          <span className="hidden @4xl:block">
                            <FileStateChip state={state} version={d.version} sentVersion={states[d.id]?.sent_version} stale={states[d.id]?.stale} />
                          </span>
                          {/* a phone: the state, the date, the money and the maker on one small line */}
                          <span className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold text-[#78948f] @4xl:hidden">
                            <FileStateChip state={state} version={d.version} sentVersion={states[d.id]?.sent_version} stale={states[d.id]?.stale} />
                            {d.travel_date ? <DirText className="tv-tnum">{d.travel_date}</DirText> : null}
                            {money ? <DirText className="tv-tnum font-extrabold text-[#185045]">{money}</DirText> : null}
                            {d.created_by_name ? <span>{d.created_by_name}</span> : null}
                          </span>
                          <span className="col-span-2 flex items-center justify-end gap-1.5 @4xl:col-span-1">
                            {/* the ONE next step — «أرسل للعميل» opens the send panel, which holds «العميل أكّد» too */}
                            {next === "continue" ? (
                              <Link href={`/basic/${d.id}`} className={`${PRIMARY} bg-[#185045] text-white hover:bg-[#0f4439]`}>
                                {tx("continueEntry")}
                              </Link>
                            ) : next === "bookings" && opId ? (
                              <Link href={`/operations/${opId}`} className={`${PRIMARY} bg-[#0f7a52] text-white hover:bg-[#0b6140]`}>
                                {tx("actBookings")}
                              </Link>
                            ) : next === "send" ? (
                              <button
                                type="button"
                                aria-expanded={statusOpen}
                                onClick={() => toggle(d.id, "status")}
                                onMouseEnter={() => prefetchFileStatus(d.id)}
                                onFocus={() => prefetchFileStatus(d.id)}
                                className={`${PRIMARY} bg-[#1d5f8a] text-white hover:bg-[#174d70]`}
                              >
                                {tx("actSend")}
                              </button>
                            ) : next === "confirm" ? (
                              <ClientConfirmedButton draftId={d.id} expired={state === "expired"} className="w-[7.5rem]" />
                            ) : (
                              <Link href={`/basic/${d.id}`} className={`${PRIMARY} border border-[#cfe0d9] bg-white text-[#185045] hover:bg-[#f4f8f6]`}>
                                {tx("openFile")}
                              </Link>
                            )}
                            {/* an issued or confirmed file is edited here — said in words (the owner, 2026-10-18) */}
                            {d.produced_serial ? (
                              <Link
                                href={`/basic/${d.id}`}
                                className="inline-flex h-8 w-[4.75rem] shrink-0 items-center justify-center gap-1 rounded-[8px] border border-[#cfe0d9] bg-white text-[11.5px] font-bold text-[#185045] hover:bg-[#f4f8f6]"
                              >
                                <Pencil className="size-3.5" />
                                {tx("editFile")}
                              </Link>
                            ) : (
                              <span className="hidden w-[4.75rem] @4xl:block" aria-hidden />
                            )}
                            {/* everything else, named, behind one button */}
                            <DropdownMenu>
                              <DropdownMenuTrigger aria-label={tx("moreActions")} title={tx("moreActions")} className={ICON}>
                                {busy === `c-${d.id}` ? <Loader2 className="size-4 animate-spin" /> : <MoreHorizontal className="size-4" />}
                              </DropdownMenuTrigger>
                              <DropdownMenuContent>
                                {d.produced_serial && meId ? (
                                  <>
                                    <DropdownMenuItem onClick={() => toggle(d.id, "status")} onMouseEnter={() => prefetchFileStatus(d.id)}>
                                      <Settings2 className="size-4" />
                                      {tx("fileStatusItem")}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => toggle(d.id, "versions")}>
                                      <History className="size-4" />
                                      {tx("versionsBtn")}
                                    </DropdownMenuItem>
                                  </>
                                ) : null}
                                <DropdownMenuItem disabled={busy !== null} onClick={() => onCopy(d.id)}>
                                  <Copy className="size-4" />
                                  {tx("copyForNew")}
                                </DropdownMenuItem>
                                {meId ? (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      disabled={deleting || Boolean(opId)}
                                      onClick={() => remove([d.id])}
                                      className="text-[#c22850] data-[highlighted]:bg-[#fdf3f6] data-[highlighted]:text-[#c22850]"
                                    >
                                      <Trash2 className="size-4" />
                                      {opId ? tx("deleteInOpsShort") : tx("deleteFile")}
                                    </DropdownMenuItem>
                                  </>
                                ) : null}
                              </DropdownMenuContent>
                            </DropdownMenu>
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
