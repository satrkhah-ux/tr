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

type ServiceKey = DraftSummary["services"][number];
const SERVICES: { key: ServiceKey; label: "svcHotels" | "svcFlightsIntl" | "svcFlightsDom" | "svcTransport" | "svcVisas" }[] = [
  { key: "hotels", label: "svcHotels" },
  { key: "flights_intl", label: "svcFlightsIntl" },
  { key: "flights_domestic", label: "svcFlightsDom" },
  { key: "transport", label: "svcTransport" },
  { key: "visas", label: "svcVisas" },
];

const select = "h-8 rounded-[8px] border border-[#cfe0d9] bg-white px-2 text-[12px] font-bold text-[#185045]";

/** the company's day, whatever the browser's clock zone */
const dayKey = (iso: string | Date) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });

/**
 * «آخر الملفات» — by day, the employee's own first (the owner, 2026-10-15):
 * «ملفاتي», everyone's, or one colleague's; and by country, service or a word.
 * Files made before the maker was recorded have none: they show under everyone.
 */
export function RecentFiles({
  drafts,
  meId,
  allByDefault = false,
  busy,
  onCopy,
}: {
  drafts: DraftSummary[];
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
  // «مسودات / مُصدرة» on top of the other filters, each with how many it holds
  const counts = { all: filtered.length, draft: filtered.filter((d) => !d.produced_serial).length, issued: filtered.filter((d) => d.produced_serial).length };
  const shown = useMemo(() => filtered.filter((d) => status === "all" || (status === "issued") === Boolean(d.produced_serial)), [filtered, status]);

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
              <ul className="divide-y divide-[#edf3f0] rounded-[10px] border border-[#edf3f0]">
                {list.map((d) => {
                  const name = d.customer_name || (d.title && d.title !== d.destination ? d.title : null);
                  return (
                    <li key={d.id}>
                      <div className="grid items-center gap-x-3 gap-y-1 px-3 py-2 sm:grid-cols-[7.5rem_minmax(0,1fr)_11rem_8rem_auto]">
                        {/* the state first: a draft, or issued and at which version */}
                        <span
                          className={`w-fit rounded-full px-2 py-0.5 text-[10.5px] font-bold ${d.produced_serial ? "bg-[#e9f7f0] text-[#0f7a52]" : "bg-[#f2f4f3] text-[#7a8783]"}`}
                        >
                          {d.produced_serial ? tx("statusIssued") : tx("statusDraft")}
                          {d.produced_serial && d.version ? ` · ${tx("versionN", { n: d.version })}` : ""}
                        </span>
                        <Link href={`/basic/${d.id}`} className="min-w-0 hover:underline">
                          <span className={`block truncate text-[13px] font-bold ${name ? "text-[#185045]" : "text-[#93aaa3]"}`}>{name ?? tx("unnamed")}</span>
                          <span className="block truncate text-[11px] font-semibold text-[#78948f]">
                            {d.destination ?? ""}
                            {d.destination && d.produced_serial ? " · " : ""}
                            {d.produced_serial ? <DirText>{d.produced_serial}</DirText> : null}
                          </span>
                        </Link>
                        <span className="tv-tnum text-[11.5px] font-semibold text-[#557d78]">
                          {[d.travel_date, d.nights ? nightsText(d.nights, language) : "", d.travelers ? tx("travellersN", { n: d.travelers }) : ""].filter(Boolean).join(" · ") || "—"}
                        </span>
                        <span className="truncate text-[11px] font-bold text-[#557d78]">
                          {d.total != null ? <DirText className="tv-tnum">{`${Math.round(d.total).toLocaleString("en-US")} ${d.currency}`}</DirText> : null}
                          {who !== "mine" && d.created_by_name ? <span className="block truncate font-semibold text-[#93aaa3]">{d.created_by_name}</span> : null}
                        </span>
                        <span className="flex items-center gap-1.5 justify-self-end">
                          <Link href={`/basic/${d.id}`} className="inline-flex h-8 items-center rounded-[8px] bg-[#185045] px-3 text-[11.5px] font-bold text-white hover:bg-[#0f4439]">
                            {tx("open")}
                          </Link>
                          {/* staff only: a partner (no meId) has no version history to open */}
                          {d.produced_serial && meId ? (
                            <button
                              type="button"
                              aria-expanded={history === d.id}
                              onClick={() => setHistory(history === d.id ? null : d.id)}
                              className={`inline-flex h-8 items-center gap-1 rounded-[8px] border px-2.5 text-[11.5px] font-bold text-[#185045] ${history === d.id ? "border-[#185045] bg-[#f0f7f4]" : "border-[#cfe0d9] hover:bg-[#f4f8f6]"}`}
                            >
                              <History className="size-3.5" />
                              {tx("versionsBtn")}
                            </button>
                          ) : null}
                          {/* the same programme for the next client */}
                          <button
                            type="button"
                            title={tx("copyHint")}
                            disabled={busy !== null}
                            onClick={() => onCopy(d.id)}
                            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-[8px] border border-[#cfe0d9] px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f4f8f6] disabled:opacity-60"
                          >
                            {busy === `c-${d.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <Copy className="size-3.5" />}
                            {tx("copy")}
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
          ))}
        </div>
      )}
    </>
  );
}
