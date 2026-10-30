"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TranslationKey } from "@/lib/i18n";
import type { MuradPanelData } from "@/lib/murad/run";
import { whenText } from "@/lib/developer/health";
import { setMuradAutoPhones } from "@/lib/data/app-settings";
import { useTraveliunUI } from "../TraveliunUIProvider";

import { buttonTone } from "@/components/ui/button-variants";
/**
 * «مُراد» on /developer: which model answers, today's calls against the cap,
 * the numbers he may answer himself, and what he did last. His two switches
 * live with the other services («خدمات النظام»); their state is echoed here.
 */

const MODE: Record<string, TranslationKey> = { auto: "murad.mode.auto", suggest: "murad.mode.suggest", skipped: "murad.mode.skipped" };
const chip = "rounded-full px-2 py-0.5 text-[10.5px] font-extrabold";
const onChip = "bg-tv-status-success-bg text-tv-status-success";
const offChip = "bg-tv-status-danger-bg text-tv-status-danger";
const warnChip = "bg-tv-status-warning-bg text-tv-status-warning";
const button =
  `${buttonTone({ variant: "secondary" })} inline-flex h-8 items-center rounded-[9px] border px-2.5 text-[11.5px] font-extrabold disabled:opacity-60 max-sm:min-h-10`;

export function MuradPanel({ data, flags }: { data: MuradPanelData; flags: { suggest: boolean; auto: boolean } }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [phones, setPhones] = useState(data.autoPhones);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<"saved" | "failed" | null>(null);

  async function save(next: string[]) {
    setSaving(true);
    setNote(null);
    let ok = false;
    try {
      ok = (await setMuradAutoPhones(next)).ok;
    } catch {
      ok = false;
    }
    setSaving(false);
    setNote(ok ? "saved" : "failed");
    if (ok) router.refresh();
  }

  const add = () => {
    const p = draft.trim();
    if (!p || phones.includes(p)) return;
    setPhones([...phones, p]);
    setDraft("");
  };

  const provider = data.provider ? `${data.provider.provider === "claude" ? "Claude" : "OpenAI"} · ${data.provider.model}` : t("murad.provider.none");

  return (
    <section className="tv-card rounded-[14px] border p-4">
      <h2 className="text-[14px] font-extrabold text-[#185045]">{t("murad.title")}</h2>
      <p className="mt-1 text-[12px] font-semibold text-tv-text-faint">{t("murad.hint")}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] font-bold text-[#557d78]">
        <span>
          {t("murad.provider")}: <bdi dir="ltr">{provider}</bdi>
        </span>
        <span className={`${chip} ${flags.suggest ? onChip : offChip}`}>
          {t("murad.f.suggest")}: {t(flags.suggest ? "dev.services.on" : "dev.services.off")}
        </span>
        <span className={`${chip} ${flags.auto ? onChip : offChip}`}>
          {t("murad.f.auto")}: {t(flags.auto ? "dev.services.on" : "dev.services.off")}
        </span>
      </div>

      {!data.ready ? (
        <p role="alert" className="mt-2 text-[12px] font-bold text-[#c22850]">
          {t("murad.notReady")}
        </p>
      ) : null}
      <p className="mt-2 text-[12.5px] font-extrabold text-[#0f3d38]">
        {t("murad.calls", { used: data.usedToday, cap: data.cap })}
        {data.usedToday >= data.cap ? <span className={`${chip} ${warnChip} ms-2`}>{t("murad.capped")}</span> : null}
      </p>

      <h3 className="mt-4 border-t border-dashed border-[#dce7e2] pt-3 text-[12.5px] font-extrabold text-[#557d78]">{t("murad.phones")}</h3>
      <p className="mt-0.5 text-[11.5px] font-semibold text-tv-text-faint">{t("murad.phones.hint")}</p>
      {data.testPhone ? (
        <p className="mt-1.5 text-[12px] font-semibold text-[#557d78]">
          {t("murad.phones.test")}{" "}
          <bdi dir="ltr">{data.testPhone}</bdi>
        </p>
      ) : null}
      <ul className="mt-1.5 grid gap-1">
        {phones.length === 0 ? <li className="text-[12px] font-semibold text-tv-text-faint">{t("murad.phones.empty")}</li> : null}
        {phones.map((p) => (
          <li key={p} className="flex items-center justify-between gap-2 text-[12.5px] font-bold text-[#0f3d38]">
            <bdi dir="ltr" className="font-mono">
              {p}
            </bdi>
            <button type="button" className={button} onClick={() => setPhones(phones.filter((x) => x !== p))}>
              {t("murad.phones.remove")}
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="tel"
          dir="ltr"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder={t("murad.phones.placeholder")}
          aria-label={t("murad.phones")}
          className="h-8 w-48 rounded-[9px] border border-[#dbe6e1] bg-white px-2.5 text-[12.5px] font-semibold text-[#185045] dark:border-[#294039] dark:bg-[#0f1f1b] dark:text-[#d6e5df]"
        />
        <button type="button" className={button} onClick={add} disabled={!draft.trim()}>
          {t("murad.phones.add")}
        </button>
        <button type="button" className={button} onClick={() => void save(phones)} disabled={saving}>
          {t("murad.phones.save")}
        </button>
        {note ? (
          <span role="status" className={`text-[11.5px] font-bold ${note === "saved" ? "text-[#0f7a52]" : "text-[#c22850]"}`}>
            {t(note === "saved" ? "murad.phones.saved" : "murad.phones.failed")}
          </span>
        ) : null}
      </div>

      <h3 className="mt-4 border-t border-dashed border-[#dce7e2] pt-3 text-[12.5px] font-extrabold text-[#557d78]">{t("murad.log")}</h3>
      {data.logs.length === 0 ? (
        <p className="mt-1 text-[12px] font-semibold text-tv-text-faint">{t("murad.log.empty")}</p>
      ) : (
        <ul className="mt-1.5 grid gap-1.5">
          {data.logs.map((l) => (
            <li key={l.id} className="rounded-[10px] bg-[#f7faf8] px-3 py-2 text-[12px] font-semibold text-[#557d78] dark:bg-[#0f1f1b]">
              <div className="flex flex-wrap items-center gap-2">
                <time dateTime={l.at} dir="ltr" className="text-[11px] font-bold text-tv-text-faint">
                  {whenText(l.at, true)}
                </time>
                <bdi dir="ltr" className="font-mono text-[#0f3d38]">
                  {l.phone}
                </bdi>
                <span className={`${chip} ${l.mode === "skipped" ? offChip : onChip}`}>{t(MODE[l.mode] ?? "murad.mode.skipped")}</span>
                {l.needsStaff ? <span className={`${chip} ${warnChip}`}>{t("murad.log.staff")}</span> : null}
                {l.staffReplied ? <span className={`${chip} ${onChip}`}>{t("murad.log.replied")}</span> : null}
              </div>
              {l.preview ? <p className="mt-0.5 break-words">{l.preview}</p> : null}
              {l.error ? (
                <p dir="ltr" className="mt-0.5 break-words text-[11px] text-[#c22850]">
                  {l.error}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
