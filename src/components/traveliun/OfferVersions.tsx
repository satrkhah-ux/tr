"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Eye, History, Loader2, RotateCcw } from "lucide-react";
import type { TranslationKey } from "@/lib/i18n";
import { listOfferVersions, restoreOfferVersion } from "@/lib/data/offer-versions";
import type { OfferVersion, OfferVersionKind } from "@/lib/offer/version-history";
import type { OfferChangeKind } from "@/lib/offer/version-diff";
import { useTraveliunUI } from "./TraveliunUIProvider";

const KIND_KEY: Record<OfferChangeKind, TranslationKey> = {
  hotel: "pg.reissue.kind.hotel",
  room: "pg.reissue.kind.room",
  board: "pg.reissue.kind.board",
  rooms: "pg.reissue.kind.rooms",
  stayDates: "pg.reissue.kind.stayDates",
  dates: "pg.reissue.kind.dates",
  travellers: "pg.reissue.kind.travellers",
  flights: "pg.reissue.kind.flights",
  price: "pg.reissue.kind.price",
  includes: "pg.reissue.kind.includes",
};
const VERSION_KIND: Record<OfferVersionKind, TranslationKey> = {
  issued: "pg.versions.kind.issued",
  reissued: "pg.versions.kind.reissued",
  republished: "pg.versions.kind.republished",
  restored: "pg.versions.kind.restored",
};

/**
 * «سجل النسخ» of an issued file: every version the client was sent, newest
 * first — when, by whom, what it was (first issue / update / restore of N), its
 * dates, hotels and total, and what it changed against the version before. Each
 * opens as it was sent; an older one can be put back («استعادة»), which issues
 * it as the next version under the same serial (offer-versions.ts) — the
 * history only ever grows.
 */
export function OfferVersions({
  serial,
  draftId,
  refreshKey = 0,
  flush,
  defaultOpen = false,
}: {
  serial: string;
  /** the Basic draft a restore re-issues; none (a repackage) lists and shows the versions without «استعادة». */
  draftId?: string;
  refreshKey?: number;
  flush?: () => Promise<void>;
  /** opened from the files list's «سجل النسخ»: already unfolded. */
  defaultOpen?: boolean;
}) {
  const { t, language } = useTraveliunUI();
  const [open, setOpen] = useState(defaultOpen);
  const [versions, setVersions] = useState<OfferVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await listOfferVersions(serial);
    if (res.ok) {
      setVersions(res.versions);
      setError(null);
    } else setError(t(res.error as TranslationKey));
  }, [serial, t]);

  useEffect(() => {
    if (open) void load();
  }, [open, refreshKey, load]);

  async function restore(v: number) {
    if (!draftId) return;
    setBusy(v);
    setError(null);
    try {
      // anything typed and not yet saved is saved first: the restore keeps it in the history
      await flush?.();
      const res = await restoreOfferVersion(draftId, v);
      if (!res.ok) return setError(t(res.error as TranslationKey));
      setDone(t("pg.versions.restored", { from: v, n: res.version ?? "" }));
      // the editor holds the old draft in memory — open the restored one
      window.setTimeout(() => window.location.reload(), 1200);
    } catch {
      setError(t("err.db"));
    } finally {
      setBusy(null);
      setConfirming(null);
    }
  }

  const latest = versions?.[0]?.version ?? 0;
  const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");
  const when = (iso: string) =>
    new Date(iso).toLocaleString(language === "ar" ? "ar-SA-u-nu-latn" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Riyadh" });

  return (
    <section className="mt-3 rounded-[12px] border border-[#dbe6e1] bg-white">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-start">
        <History className="size-4 text-[#185045]" />
        <span className="text-[12.5px] font-extrabold text-[#185045]">{t("pg.versions.title")}</span>
        {versions ? <span className="text-[11px] font-bold text-tv-text-faint">({versions.length})</span> : null}
        <ChevronDown className={`ms-auto size-4 text-[#557d78] transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="space-y-2 border-t border-[#eef3f1] px-3 py-2">
          <p className="text-[11.5px] font-semibold text-[#557d78]">{t("pg.versions.hint")}</p>
          {error ? (
            <p role="alert" className="text-[12px] font-bold text-[#c22850]">
              {error}
            </p>
          ) : null}
          {done ? (
            <p role="status" className="text-[12px] font-bold text-[#0f7a52]">
              {done}
            </p>
          ) : null}
          {!versions ? (
            <p className="flex items-center gap-1.5 text-[12px] text-[#557d78]">
              <Loader2 className="size-3.5 animate-spin" /> {t("pg.versions.loading")}
            </p>
          ) : versions.length === 0 ? (
            <p className="text-[12px] text-[#557d78]">{t("pg.versions.empty")}</p>
          ) : (
            <ol className="space-y-2">
              {versions.map((v) => (
                <li key={v.version} className={`rounded-[10px] border p-2.5 ${v.current ? "border-[#2aa87a] bg-[#f3fbf7]" : "border-[#e6efeb]"}`}>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <b className="text-[12.5px] text-[#003c3a]">{t("pg.versions.v", { n: v.version })}</b>
                    <span className="rounded-full bg-[#eef4f1] px-2 py-0.5 text-[10.5px] font-bold text-[#185045]">
                      {t(VERSION_KIND[v.kind], { n: v.restored_from ?? "" })}
                    </span>
                    {v.current ? <span className="rounded-full bg-[#185045] px-2 py-0.5 text-[10.5px] font-bold text-white">{t("pg.versions.current")}</span> : null}
                    <span className="text-[11px] text-[#557d78]">
                      {when(v.at)}
                      {v.by ? ` · ${t("pg.versions.by", { who: v.by })}` : ""}
                    </span>
                  </div>
                  <p className="mt-1 text-[11.5px] text-[#3f5f59]">
                    <span className="tv-tnum" dir="ltr">
                      {day(v.arrival_date)} → {day(v.departure_date)}
                    </span>
                    {v.total != null ? ` · ${v.total.toLocaleString("en-US")} ${v.currency ?? ""}` : ""}
                    {v.hotels.length ? ` · ${v.hotels.join(" · ")}` : ""}
                  </p>
                  {v.version > 1 ? (
                    v.changes.length ? (
                      <ul className="mt-1 space-y-0.5 text-[11.5px] font-semibold text-[#3f5f59]">
                        {v.changes.map((c, i) => (
                          <li key={i}>
                            • {t(KIND_KEY[c.kind])}
                            {c.where ? ` — ${c.where}` : ""}: <span dir="auto">{c.before}</span> {language === "ar" ? "←" : "→"} <span dir="auto">{c.after}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-[11px] text-tv-text-faint">{t("pg.versions.sameAsBefore")}</p>
                    )
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <a
                      href={`/offer/${serial}/versions/${v.version}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center gap-1 rounded-[8px] border border-[#dbe6e1] px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f4f8f6]"
                    >
                      <Eye className="size-3.5" /> {t("pg.versions.view")}
                    </a>
                    {!draftId ? null : !v.current && v.restorable ? (
                      confirming === v.version ? (
                        <>
                          <button
                            type="button"
                            disabled={busy != null}
                            onClick={() => void restore(v.version)}
                            className="inline-flex h-8 items-center gap-1 rounded-[8px] bg-[#c25a28] px-2.5 text-[11.5px] font-bold text-white disabled:opacity-60 max-sm:min-h-10"
                          >
                            {busy === v.version ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
                            {busy === v.version ? t("pg.versions.restoring") : t("pg.versions.confirm", { n: v.version, next: latest + 1 })}
                          </button>
                          {busy == null ? (
                            <button type="button" onClick={() => setConfirming(null)} className="h-8 rounded-[8px] px-2 text-[11.5px] font-bold text-[#557d78] max-sm:min-h-10">
                              {t("pg.versions.cancel")}
                            </button>
                          ) : null}
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={busy != null}
                          onClick={() => setConfirming(v.version)}
                          className="inline-flex h-8 items-center gap-1 rounded-[8px] border border-[#c25a28] px-2.5 text-[11.5px] font-bold text-[#c25a28] hover:bg-[#fdf3ee] disabled:opacity-60 max-sm:min-h-10"
                        >
                          <RotateCcw className="size-3.5" /> {t("pg.versions.restore")}
                        </button>
                      )
                    ) : !v.current ? (
                      <span className="text-[11px] text-tv-text-faint">{t("pg.versions.noDraft")}</span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </section>
  );
}
