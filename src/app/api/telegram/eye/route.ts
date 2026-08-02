import { type NextRequest, NextResponse } from "next/server";
import { employeeForChat, miniAppUrl } from "@/lib/telegram/ops-bot";
import { escapeHtml, eyeAnswer, eyeBotToken, eyeSend, eyeVoice } from "@/lib/telegram/eye-bot";
import { deliverBriefing, prepareBriefing } from "@/lib/eye/deliver";
import { openNotes, setNoteStatus } from "@/lib/eye/report";
import { discuss, isVoiceConfigured, speak } from "@/lib/eye/voice";
import { logAudit } from "@/lib/data/audit";

export const runtime = "nodejs";
// Building the report touches a dozen tables and then renders speech.
export const maxDuration = 60;

/**
 * POST /api/telegram/eye — «عين الإدارة».
 *
 * Answers only an ACTIVE employee whose section holds `dashboard.admin`. That is
 * stricter than the other bots for a reason: this one reports how long each
 * colleague took to answer a client, and who opened a passport. It is a
 * management instrument, and the permission is what makes that true rather than
 * a matter of who happens to know the bot's name.
 */

type TgUpdate = {
  message?: { chat?: { id?: number }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat?: { id?: number } } };
};

const MENU = [
  [{ text: "🎙️ تقرير اليوم", callback_data: "report" }],
  [{ text: "📌 الملاحظات المفتوحة", callback_data: "notes" }],
  [{ text: "📊 فتح اللوحة", web_app: { url: miniAppUrl("/dashboard") } }],
];

export async function POST(req: NextRequest): Promise<NextResponse> {
  const expected = process.env["TELEGRAM_EYE_WEBHOOK_SECRET"];
  if (expected && req.headers.get("x-telegram-bot-api-secret-token") !== expected) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  if (!eyeBotToken()) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });

  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Telegram retries anything slower than a few seconds, and this work takes
  // half a minute. Acknowledge now, speak after.
  handle(update).catch(() => {
    /* a failed reply must not become a retry storm */
  });
  return NextResponse.json({ ok: true });
}

/**
 * Record that someone reached for something.
 *
 * The bot ran for days delivering reports and could not say which part anyone
 * used, or whether anyone opened it at all — a management instrument with no
 * measure of its own use. One line per interaction fixes that; `logAudit` never
 * throws and is deliberately not awaited into the reply path.
 */
function track(
  employee: { id: string; name: string },
  action: "eye.opened" | "eye.report_requested" | "eye.notes_viewed" | "eye.asked",
  meta: Record<string, unknown> = {},
): void {
  void logAudit({
    action,
    entity: "eye",
    entity_id: employee.id,
    meta,
    actor: { id: employee.id, label: employee.name },
  });
}

async function handle(update: TgUpdate): Promise<void> {
  const chatId = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
  if (!chatId) return;

  const employee = await employeeForChat(chatId);
  if (!employee) {
    await eyeSend(
      chatId,
      [
        "👁️ <b>عين الإدارة</b>",
        "",
        "هذا الحساب غير مربوط بموظف. افتح النظام من الزر وسجّل الدخول مرة واحدة، ويُربط تلقائياً.",
      ].join("\n"),
      [[{ text: "فتح النظام", web_app: { url: miniAppUrl("/dashboard") } }]],
    );
    return;
  }
  if (!employee.permissions.includes("dashboard.admin")) {
    await eyeSend(chatId, `أهلاً ${escapeHtml(employee.name)} — هذا التقرير للإدارة فقط.`);
    return;
  }

  // ---- buttons ----
  if (update.callback_query) {
    const data = update.callback_query.data ?? "";
    await eyeAnswer(update.callback_query.id, "تمام");

    if (data === "report") {
      track(employee, "eye.report_requested", { via: "button" });
      return void (await sendReport(chatId));
    }
    if (data === "notes") {
      track(employee, "eye.notes_viewed", { via: "button" });
      return void (await sendNotes(chatId));
    }

    if (data.startsWith("ack:") || data.startsWith("ignore:")) {
      const [verb, id] = data.split(":");
      const ok = await setNoteStatus(id, verb === "ack" ? "ack" : "ignored");
      if (ok) {
        await logAudit({
          action: "eye.note_acked",
          entity: "eye_notes",
          entity_id: id,
          meta: { verb },
          actor: { id: employee.id, label: employee.name },
        });
        await eyeSend(chatId, verb === "ack" ? "✅ سُجّلت كمعالَجة." : "⚪️ تم تجاهلها.");
      }
      return;
    }
    return;
  }

  const text = (update.message?.text ?? "").trim();

  if (text.startsWith("/start") || text.startsWith("/help")) {
    track(employee, "eye.opened", { command: text.split(/\s/)[0] });
    await eyeSend(
      chatId,
      [
        `👁️ <b>عين الإدارة</b> — أهلاً ${escapeHtml(employee.name)}`,
        "",
        "أراقب النظام وأجمع لك كل يوم: الحضور، تأخير الرد على العملاء، العمليات، المبيعات، والملاحظات.",
        "",
        "• <b>تقرير اليوم</b> — أرسله لك بالصوت وبالمكتوب.",
        "• <b>الملاحظات</b> — المفتوحة، وتقدر تعلّمها معالَجة أو تتجاهلها.",
        "• اكتب لي أي سؤال عن وضع اليوم وأجاوبك.",
        "",
        "<i>ما أرسل أرقام جوازات ولا بيانات هوية — أقول من اطّلع عليها فقط.</i>",
      ].join("\n"),
      MENU,
    );
    return;
  }

  if (text.startsWith("/report") || text.includes("التقرير") || text.includes("تقرير")) {
    track(employee, "eye.report_requested", { via: "text" });
    await sendReport(chatId);
    return;
  }

  if (text.startsWith("/notes") || text.includes("الملاحظات")) {
    track(employee, "eye.notes_viewed", { via: "text" });
    await sendNotes(chatId);
    return;
  }

  // ---- a question, answered ONLY from today's computed report ----
  if (text.length > 3) {
    // The question itself, because "what do they ask?" is the whole point of
    // measuring this — and it is the one signal a button count cannot give.
    track(employee, "eye.asked", { question: text.slice(0, 300) });
    await eyeSend(chatId, "<i>لحظة…</i>");
    const { report } = await prepareBriefingLite();
    const answer = await discuss(text, JSON.stringify(report));
    if (!answer) {
      await eyeSend(chatId, "ما قدرت أجاوب الحين. جرّب «تقرير اليوم».", MENU);
      return;
    }
    await eyeSend(chatId, escapeHtml(answer));
    if (isVoiceConfigured()) {
      const audio = await speak(answer);
      if (audio) await eyeVoice(chatId, audio);
    }
    return;
  }

  await eyeSend(chatId, "اختر من القائمة أو اسألني سؤالاً.", MENU);
}

/** The report without the audio — a question does not need a briefing spoken. */
async function prepareBriefingLite() {
  const { buildEyeReport } = await import("@/lib/eye/report");
  return { report: await buildEyeReport() };
}

async function sendReport(chatId: number): Promise<void> {
  await eyeSend(chatId, "<i>أجمع لك التقرير…</i>");
  const briefing = await prepareBriefing();
  await deliverBriefing([{ id: "on-demand", name: "", chatId }], briefing);
}

async function sendNotes(chatId: number): Promise<void> {
  const notes = await openNotes(10);
  if (notes.length === 0) {
    await eyeSend(chatId, "ما فيه ملاحظات مفتوحة. 👌", MENU);
    return;
  }
  await eyeSend(chatId, `📌 <b>${notes.length} ملاحظة مفتوحة</b>`);
  for (const note of notes) {
    const mark = note.severity === "critical" ? "🔴" : note.severity === "warn" ? "🟠" : "⚪️";
    const age = note.times_seen > 1 ? `\n<i>متكرّرة ${note.times_seen} مرات منذ ${note.first_seen_day}</i>` : "";
    await eyeSend(chatId, `${mark} ${escapeHtml(note.title)}${note.detail ? `\n${escapeHtml(note.detail)}` : ""}${age}`, [
      [
        { text: "✅ تمت المعالجة", callback_data: `ack:${note.id}` },
        { text: "⚪️ تجاهل", callback_data: `ignore:${note.id}` },
      ],
    ]);
  }
}
