import "server-only";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { grantedPermissions } from "@/lib/roles/roles";
import {
  addTeletelLabels,
  addTeletelNote,
  clientThread,
  getTeletelConfig,
  sendTeletelAttachment,
  sendTeletelMessage,
  sendTeletelTemplate,
  whatsappTemplateStatus,
} from "@/lib/providers/teletel";
import { tidyWhatsapp, WA_TEMPLATES, waPreview, type WaTemplateKey } from "@/lib/operations/client-messages";
import { AR } from "@/components/offer-doc/labels";
import { resolveDocBrand } from "./doc-brand";
import { getPublishedClientOffer } from "./offers";
import { renderOfferDocumentHtml } from "@/lib/offer-doc/html";
import { offerDocumentToPdf } from "@/lib/offer-doc/pdf";

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
 * last message; outside that, only a Meta-approved template. Each message has
 * one (WA_TEMPLATES, client-messages.ts); while its template is not approved
 * yet, the message is left on the thread as a note for the agent — said on
 * screen, never claimed as sent.
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

/** The approved template a message travels as after the 24 hours, and its values. */
export type WaTemplateSend = { key: WaTemplateKey; params: string[]; document?: { url: string; name: string } };

/** The programme's PDF — the same published snapshot the client's link shows. */
async function programmePdf(serial: string): Promise<Uint8Array | null> {
  const published = await getPublishedClientOffer(serial);
  if (!published) return null;
  const { brand, showPrices } = await resolveDocBrand({ serial });
  const html = await renderOfferDocumentHtml({ variant: "client", offer: published.offer, brand, showPrices });
  const pdf = await offerDocumentToPdf(html, {
    brand: brand.nameAr,
    serial,
    contact: brand.vars ? [brand.phone, brand.website].filter(Boolean).join(" · ") : AR.contact,
  });
  return new Uint8Array(pdf);
}

/**
 * Write to the client of one offer: the gate, their thread (opened if Teletel
 * has never seen them), the message — as its approved template once WhatsApp's
 * 24 hours have passed, or as a note for the agent while that template is not
 * approved. Labels and a team note travel with it. Never throws.
 *
 * `pdf` (inside the 24 hours): the programme follows the text as a document,
 * after the response — Chromium takes seconds, and issuing must not wait.
 */
export async function messageClient(
  offer: OfferClient,
  text: string,
  extra: { note?: string; labels?: string[]; template?: WaTemplateSend; pdf?: { serial: string; name: string } } = {},
): Promise<ClientSendResult> {
  try {
    const blocked = await clientWhatsappAllowed(offer);
    if (blocked) return blocked;
    if (!offer.customer?.mobile?.trim()) return "no_phone";
    if (!getTeletelConfig()) return "unreachable";
    const thread = await clientThread(offer.customer.mobile, offer.customer.arabic_name ?? "");
    if (!thread) return "unreachable";
    if (extra.labels?.length) await addTeletelLabels(thread.conversationId, extra.labels);
    if (extra.note) await addTeletelNote(thread.conversationId, extra.note);
    const body = tidyWhatsapp(text);
    if (!thread.canReply) {
      const def = extra.template ? WA_TEMPLATES[extra.template.key] : null;
      const approved = def ? (await whatsappTemplateStatus())?.get(def.name) === "APPROVED" : false;
      if (def && extra.template && approved) {
        const sent = await sendTeletelTemplate(thread.conversationId, {
          name: def.name,
          params: extra.template.params,
          preview: waPreview(def, extra.template.params),
          document: def.document ? extra.template.document : undefined,
        });
        if (sent !== null) return "sent";
      }
      await addTeletelNote(
        thread.conversationId,
        `لم يُرسل للعميل تلقائياً: مضى أكثر من 24 ساعة على آخر رسالة منه، وواتساب لا يسمح حينها إلا بقالب معتمد${def ? ` («${def.name}» غير معتمد بعد)` : ""}. أرسله بعد أن يرد العميل:\n\n${body}`,
      );
      return "window";
    }
    const sent = (await sendTeletelMessage(thread.conversationId, body)) !== null;
    if (sent && extra.pdf) {
      const { serial, name } = extra.pdf;
      const conversationId = thread.conversationId;
      try {
        after(async () => {
          const bytes = await programmePdf(serial).catch(() => null);
          if (bytes) await sendTeletelAttachment(conversationId, "📎 برنامج رحلتك", { name, type: "application/pdf", bytes });
        });
      } catch {
        // outside a request (a script): the text went, the PDF waits for the link
      }
    }
    return sent ? "sent" : "unreachable";
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
    const link = `${base}/client-offer/${row.serial}`;
    const destination = row.destination?.trim() || "";
    const text = [
      `${greeting(customer?.arabic_name)} 👋`,
      "",
      updated
        ? `تم تحديث ملفك، وهذا برنامج رحلتك المحدَّث${destination ? ` إلى *${destination}*` : ""} ✈️`
        : `تم إعداد برنامج رحلتك${destination ? ` إلى *${destination}*` : ""} ✈️`,
      row.duration ? `🗓️ ${row.duration}` : "",
      "",
      "📄 تفاصيل البرنامج كاملة من الرابط، وتصلك نسخة PDF في الرسالة التالية:",
      link,
      "",
      "فريق ترافليون للسفر والسياحة",
    ]
      .filter((line, i, all) => line !== "" || all[i - 1] !== "")
      .join("\n");
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
      {
        note,
        labels: [updated ? "عرض-محدث" : "عرض-مرسل"],
        pdf: { serial: row.serial, name: `برنامج-رحلتك-${row.serial}.pdf` },
        // after the 24 hours: the approved template, the PDF riding as its document
        template: {
          key: "programme",
          params: [customer?.arabic_name?.trim() || "عميلنا العزيز", destination || "وجهتك", link],
          document: { url: `${link}/pdf`, name: `برنامج-رحلتك-${row.serial}.pdf` },
        },
      },
    );
  } catch {
    return "unreachable";
  }
}
