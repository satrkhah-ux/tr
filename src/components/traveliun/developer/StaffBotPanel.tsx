"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TranslationKey } from "@/lib/i18n";
import { checkStaffBot, registerStaffBotWebhook, saveStaffBotToken, type StaffBotCheck, type StaffBotPanelData } from "@/lib/data/staff-bot-admin";
import { useTraveliunUI } from "../TraveliunUIProvider";

/**
 * «بوت الموظفين» on /developer (the owner, 2026-10-22). This is the bot's
 * @username and token: replace the token here and nothing else changes. The new
 * token is checked with Telegram, encrypted, and the webhook is moved to it in
 * the same step. «فحص» reads getMe and the webhook, and «تسجيل الربط» points
 * the bot at this server again.
 */

const button =
  "inline-flex h-9 items-center rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[12px] font-extrabold text-[#185045] hover:bg-[#f4f8f6] disabled:opacity-60";

export function StaffBotPanel({ data }: { data: StaffBotPanelData }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<"save" | "check" | "hook" | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [check, setCheck] = useState<Extract<StaffBotCheck, { ok: true }> | null>(null);

  async function act(kind: "save" | "check" | "hook") {
    setBusy(kind);
    setNote(null);
    try {
      if (kind === "check") {
        const res = await checkStaffBot();
        if (res.ok) setCheck(res);
        else setNote({ ok: false, text: t(res.error as TranslationKey) });
      } else if (kind === "hook") {
        const res = await registerStaffBotWebhook();
        setNote(res.ok ? { ok: true, text: t("dev.sb.webhookDone") } : { ok: false, text: t(res.error as TranslationKey) });
      } else {
        const res = await saveStaffBotToken(token);
        setNote(res.ok ? { ok: true, text: t("dev.sb.saved", { username: res.username }) } : { ok: false, text: t(res.error as TranslationKey) });
        if (res.ok) {
          setToken("");
          setCheck(null);
          router.refresh();
        }
      }
    } catch {
      setNote({ ok: false, text: t("err.db") });
    }
    setBusy(null);
  }

  const source = { vault: "dev.sb.source.vault", env: "dev.sb.source.env" }[data.source ?? "env"] as TranslationKey;

  return (
    <section className="rounded-[14px] border border-[#cfe0d9] bg-white p-4">
      <h2 className="text-[14px] font-extrabold text-[#185045]">{t("dev.sb.title")}</h2>
      <p className="mt-1 text-[12px] font-semibold text-tv-text-faint">{t("dev.sb.hint")}</p>

      <dl className="mt-3 grid gap-1 text-[12px] font-bold text-[#41615b]">
        <div className="flex flex-wrap gap-2">
          <dt className="text-tv-text-faint">{t("dev.sb.username")}</dt>
          <dd dir="ltr">{data.username ? `@${data.username}` : "—"}</dd>
        </div>
        <div className="flex flex-wrap gap-2">
          <dt className="text-tv-text-faint">{t("dev.sb.token")}</dt>
          <dd className={data.source ? "" : "text-[#c22850]"}>{data.source ? t(source) : t("dev.sb.noToken")}</dd>
        </div>
        <div className="flex flex-wrap gap-2">
          <dt className="text-tv-text-faint">{t("dev.sb.webhookUrl")}</dt>
          <dd dir="ltr">{data.webhookUrl}</dd>
        </div>
      </dl>

      <label className="mt-3 grid gap-1">
        <span className="text-[11.5px] font-extrabold text-[#557d78]">{t("dev.sb.newToken")}</span>
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          type="password"
          autoComplete="off"
          dir="ltr"
          placeholder="123456789:AA…"
          className="h-10 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus focus:border-[#2aa87a]"
        />
      </label>
      {!data.vaultReady ? <p className="mt-1 text-[11.5px] font-bold text-[#c22850]">{t("dev.sb.noVault")}</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void act("save")} disabled={busy !== null || !token.trim() || !data.vaultReady} className={`${button} border-[#185045] bg-[#185045] text-white hover:bg-[#0f4439]`}>
          {t("dev.sb.save")}
        </button>
        <button type="button" onClick={() => void act("check")} disabled={busy !== null} className={button}>
          {t("dev.sb.check")}
        </button>
        <button type="button" onClick={() => void act("hook")} disabled={busy !== null} className={button}>
          {t("dev.sb.webhook")}
        </button>
      </div>

      {note ? (
        <p role={note.ok ? "status" : "alert"} className={`mt-2 text-[12px] font-bold ${note.ok ? "text-[#0f7a52]" : "text-[#c22850]"}`}>
          {note.text}
        </p>
      ) : null}

      {check ? (
        <div className="mt-3 grid gap-1 rounded-[10px] border border-[#e2ebe7] bg-[#f8fbfa] p-3 text-[12px] font-bold text-[#41615b]">
          <p className="text-[#0f7a52]" dir="ltr">@{check.username}</p>
          <p className={check.webhook.ours ? "text-[#0f7a52]" : "text-[#c22850]"}>
            {check.webhook.ours ? t("dev.sb.hookOurs") : check.webhook.set ? t("dev.sb.hookElsewhere") : t("dev.sb.hookNone")}
          </p>
          <p>{t("dev.sb.pending", { n: String(check.webhook.pending) })}</p>
          {check.webhook.lastError ? <p className="text-[#a3203f]">{t("dev.sb.lastError", { reason: check.webhook.lastError })}</p> : null}
        </div>
      ) : null}

      {data.updatedAt ? (
        <p className="mt-2 text-[11px] font-semibold text-tv-text-faint">
          {t("dev.sb.updated", { at: new Date(data.updatedAt).toLocaleString("ar-SA-u-nu-latn", { timeZone: "Asia/Riyadh" }), who: data.updatedBy ?? "—" })}
        </p>
      ) : null}
    </section>
  );
}
