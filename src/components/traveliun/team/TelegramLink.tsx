"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, Send } from "lucide-react";
import type { TranslationKey } from "@/lib/i18n";
import { setMemberTelegram, setMemberTeletelAgent, type TeamMember } from "@/lib/data/team";
import { sendMemberTestMessage, staffBotLink, teletelAgentsForTeam } from "@/lib/data/staff-bot-admin";
import type { TeletelAgent } from "@/lib/providers/teletel";
import { useTraveliunUI } from "../TraveliunUIProvider";

/**
 * «تنبيهاتي» on one colleague's row (employees.manage): their Telegram ID,
 * editable and audited, a test message, and their Teletel agent. The agent
 * decides whose conversations the bot tells them about. Teletel's agent list
 * is read when the panel opens, never with the page.
 */

const field = "h-9 rounded-[9px] border border-[#dbe6e1] bg-white px-2.5 text-[12.5px] text-[#185045] outline-none focus:border-[#2aa87a] disabled:opacity-60";
const button =
  "inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[11.5px] font-bold text-[#185045] hover:bg-[#f4f8f6] disabled:opacity-60";

export function TelegramLink({ member }: { member: TeamMember }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [chatId, setChatId] = useState(member.telegram_chat_id ?? "");
  const [agents, setAgents] = useState<TeletelAgent[] | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState<"tg" | "test" | "agent" | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([teletelAgentsForTeam(), staffBotLink()]).then(([list, url]) => {
      if (!live) return;
      setAgents(list);
      setLink(url);
    });
    return () => {
      live = false;
    };
  }, []);

  async function run(kind: "tg" | "test" | "agent", act: () => Promise<{ ok: true } | { ok: false; error: string }>, done: TranslationKey) {
    setBusy(kind);
    setNote(null);
    const res = await act().catch(() => ({ ok: false as const, error: "err.db" }));
    setBusy(null);
    setNote(res.ok ? { ok: true, text: t(done) } : { ok: false, text: t(res.error as TranslationKey) });
    if (res.ok && kind !== "test") router.refresh();
  }

  const agent = agents?.find((a) => a.id === member.teletel_agent_id);

  return (
    <div className="basis-full rounded-[10px] border border-[#e8efeb] bg-[#f8fbfa] p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-[11.5px] font-bold text-[#557d78]">
          {t("team.tg.id")}
          <input dir="ltr" inputMode="numeric" value={chatId} onChange={(e) => setChatId(e.target.value.replace(/\D/g, ""))} placeholder={t("team.tg.notLinkedShort")} className={`${field} w-40`} />
        </label>
        <button
          type="button"
          disabled={busy !== null || chatId === (member.telegram_chat_id ?? "")}
          onClick={() => void run("tg", () => setMemberTelegram(member.id, chatId), "team.tg.saved")}
          className={button}
        >
          {busy === "tg" ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
          {t("save")}
        </button>
        <button
          type="button"
          disabled={busy !== null || !member.telegram_linked}
          onClick={() => void run("test", () => sendMemberTestMessage(member.id), "team.tg.testSent")}
          className={button}
        >
          {busy === "test" ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          {t("team.tg.test")}
        </button>

        <label className="grid gap-1 text-[11.5px] font-bold text-[#557d78]">
          {t("team.tg.agent")}
          <select
            value={member.teletel_agent_id ?? ""}
            disabled={busy !== null || agents === null}
            onChange={(e) => void run("agent", () => setMemberTeletelAgent(member.id, e.target.value ? Number(e.target.value) : null), "team.tg.saved")}
            className={`${field} w-56`}
          >
            <option value="">{agents === null ? t("team.tg.loading") : t("team.tg.noAgent")}</option>
            {/* still shown when Teletel no longer lists them, so the field never silently reads «none» */}
            {member.teletel_agent_id && agents && !agent ? <option value={member.teletel_agent_id}>#{member.teletel_agent_id}</option> : null}
            {(agents ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.email ? ` — ${a.email}` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-2 text-[11.5px] font-semibold text-[#93aaa3]">
        {t("team.tg.hint")}{" "}
        {link ? (
          <a href={link} target="_blank" rel="noopener noreferrer" dir="ltr" className="font-bold text-[#185045] hover:underline">
            {link.replace("https://", "")}
          </a>
        ) : null}
      </p>
      {note ? (
        <p role={note.ok ? "status" : "alert"} className={`mt-1.5 text-[12px] font-bold ${note.ok ? "text-[#0f7a52]" : "text-[#c22850]"}`}>
          {note.text}
        </p>
      ) : null}
    </div>
  );
}
