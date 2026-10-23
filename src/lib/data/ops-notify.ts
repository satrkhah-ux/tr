import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { conversationForPhone, sendTeletelMessage } from "@/lib/providers/teletel";
import { miniAppUrl, sendMessage } from "@/lib/telegram/ops-bot";
import { grantedPermissions, type Permission } from "@/lib/roles/roles";
import { noticeRecipients, operationOfPath, type StaffMember } from "./notify-recipients";

/**
 * Tell the operations team a case has landed.
 *
 * The moment a salesperson records «تم تأكيد العميل», somebody else has to start
 * booking. Without a push, that handover is a shout across the office or a
 * WhatsApp message that gets lost, and the case sits until someone happens to
 * open the board.
 *
 * Sent over the Traveliun bot to the employees who have already linked their
 * Telegram (employees.telegram_chat_id, migration 0019) and whose role opens the
 * page the notice links to (recipientsFor). Best-effort by design:
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
 * The linked Telegram chats a notice opening `href` goes to: active employees
 * whose role opens that page — for one operation's page, who may work that
 * file (notify-recipients.ts). Linking Telegram is the opt-in; the role is the
 * filter, so nobody taps a button that lands them on the dashboard.
 */
async function recipientsFor(supabase: SupabaseClient, href: string, need?: Permission): Promise<number[]> {
  const { data } = await supabase
    .from("employees")
    .select("id, status, telegram_chat_id, roles(permission_keys)")
    .not("telegram_chat_id", "is", null)
    // a suspended employee keeps their chat id but must stop receiving
    // operations — including new applicants' names
    .eq("status", "Active");
  const rows = (data ?? []) as unknown as {
    id: string;
    status: string | null;
    telegram_chat_id: number | string;
    roles: { permission_keys: string[] | null } | { permission_keys: string[] | null }[] | null;
  }[];
  const staff: StaffMember[] = rows
    .map((e) => {
      const role = Array.isArray(e.roles) ? e.roles[0] : e.roles;
      return {
        id: e.id,
        chatId: Number(e.telegram_chat_id),
        permissions: grantedPermissions({ status: e.status, permission_keys: role?.permission_keys ?? null }),
      };
    })
    .filter((e) => Number.isFinite(e.chatId) && e.chatId !== 0);

  const operationId = operationOfPath(href);
  let issuerId: string | null = null;
  if (operationId) {
    // unreadable → no issuer: the own-files holders are left out, never let in
    const { data: op } = await supabase.from("operations").select("offers(employee_id)").eq("id", operationId).maybeSingle();
    const offers = (op as { offers: { employee_id: string | null } | { employee_id: string | null }[] | null } | null)?.offers;
    issuerId = (Array.isArray(offers) ? offers[0] : offers)?.employee_id ?? null;
  }
  return noticeRecipients(staff, href, issuerId)
    .filter((s) => !need || s.permissions.includes(need))
    .map((s) => s.chatId);
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
    const path = `/operations/${notice.operationId}`;
    const chatIds = await recipientsFor(supabase, path);
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
      `${base}${path}`,
    ].filter((l): l is string => l !== null);

    const text = lines.join("\n");
    const results = await Promise.all(chatIds.map((id) => send(id, text, path)));
    return results.filter(Boolean).length;
  } catch {
    return 0;
  }
}

/**
 * A hotel's data for the data team (hotel-data-request.ts) — to whoever opens
 * /hotels, the button on that very row. The agent who typed it is not stopped.
 */
export async function notifyHotelData(notice: { hotelId: string; name: string; city: string | null; why: string; serial: string | null; by: string | null }): Promise<number> {
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const path = `/hotels?id=${notice.hotelId}`;
    // the administration, not every data.write holder — sales and bookings hold that too
    const chatIds = await recipientsFor(supabase, path, "settings.manage");
    if (chatIds.length === 0) return 0;
    const base = readEnv("NEXT_PUBLIC_SITE_URL") ?? "https://pkg.traveliun.com";
    let by = notice.by;
    if (by && /^[0-9a-f-]{36}$/i.test(by)) {
      const { data } = await supabase.from("employees").select("arabic_name").eq("id", by).maybeSingle();
      by = (data as { arabic_name: string | null } | null)?.arabic_name ?? null;
    }
    const text = [
      "🏨 <b>بيانات فندق للإكمال</b>",
      "",
      `الفندق: <b>${escapeHtml(notice.name)}</b>${notice.city ? ` — ${escapeHtml(notice.city)}` : ""}`,
      `المطلوب: ${escapeHtml(notice.why)}`,
      notice.serial ? `الملف: <code>${escapeHtml(notice.serial)}</code>` : null,
      by ? `أدخله: ${escapeHtml(by)}` : null,
      "",
      "الموظف يكمل حجوزاته، والفاوتشر يصدر تلقائياً بعد إكمال البيانات:",
      `${base}${path}`,
    ]
      .filter((l): l is string => l !== null)
      .join("\n");
    const results = await Promise.all(chatIds.map((id) => sendMessage(id, text, [[{ text: "🏨 فتح الفندق", web_app: { url: miniAppUrl(path) } }]])));
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
    const chatIds = await recipientsFor(supabase, "/partner-companies");
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
 * The name only — to whoever /employees opens for (employees.manage); the
 * applicant's email and mobile stay on that screen.
 */
export async function notifyEmployeeRegistration(notice: { name: string }): Promise<number> {
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const chatIds = await recipientsFor(supabase, "/employees");
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
    // The file's issuer (offers.employee_id) — the salesperson who manages it and
    // whom operations.own lets open the link; whoever recorded the confirmation
    // only when the file has no issuer.
    const { data } = await supabase
      .from("operations")
      .select("employees:confirmed_by(mobile, telegram_chat_id), offers(employees:employee_id(mobile, telegram_chat_id))")
      .eq("id", notice.operationId)
      .maybeSingle();
    type Contact = { mobile: string | null; telegram_chat_id: number | string | null };
    const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
    const row = data as unknown as { employees: Contact | Contact[] | null; offers: { employees: Contact | Contact[] | null } | { employees: Contact | Contact[] | null }[] | null } | null;
    const emp = one(one(row?.offers)?.employees) ?? one(row?.employees);

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
 * A plain note to the operations team (the daily alerts), with a button opening
 * `path`: to whoever that page opens for — a case's notes to the operations
 * team and the case's own salesperson, never to a colleague's own-files holder.
 */
export async function notifyOps(text: string, path: string): Promise<number> {
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const chats = await recipientsFor(supabase, path);
    const results = await Promise.all(chats.map((chat) => send(chat, escapeHtml(text), path)));
    return results.filter(Boolean).length;
  } catch {
    return 0;
  }
}
