"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TranslationKey } from "@/lib/i18n";
import { whenText } from "@/lib/developer/health";
import {
  checkReadyOffersSheet,
  setReadyOffersSheet,
  type ReadyOffersPanelData,
  type SheetCheck,
} from "@/lib/data/ready-offers";
import { TABS } from "@/lib/ready-offers/parse";
import { SyncDialog } from "../ready-offers/ReadyOffersCatalog";
import { useTraveliunUI } from "../TraveliunUIProvider";

/**
 * «العروض الجاهزة» on /developer (the owner, 2026-10-18): the sheet the sync
 * reads — changed here without a deploy — a check of it, its preview and sync,
 * the last sync, and how many live offers the sheet contradicts itself on.
 */

const button =
  "inline-flex h-9 items-center rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[12px] font-extrabold text-[#185045] hover:bg-[#f4f8f6] disabled:opacity-60";
const sheetUrl = (id: string) => `https://docs.google.com/spreadsheets/d/${id}/edit`;

export function ReadyOffersSheetPanel({ data }: { data: ReadyOffersPanelData }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [link, setLink] = useState(sheetUrl(data.sheetId));
  const [busy, setBusy] = useState<"save" | "check" | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [check, setCheck] = useState<Extract<SheetCheck, { ok: true }> | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);

  async function save() {
    setBusy("save");
    setNote(null);
    const res = await setReadyOffersSheet(link).catch(() => ({ ok: false as const, error: "err.db" }));
    setBusy(null);
    setNote(res.ok ? { ok: true, text: t("dev.ro.saved") } : { ok: false, text: t(res.error as TranslationKey) });
    if (res.ok) {
      setCheck(null);
      router.refresh();
    }
  }

  async function runCheck() {
    setBusy("check");
    setNote(null);
    const res = await checkReadyOffersSheet().catch(() => ({ ok: false as const, error: "err.db" }));
    setBusy(null);
    if (res.ok) setCheck(res);
    else setNote({ ok: false, text: t(res.error as TranslationKey) });
  }

  const source = { settings: "dev.ro.source.settings", env: "dev.ro.source.env", default: "dev.ro.source.default" }[data.source] as TranslationKey;

  return (
    <section className="rounded-[14px] border border-[#cfe0d9] bg-white p-4">
      <h2 className="text-[14px] font-extrabold text-[#185045]">{t("dev.ro.title")}</h2>
      <p className="mt-1 text-[12px] font-semibold text-tv-text-faint">{t("dev.ro.hint")}</p>

      <label className="mt-3 grid gap-1">
        <span className="text-[11.5px] font-extrabold text-[#557d78]">
          {t("dev.ro.link")} <span className="font-semibold text-tv-text-faint">— {t(source)}</span>
        </span>
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          dir="ltr"
          className="h-10 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[12.5px] outline-none focus:border-[#2aa87a]"
        />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={busy !== null || link.trim() === sheetUrl(data.sheetId)} className={button}>
          {t("save")}
        </button>
        <button type="button" onClick={runCheck} disabled={busy !== null} className={button}>
          {t("dev.ro.check")}
        </button>
        <button type="button" onClick={() => setSyncOpen(true)} disabled={busy !== null} className={`${button} border-[#185045] bg-[#185045] text-white hover:bg-[#0f4439]`}>
          {t("dev.ro.sync")}
        </button>
        <a href={sheetUrl(data.sheetId)} target="_blank" rel="noopener noreferrer" className="text-[12px] font-bold text-[#185045] hover:underline">
          {t("ro.openSheet")}
        </a>
      </div>

      {note ? (
        <p role={note.ok ? "status" : "alert"} className={`mt-2 text-[12px] font-bold ${note.ok ? "text-[#0f7a52]" : "text-[#c22850]"}`}>
          {note.text}
        </p>
      ) : null}

      {check ? (
        <div className="mt-3 grid gap-1 rounded-[10px] border border-[#e2ebe7] bg-[#f8fbfa] p-3 text-[12px] font-bold text-[#41615b]">
          <p className={check.tabs.length ? "text-[#0f7a52]" : "text-[#c22850]"}>{check.tabs.length ? t("dev.ro.public") : t("dev.ro.notPublic")}</p>
          {check.tabs.length ? <p>{t("dev.ro.tabs", { tabs: check.tabs.join("، ") })}</p> : null}
          {(["summary", "detail"] as const).map((k) =>
            check.tabs.length && !check.found[k] ? (
              <p key={k} className="text-[#c22850]">
                {t("dev.ro.missingTab", { tab: TABS[k] })}
              </p>
            ) : null,
          )}
          {check.rows.summary != null ? (
            <p>
              {t("dev.ro.rows", {
                s: String(check.rows.summary),
                d: String(check.rows.detail ?? "—"),
                offers: String(check.offers),
                problems: String(check.problems),
              })}
            </p>
          ) : null}
          {check.errors.map((e, i) => (
            <p key={i} className="text-[#a3203f]">
              {e.tab}: {e.reason}
            </p>
          ))}
        </div>
      ) : null}

      <p className="mt-3 border-t border-dashed border-[#dce7e2] pt-3 text-[12px] font-bold text-[#557d78]">
        {data.lastSync
          ? t("dev.ro.lastSync", {
              when: whenText(data.lastSync.at, true),
              who: data.lastSync.by ?? "—",
              added: String(data.lastSync.inserted),
              updated: String(data.lastSync.updated),
              off: String(data.lastSync.deleted),
            })
          : t("dev.ro.never")}
      </p>
      <p className={`mt-1 text-[12px] font-extrabold ${data.problems ? "text-[#c22850]" : "text-[#557d78]"}`}>
        {t("dev.ro.counts", { problems: String(data.problems), unpublished: String(data.unpublished) })}
      </p>

      <SyncDialog
        open={syncOpen}
        onOpenChange={(v) => {
          setSyncOpen(v);
          if (!v) router.refresh();
        }}
        sheetId={data.sheetId}
      />
    </section>
  );
}
