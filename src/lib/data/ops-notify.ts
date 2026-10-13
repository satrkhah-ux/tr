import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { conversationForPhone, sendTeletelMessage } from "@/lib/providers/teletel";
import { miniAppUrl, sendMessage } from "@/lib/telegram/ops-bot";

/**
 * Tell the operations team a case has landed.
 *
 * The moment a salesperson records «تم تأكيد العميل», somebody else has to start
 * booking. Without a push, that handover is a shout across the office or a
 * WhatsApp message that gets lost, and the case sits until someone happens to
 * open the board.
 *
 * Sent over the Traveliun bot to the employees who have already linked their
 * Telegram (employees.telegram_chat_id, migration 0019). Best-effort by design:
 * a notification that fails must never roll back the confirmation itself — the
 * operation exists either way and the board still shows it.
 */

function readEnv(name: string): string | undefined {
  // bracket access on purpose: these resolve at RUNTIME on the VPS, not at build
  return process.env[name];
}

/**
 * Sent by the OPERATIONS bot when one is configured, else the admin bot.
 *
 * The notice carries a button that opens the case itself inside Telegram, so the
 * distance between "a case landed" and "I am working on it" is one tap instead of
 * finding a laptop.
 */
async function send(chatId: number, text: string, path?: string): Promise<boolean> {
  return sendMessage(chatId, text, path ? [[{ text: "🗂️ فتح الملف", web_app: { url: miniAppUrl(path) } }]] : undefined);
}

/**
 * Employees who should hear about operations work.
 *
 * "Has the operations permission" is a role question, and roles live in a table
 * whose only marker for full access is english_name = 'All Permissions'. Rather
 * than re-implement that lookup, this takes everyone with a linked Telegram —
 * the linking itself is the opt-in, and an employee without ops work simply has
 * no reason to have linked. Narrow it to a role when someone complains.
 */
async function opsRecipients(supabase: SupabaseClient): Promise<number[]> {
  const { data } = await supabase
    .from("employees")
    .select("telegram_chat_id")
    .not("telegram_chat_id", "is", null)
    // a suspended employee keeps their chat id but must stop receiving
    // operations — including new applicants' names
    .eq("status", "Active");
  return ((data ?? []) as { telegram_chat_id: number | string }[])
    .map((e) => Number(e.telegram_chat_id))
    .filter((n) => Number.isFinite(n) && n !== 0);
}

export type OpsNotice = {
  serial: string;
  customer: string | null;
  destination: string | null;
  travelStart: string | null;
  operationId: string;
  confirmedBy: string | null;
};

/** Returns how many recipients actually received it. */
export async function notifyOperationConfirmed(notice: OpsNotice): Promise<number> {
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const chatIds = await opsRecipients(supabase);
    if (chatIds.length === 0) return 0;

    const base = readEnv("NEXT_PUBLIC_SITE_URL") ?? "https://pkg.traveliun.com";
    const lines = [
      "🟢 <b>عملية جديدة — العميل أكّد</b>",
      "",
      `العميل: <b>${escapeHtml(notice.customer ?? "—")}</b>`,
      `العرض: <code>${escapeHtml(notice.serial)}</code>`,
      notice.destination ? `الوجهة: ${escapeHtml(notice.destination)}` : null,
      notice.travelStart ? `السفر: <code>${escapeHtml(notice.travelStart)}</code>` : null,
      notice.confirmedBy ? `سجّله: ${escapeHtml(notice.confirmedBy)}` : null,
      "",
      "ابدأ الحجوزات وإصدار الفواتشر:",
      `${base}/operations/${notice.operationId}`,
    ].filter((l): l is string => l !== null);

    const text = lines.join("\n");
    const results = await Promise.all(chatIds.map((id) => send(id, text, `/operations/${notice.operationId}`)));
    return results.filter(Boolean).length;
  } catch {
    return 0;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * A company asked to work with us.
 *
 * Nobody watches a table for new rows. Without this the request sits as
 * `pending` until somebody happens to open the partners screen, and a company
 * that filled in a form and heard nothing for a week has already gone elsewhere.
 */
export async function notifyPartnerRegistration(notice: {
  name: string;
  email: string;
  phone: string;
}): Promise<number> {
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const chatIds = await opsRecipients(supabase);
    if (chatIds.length === 0) return 0;

    const text = [
      "🤝 <b>طلب شراكة جديد</b>",
      "",
      `الشركة: <b>${escapeHtml(notice.name)}</b>`,
      `البريد: <code>${escapeHtml(notice.email)}</code>`,
      `الجوال: <code>${escapeHtml(notice.phone)}</code>`,
      "",
      "راجع الطلب واعتمد الشروط من قسم الشركات المتعاونة.",
    ].join("\n");

    const results = await Promise.all(chatIds.map((id) => send(id, text, "/partner-companies")));
    return results.filter(Boolean).length;
  } catch {
    return 0;
  }
}

/**
 * Someone asked to join the staff.
 *
 * Same reason as the partner notice: the request is invisible until someone
 * opens the Employees screen. Bounded by the form's own caps (3 per origin a
 * day, 20 open at once), so a flood cannot turn this into a flood of messages.
 *
 * The name only. This goes to every linked colleague, not just the people who
 * decide; the applicant's email and mobile stay behind `employees.manage`.
 */
export async function notifyEmployeeRegistration(notice: { name: string }): Promise<number> {
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const chatIds = await opsRecipients(supabase);
    if (chatIds.length === 0) return 0;

    const text = [
      "🧑‍💼 <b>طلب تسجيل موظف جديد</b>",
      "",
      `الاسم: <b>${escapeHtml(notice.name)}</b>`,
      "",
      "تأكد من هويته ثم اعتمده واختر قسمه من صفحة الموظفين.",
    ].join("\n");

    const results = await Promise.all(chatIds.map((id) => send(id, text, "/employees")));
    return results.filter(Boolean).length;
  } catch {
    return 0;
  }
}

export type BookingChangeNotice = {
  operationId: string;
  serial: string;
  customer: string | null;
  /** what changed, already in Arabic. */
  what: string;
  bookingTitle: string;
  by: string | null;
};

/**
 * Tell the SALESPERSON when operations changes something on their case.
 *
 * They are the one the client phones. Finding out from the client that the hotel
 * moved is the failure this prevents — and it is a different audience from the
 * ops notice, which goes to whoever is doing the booking.
 *
 * Two channels, because they answer different questions: WhatsApp through
 * Teletel reaches them where they already talk to clients, and the admin bot is
 * the fallback that works even when no WhatsApp thread exists.
 */
export async function notifyBookingChanged(notice: BookingChangeNotice): Promise<{ whatsapp: boolean; telegram: number }> {
  const base = readEnv("NEXT_PUBLIC_SITE_URL") ?? "https://pkg.traveliun.com";
  const plain = [
    "تحديث من قسم العمليات",
    "",
    `العميل: ${notice.customer ?? "—"}`,
    `العرض: ${notice.serial}`,
    `الحجز: ${notice.bookingTitle}`,
    `التغيير: ${notice.what}`,
    notice.by ? `نفّذه: ${notice.by}` : null,
    "",
    `${base}/operations/${notice.operationId}`,
  ]
    .filter((l): l is string => l !== null)
    .join("\n");

  let whatsapp = false;
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const { data } = await supabase
      .from("operations")
      .select("confirmed_by, employees:confirmed_by(mobile, telegram_chat_id, arabic_name)")
      .eq("id", notice.operationId)
      .maybeSingle();
    const row = data as unknown as {
      employees: { mobile: string | null; telegram_chat_id: number | string | null } | { mobile: string | null; telegram_chat_id: number | string | null }[] | null;
    } | null;
    const emp = Array.isArray(row?.employees) ? row?.employees[0] : row?.employees;

    if (emp?.mobile) {
      const conversationId = await conversationForPhone(emp.mobile);
      // No existing WhatsApp thread → do NOT invent one; Telegram carries it.
      if (conversationId) whatsapp = (await sendTeletelMessage(conversationId, plain)) !== null;
    }

    if (emp?.telegram_chat_id) {
      const ok = await send(Number(emp.telegram_chat_id), escapeHtml(plain));
      return { whatsapp, telegram: ok ? 1 : 0 };
    }
  } catch {
    /* notification is best-effort — never block the edit it describes */
  }
  return { whatsapp, telegram: 0 };
}

/**
 * Tell a PARTNER company that its client's case moved — a status, a document.
 *
 * Their client phones them, not us, so they hear it first. WhatsApp through
 * Teletel to the company's own number, and only into a thread that already
 * exists (as notifyBookingChanged): no thread, no message — the portal shows the
 * same state either way. Says nothing internal: no supplier, no cost, no note.
 * A file that is ours (no partner) sends nothing. Best-effort, never throws.
 */
export async function notifyPartnerCase(notice: { offerId: string; what: string }): Promise<boolean> {
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const { data } = await supabase
      .from("offers")
      .select("serial, customers(arabic_name), booking_partners(whatsapp, phone)")
      .eq("id", notice.offerId)
      .maybeSingle();
    const row = data as unknown as {
      serial: string;
      customers: { arabic_name: string | null } | { arabic_name: string | null }[] | null;
      booking_partners: { whatsapp: string | null; phone: string | null } | { whatsapp: string | null; phone: string | null }[] | null;
    } | null;
    const partner = Array.isArray(row?.booking_partners) ? row?.booking_partners[0] : row?.booking_partners;
    const number = (partner?.whatsapp || partner?.phone || "").trim();
    if (!row || !number) return false;
    const customer = Array.isArray(row.customers) ? row.customers[0] : row.customers;

    const base = readEnv("NEXT_PUBLIC_SITE_URL") ?? "https://pkg.traveliun.com";
    const text = [
      "تحديث على طلبكم",
      "",
      `العرض: ${row.serial}`,
      customer?.arabic_name ? `العميل: ${customer.arabic_name}` : null,
      `الحالة: ${notice.what}`,
      "",
      `${base}/b2b`,
    ]
      .filter((l): l is string => l !== null)
      .join("\n");

    const conversationId = await conversationForPhone(number);
    return conversationId ? (await sendTeletelMessage(conversationId, text)) !== null : false;
  } catch {
    return false;
  }
}

/**
 * A plain note to the operations team (the daily alerts): everyone with a
 * linked Telegram, with a button opening the case when there is one.
 */
export async function notifyOps(text: string, path?: string): Promise<number> {
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const chats = await opsRecipients(supabase);
    const results = await Promise.all(chats.map((chat) => send(chat, escapeHtml(text), path)));
    return results.filter(Boolean).length;
  } catch {
    return 0;
  }
}
