import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { grantedPermissions } from "@/lib/roles/roles";
import { addTeletelLabels, addTeletelNote, clientThread, getTeletelConfig, sendTeletelMessage } from "@/lib/providers/teletel";

/**
 * The client hears about their file on WhatsApp, through Teletel (the owner,
 * 2026-10-15): the programme when it is issued, «تم تحديث ملفك» when it is
 * issued again, and the operations stages (client-messages.ts).
 *
 * Who it applies to — app_settings `client_whatsapp`:
 *   "admins" (the default, the trial): only files a MANAGER issued
 *            (dashboard.admin) — whoever or whatever triggers the message,
 *            the nightly job included, so the rule needs no signed-in actor;
 *   "all":   every file;  "off": none.
 * Never a partner's file: that client is the partner's to talk to.
 *
 * WhatsApp lets a business write freely only within 24 hours of the client's
 * last message; outside that, only an approved template. No suitable template
 * exists yet, so then the message is left on the thread as a note for the
 * agent — said on screen, never claimed as sent.
 */

export type ClientSendResult = "sent" | "window" | "no_phone" | "unreachable" | "partner" | "off" | "not_allowed";

export type OfferClient = {
  employee_id: string | null;
  partner_company_id: string | null;
  customer: { arabic_name: string | null; mobile: string | null } | null;
};

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;

async function mode(service: SupabaseClient): Promise<"admins" | "all" | "off"> {
  const { data } = await service.from("app_settings").select("value").eq("key", "client_whatsapp").maybeSingle();
  const v = (data as { value?: string } | null)?.value;
  return v === "all" || v === "off" ? v : "admins";
}

/** Whether this file's client may be written to now (the gate above). */
export async function clientWhatsappAllowed(offer: Pick<OfferClient, "employee_id" | "partner_company_id">): Promise<ClientSendResult | null> {
  if (offer.partner_company_id) return "partner";
  const service = db();
  const m = await mode(service);
  if (m === "off") return "off";
  if (m === "all") return null;
  if (!offer.employee_id) return "not_allowed";
  const { data } = await service.from("employees").select("status, roles(permission_keys)").eq("id", offer.employee_id).maybeSingle();
  const emp = data as unknown as { status: string | null; roles: { permission_keys: string[] } | { permission_keys: string[] }[] | null } | null;
  const role = Array.isArray(emp?.roles) ? emp.roles[0] : emp?.roles;
  const granted = grantedPermissions(emp ? { status: emp.status, permission_keys: role?.permission_keys ?? null } : null);
  return granted.includes("dashboard.admin") ? null : "not_allowed";
}

/** «عميلنا فلان،» — or «عميلنا العزيز،» when the file names nobody. */
export function greeting(name: string | null | undefined): string {
  return `عميلنا ${name?.trim() || "العزيز"}،`;
}

/**
 * Write to the client of one offer: the gate, their thread (opened if Teletel
 * has never seen them), the message — or the note when WhatsApp's 24 hours
 * have passed. Labels and a team note travel with it. Never throws.
 */
export async function messageClient(offer: OfferClient, text: string, extra: { note?: string; labels?: string[] } = {}): Promise<ClientSendResult> {
  try {
    const blocked = await clientWhatsappAllowed(offer);
    if (blocked) return blocked;
    if (!offer.customer?.mobile?.trim()) return "no_phone";
    if (!getTeletelConfig()) return "unreachable";
    const thread = await clientThread(offer.customer.mobile, offer.customer.arabic_name ?? "");
    if (!thread) return "unreachable";
    if (extra.labels?.length) await addTeletelLabels(thread.conversationId, extra.labels);
    if (extra.note) await addTeletelNote(thread.conversationId, extra.note);
    if (!thread.canReply) {
      await addTeletelNote(
        thread.conversationId,
        `لم يُرسل للعميل تلقائياً: مضى أكثر من 24 ساعة على آخر رسالة منه، وواتساب لا يسمح حينها إلا بقالب معتمد. أرسله بعد أن يرد العميل:\n\n${text}`,
      );
      return "window";
    }
    return (await sendTeletelMessage(thread.conversationId, text)) !== null ? "sent" : "unreachable";
  } catch {
    return "unreachable";
  }
}

/**
 * The programme to its client, right after it is issued — «تم إعداد برنامج
 * رحلتك» the first time, «تم تحديث ملفك» when the file is issued again.
 */
export async function sendOfferToClient(serial: string, updated: boolean): Promise<ClientSendResult> {
  try {
    const { data } = await db()
      .from("offers")
      .select("serial, destination, duration, total, currency, employee_id, partner_company_id, customers(arabic_name, mobile), employees(arabic_name)")
      .eq("serial", serial)
      .maybeSingle();
    const row = data as unknown as {
      serial: string;
      destination: string | null;
      duration: string | null;
      total: number | null;
      currency: string | null;
      employee_id: string | null;
      partner_company_id: string | null;
      customers: OfferClient["customer"] | OfferClient["customer"][];
      employees: { arabic_name: string | null } | { arabic_name: string | null }[] | null;
    } | null;
    if (!row) return "unreachable";
    const customer = Array.isArray(row.customers) ? (row.customers[0] ?? null) : row.customers;
    const issuer = Array.isArray(row.employees) ? row.employees[0] : row.employees;
    const base = (process.env["NEXT_PUBLIC_SITE_URL"] ?? "https://pkg.traveliun.com").replace(/\/$/, "");
    const where = [row.destination, row.duration ? `(${row.duration})` : ""].filter(Boolean).join(" ");
    const text = [
      greeting(customer?.arabic_name),
      updated ? `تم تحديث ملفك، وهذا برنامج رحلتك المحدَّث${where ? ` إلى ${where}` : ""}.` : `تم إعداد برنامج رحلتك${where ? ` إلى ${where}` : ""}.`,
      "تفاصيل البرنامج كاملة من الرابط:",
      `${base}/client-offer/${row.serial}`,
      "",
      "فريق ترافليون للسفر والسياحة",
    ].join("\n");
    const note = [
      `${updated ? "أُعيد إصدار" : "أُصدر"} العرض ${row.serial}${where ? ` — ${where}` : ""}`,
      row.total != null ? `الإجمالي: ${Number(row.total).toLocaleString("en-US")} ${row.currency ?? ""}`.trim() : null,
      issuer?.arabic_name ? `أصدره: ${issuer.arabic_name}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    return await messageClient(
      { employee_id: row.employee_id, partner_company_id: row.partner_company_id, customer },
      text,
      { note, labels: [updated ? "عرض-محدث" : "عرض-مرسل"] },
    );
  } catch {
    return "unreachable";
  }
}
