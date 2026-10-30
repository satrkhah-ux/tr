"use client";

import { useState } from "react";
import { BadgeCheck, ChevronDown, History, Loader2 } from "lucide-react";
import { DirText } from "@/components/DirText";
import type { TranslationKey } from "@/lib/i18n";
import type { AuditEntry } from "@/lib/data/audit";
import { listRecordHistory, setHotelVerified } from "@/lib/data/quality-actions";
import { PROBLEM_LABEL, verifyBlockers } from "@/lib/data/quality";
import type { DataRow, DataValue, TableConfig } from "@/lib/data/types";
import { useSafeTransition } from "./useSafeTransition";
import { useTraveliunUI } from "./TraveliunUIProvider";

/**
 * Below a record's details: «الفندق المعتمد» for a hotel (data order 11.5) and
 * the record's change log from audit_logs (11.3).
 */
export function DataRecordExtras({ config, row }: { config: TableConfig; row: DataRow }) {
  const id = String(row.id ?? "");
  if (!id) return null;
  return (
    <div className="mb-5 space-y-3">
      {config.table === "hotels" ? <HotelVerify id={id} row={row} /> : null}
      <RecordHistory config={config} id={id} />
    </div>
  );
}

const text = (value: DataValue | undefined) => (typeof value === "string" ? value : null);

function HotelVerify({ id, row }: { id: string; row: DataRow }) {
  const { t } = useTraveliunUI();
  const [state, setState] = useState({ verified: row.verified === true, at: text(row.verified_at) });
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useSafeTransition();
  const missing = verifyBlockers({
    id,
    arabic_name: text(row.arabic_name),
    city_id: text(row.city_id),
    stars: typeof row.stars === "number" ? row.stars : Number(row.stars) || null,
    address: text(row.address),
    contact_number: text(row.contact_number),
  });
  const blocked = !state.verified && missing.length > 0;

  function toggle() {
    run(async () => {
      setError(null);
      const result = await setHotelVerified(id, !state.verified);
      if (result.ok) setState({ verified: result.verified, at: result.verified_at });
      else setError(t(result.error) + (result.missing?.length ? `: ${result.missing.map((p) => t(PROBLEM_LABEL[p])).join("، ")}` : ""));
    });
  }

  return (
    <div className={`rounded-[10px] border p-3 ${state.verified ? "border-[#bfe5d4] bg-[#e9f7f0]" : "border-[#e2ebe7] bg-[#f8fbf9]"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <BadgeCheck className={`size-4 ${state.verified ? "text-[#0f7a52]" : "text-tv-text-faint"}`} />
        <span className="text-[13px] font-extrabold">{t("data.quality.verify.title")}</span>
        <span className="text-[12px] font-semibold text-[#557d78]">
          {state.verified ? t("data.quality.verify.on", { date: (state.at ?? "").slice(0, 10) }) : t("data.quality.verify.off")}
        </span>
        <button
          type="button"
          onClick={toggle}
          disabled={pending || blocked}
          className="ms-auto inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#d8e3de] bg-white px-3 text-[12px] font-bold text-[#185045] hover:bg-[#f4f8f6] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {state.verified ? t("data.quality.verify.undo") : t("data.quality.verify.button")}
        </button>
      </div>
      {blocked ? (
        <p className="mt-2 text-[12px] font-semibold text-[#a86a10]">
          {t("data.quality.verify.incomplete")}: {missing.map((p) => t(PROBLEM_LABEL[p])).join("، ")}
        </p>
      ) : null}
      {error ? <p role="alert" className="mt-2 text-[12px] font-semibold text-[#c22850]">{error}</p> : null}
    </div>
  );
}

const ACTION_LABEL: Record<string, TranslationKey> = {
  "data.created": "data.quality.history.created",
  "data.updated": "data.quality.history.updated",
  "data.deleted": "data.quality.history.deleted",
  "data.verified": "data.quality.history.verified",
  "data.unverified": "data.quality.history.unverified",
  "data.requested": "data.quality.history.requested",
};

function RecordHistory({ config, id }: { config: TableConfig; id: string }) {
  const { t, dir } = useTraveliunUI();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, run] = useSafeTransition();
  const label = (column: string) => {
    const known = config.columns.find((c) => c.key === column);
    // /visas writes `country` from the picked country without showing it as a column
    return known ? t(known.labelKey) : column === "country" ? t("data.model.col.countryText") : column;
  };

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && entries === null) run(async () => setEntries(await listRecordHistory(config.table, id)));
  }

  return (
    <div className="rounded-[10px] border border-[#e2ebe7]">
      <button type="button" onClick={toggle} className="flex w-full items-center gap-2 px-3 py-2.5 text-[13px] font-extrabold text-[#185045]">
        <History className="size-4 text-tv-text-faint" />
        {t("data.quality.history.title")}
        {pending ? <Loader2 className="size-3.5 animate-spin text-tv-text-faint" /> : null}
        <ChevronDown className={`ms-auto size-4 text-tv-text-faint transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && entries ? (
        entries.length === 0 ? (
          <p className="px-3 pb-3 text-[12px] font-semibold text-tv-text-faint">{t("data.quality.history.empty")}</p>
        ) : (
          <ul className="max-h-56 space-y-2 overflow-y-auto px-3 pb-3">
            {entries.map((entry) => {
              const changes = (entry.meta?.changes ?? {}) as Record<string, [DataValue, DataValue]>;
              return (
                <li key={entry.id} className="rounded-[8px] bg-[#f4f8f6] p-2.5 text-[12px]">
                  <div className="flex flex-wrap items-center gap-x-2 font-bold text-[#185045]">
                    <span>{t(ACTION_LABEL[entry.action] ?? "data.quality.history.other")}</span>
                    <DirText dir="ltr" className="font-semibold text-[#557d78]">{entry.actor_email ?? "—"}</DirText>
                    <DirText dir="ltr" className="tv-tnum ms-auto font-semibold text-tv-text-faint">
                      {entry.created_at.slice(0, 16).replace("T", " ")}
                    </DirText>
                  </div>
                  {Object.keys(changes).length > 0 ? (
                    <ul className="mt-1 space-y-0.5 text-[#557d78]">
                      {Object.entries(changes).map(([column, [before, after]]) => (
                        <li key={column}>
                          <span className="font-semibold">{label(column)}:</span> {String(before ?? "—")} {dir === "rtl" ? "←" : "→"} {String(after ?? "—")}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </div>
  );
}
