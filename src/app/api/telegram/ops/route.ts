import { type NextRequest, NextResponse } from "next/server";
import { buildOpsDigest, digestText } from "@/lib/telegram/ops-digest";
import { answerCallback, employeeForChat, escapeHtml, miniAppUrl, opsBotToken, sendMessage } from "@/lib/telegram/ops-bot";

export const runtime = "nodejs";

/**
 * POST /api/telegram/ops — the «قسم العمليات» bot's webhook.
 *
 * Two commands and a button, deliberately. Everything an ops agent DOES —
 * entering a confirmation number, issuing a voucher, sending a supplier request —
 * happens on the real screen, opened inside Telegram through the Mini App button,
 * where the permission gates and the audit log already are. Re-implementing those
 * actions as chat commands would mean a second, weaker copy of every rule.
 *
 * The bot answers only accounts it can resolve to an ACTIVE employee holding
 * `operations.write`. A message is not an authorisation.
 */

type TgUpdate = {
  message?: { chat?: { id?: number }; from?: { id?: number; first_name?: string }; text?: string };
  callback_query?: { id: string; from?: { id?: number }; data?: string; message?: { chat?: { id?: number } } };
};

const OPEN_BOARD = () => [[{ text: "🗂️ فتح لوحة العمليات", web_app: { url: miniAppUrl("/operations") } }]];

export async function POST(req: NextRequest): Promise<NextResponse> {
  // A shared secret when one is configured: Telegram sends it back on every
  // update, and without this check anyone who learns the URL can forge one.
  const expected = process.env["TELEGRAM_OPS_WEBHOOK_SECRET"];
  if (expected && req.headers.get("x-telegram-bot-api-secret-token") !== expected) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  if (!opsBotToken()) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });

  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  // Answer Telegram immediately and do the work after: an update that takes two
  // seconds to serve is an update Telegram retries.
  handle(update).catch(() => {
    /* a failed reply must never turn into a retry storm */
  });
  return NextResponse.json({ ok: true });
}

async function handle(update: TgUpdate): Promise<void> {
  if (update.callback_query) {
    await answerCallback(update.callback_query.id);
    return;
  }

  const chatId = update.message?.chat?.id;
  const text = (update.message?.text ?? "").trim();
  if (!chatId) return;

  const employee = await employeeForChat(chatId);

  // Not linked yet: the ONE thing that can be done from a chat is opening the
  // Mini App, which verifies the account with Telegram's signed initData and
  // links it. Nothing is granted here.
  if (!employee) {
    await sendMessage(
      chatId,
      [
        "🗂️ <b>قسم العمليات</b>",
        "",
        "هذا الحساب غير مربوط بموظف بعد.",
        "افتح لوحة العمليات من الزر أدناه وسجّل الدخول مرة واحدة — يُربط حسابك تلقائياً بعدها.",
      ].join("\n"),
      OPEN_BOARD(),
    );
    return;
  }

  if (!employee.permissions.includes("operations.write")) {
    await sendMessage(
      chatId,
      `أهلاً ${escapeHtml(employee.name)} — حسابك مربوط، لكن قسمك لا يملك صلاحية العمليات.\nراجع الإدارة لنقلك إلى قسم العمليات.`,
    );
    return;
  }

  if (text.startsWith("/start") || text.startsWith("/help") || text.includes("مساعدة")) {
    await sendMessage(
      chatId,
      [
        `🗂️ <b>قسم العمليات</b> — أهلاً ${escapeHtml(employee.name)}`,
        "",
        "• الزر أدناه يفتح لوحة العمليات كاملة داخل تيليجرام: الحجوزات، أرقام التأكيد، الفوتشرات، رابط العميل.",
        "• اكتب <b>المهام</b> في أي وقت لتصلك خلاصة ما يحتاج إجراءً.",
        "",
        "<i>بيانات الجوازات لا تُرسل في المحادثة — تُفتح داخل الشاشة حيث يُسجَّل كل اطلاع.</i>",
      ].join("\n"),
      OPEN_BOARD(),
    );
    return;
  }

  if (text.includes("المهام") || text.startsWith("/tasks") || text.includes("إجراء")) {
    const digest = await buildOpsDigest();
    await sendMessage(chatId, digestText(digest, employee.name), OPEN_BOARD());
    return;
  }

  await sendMessage(chatId, "اكتب <b>المهام</b> للخلاصة، أو افتح اللوحة من الزر.", OPEN_BOARD());
}
