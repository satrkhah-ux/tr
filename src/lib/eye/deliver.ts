import "server-only";
import { logAudit } from "@/lib/data/audit";
import { eyeSend, eyeVoice, type EyeListener } from "@/lib/telegram/eye-bot";
import { buildEyeReport, persistNotes, storeReport } from "./report";
import { speechScript, textSummary } from "./script";
import { isVoiceConfigured, speak } from "./voice";
import type { EyeReport } from "./types";

/**
 * Build the day, say it, remember it.
 *
 * One path for both callers — the daily cron and the «التقرير» button — so the
 * briefing management receives on demand is byte-for-byte the one that arrives
 * in the evening. Two paths would drift, and the first time they disagreed
 * nobody would know which to believe.
 */

export type Briefing = { report: EyeReport; script: string; summary: string; audio: Buffer | null };

export async function prepareBriefing(): Promise<Briefing> {
  const report = await buildEyeReport();
  const script = speechScript(report);
  const summary = textSummary(report);
  // The audio is a nicety; the words are the report. A TTS outage must not cost
  // management its briefing.
  const audio = isVoiceConfigured() ? await speak(script) : null;
  return { report, script, summary, audio };
}

/** Send it, and record that it was sent and to whom. */
export async function deliverBriefing(listeners: EyeListener[], briefing: Briefing): Promise<number> {
  let delivered = 0;

  for (const listener of listeners) {
    // Voice first, then the written summary: the caption is capped at 1024
    // characters by Telegram and the notes list routinely runs past it.
    const spoke = briefing.audio ? await eyeVoice(listener.chatId, briefing.audio, "👁️ تقرير اليوم") : false;
    const wrote = await eyeSend(
      listener.chatId,
      briefing.summary + (briefing.audio ? "" : "\n\n<i>الصوت غير متاح الآن — هذا التقرير مكتوباً.</i>"),
    );
    if (spoke || wrote) delivered += 1;
  }

  await persistNotes(briefing.report.notes, briefing.report.day);
  await storeReport(briefing.report, briefing.script, delivered);
  await logAudit({
    action: "eye.report_sent",
    entity: "eye_reports",
    entity_id: briefing.report.day,
    meta: { delivered, notes: briefing.report.notes.length, spoken: Boolean(briefing.audio) },
  });

  return delivered;
}
