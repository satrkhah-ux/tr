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
import { programmeMessage, tidyWhatsapp, WA_TEMPLATES, waParams, waPreview, type WaTemplateKey } from "@/lib/operations/client-messages";
import { clientOfferPdf } from "@/lib/offer-doc/client-pdf";

/**
 * The client hears about their file on WhatsApp, through Teletel (the owner,
 * 2026-10-15): the programme once it is issued — prepared, reviewed and sent by
 * the employee's button, never on issue itself (the owner, 2026-10-17) —
 * «تم تحديث ملفك» for a newer version, and the operations stages
 * (client-messages.ts).
 *
 * Who it applies to — app_settings `client_whatsapp`:
 *   "admins" (the default, the trial): only files a MANAGER issued
 *            (dashboard.admin) — whoever or whatever triggers the message,
 *            the nightly job included, so the rule needs no signed-in actor;
 *   "all":   every file;  "off": none;
 *   "test":  only a client whose number is app_settings `client_whatsapp_test_phone`
 *            — the owner's test phone, until the packages are reset and it goes live
 *            (2026-10-17). Every other client hears nothing.
 * Never a partner's file: that client is the partner's to talk to.
 *
 * WhatsApp lets a business write freely only within 24 hours of the client's
 * last message; outside that, only a Meta-approved template. Each message has
 * one (WA_TEMPLATES, client-messages.ts); while its template is not approved
 * yet, the message is left on the thread as a note for the agent — said on
 * screen, never claimed as sent.
 */

/** «template»: delivered as the approved template, outside the 24 hours — its fixed text, not the one written. */
export type ClientSendResult = "sent" | "template" | "window" | "no_phone" | "unreachable" | "partner" | "off" | "not_allowed";

export type OfferClient = {
  employee_id: string | null;
  partner_company_id: string | null;
  customer: { arabic_name: string | null; mobile: string | null } | null;
};

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;

async function mode(service: SupabaseClient): Promise<"admins" | "all" | "off" | "test"> {
  const { data } = await service.from("app_settings").select("value").eq("key", "client_whatsapp").maybeSingle();
  const v = (data as { value?: string } | null)?.value;
  return v === "all" || v === "off" || v === "test" ? v : "admins";
}

/** The same Saudi mobile however it was typed: its last nine digits. */
const lastNine = (phone: string | null | undefined) => (phone ?? "").replace(/\D/g, "").slice(-9);

/** Whether this file's client may be written to now (the gate above). */
export async function clientWhatsappAllowed(
  offer: Pick<OfferClient, "employee_id" | "partner_company_id"> & { customer?: OfferClient["customer"] },
): Promise<ClientSendResult | null> {
  if (offer.partner_company_id) return "partner";
  const service = db();
  const m = await mode(service);
  if (m === "off") return "off";
  if (m === "all") return null;
  if (m === "test") {
    const { data } = await service.from("app_settings").select("value").eq("key", "client_whatsapp_test_phone").maybeSingle();
    const test = lastNine((data as { value?: string } | null)?.value);
    return test.length === 9 && lastNine(offer.customer?.mobile) === test ? null : "not_allowed";
  }
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
export type WaTemplateSend = {
  key: WaTemplateKey;
  params: string[];
  /** the programme's PDF: its public URL (Meta fetches it) and the serial it is rendered from first. */
  document?: { url: string; name: string; serial: string };
};


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
        const template = {
          name: def.name,
          params: extra.template.params,
          preview: waPreview(def, extra.template.params),
          document: def.document ? extra.template.document : undefined,
        };
        if (template.document) {
          // Meta fetches the document itself and will not wait the ~5 s Chromium takes:
          // render it into the cache first, then send. After the response, so issuing
          // never waits; a failure is left on the thread for the agent, never hidden.
          const { conversationId } = thread;
          const { serial } = template.document;
          try {
            after(async () => {
              await clientOfferPdf(serial).catch(() => null);
              if ((await sendTeletelTemplate(conversationId, template)) === null) {
                await addTeletelNote(conversationId, `تعذّر إرسال قالب «${def.name}» للعميل. أرسل له البرنامج يدوياً:\n\n${body}`);
              }
            });
            return "template";
          } catch {
            // outside a request (a script): send it now, the cache warmed by hand
          }
        }
        const sent = await sendTeletelTemplate(thread.conversationId, template);
        if (sent !== null) return "template";
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
          const bytes = await clientOfferPdf(serial).catch(() => null);
          const pdfId = bytes ? await sendTeletelAttachment(conversationId, "📎 برنامج رحلتك", { name, type: "application/pdf", bytes }).catch(() => null) : null;
          // the text says «في الملف المرفق» and carries no link (2026-10-22): a PDF that did not go is the agent's to send
          if (pdfId === null) await addTeletelNote(conversationId, pdfMissedNote(serial)).catch(() => false);
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

/** For the agent, on the thread, when the programme's PDF did not follow its text — the client was told it is attached. */
export function pdfMissedNote(serial: string): string {
  const base = (process.env["NEXT_PUBLIC_SITE_URL"] ?? "https://pkg.traveliun.com").replace(/\/$/, "");
  return `تعذّر إرسال ملف PDF للعميل (العرض ${serial}) — أرسله له يدوياً، أو أرسل له رابط البرنامج: ${base}/client-offer/${serial}`;
}

/** An issued programme's message to its client, as the employee reviews it before sending. */
export type OfferMessage = {
  text: string;
  client: OfferClient;
  /** the client's link and its PDF — shown for review beside the text. */
  link: string;
  pdf: string;
  /** the team note and labels that travel with the send. */
  note: string;
  labels: string[];
  /** none for a first send to a client who already confirmed: «traveliun_program_ready» promises the link he has */
  template?: WaTemplateSend;
  pdfName: string;
};

/**
 * The programme's message — «تم إعداد برنامج رحلتك» the first time, «تم تحديث
 * ملفك» when the client already had a version. It is only PREPARED here: the
 * owner (2026-10-17) wants every message reviewed and sent by a person, never
 * on issue (offer-send.ts).
 */
export async function offerMessage(serial: string, updated: boolean): Promise<OfferMessage | null> {
  try {
    const { data } = await db()
      .from("offers")
      .select("serial, status, destination, duration, total, currency, employee_id, partner_company_id, customers(arabic_name, mobile), employees(arabic_name)")
      .eq("serial", serial)
      .maybeSingle();
    const row = data as unknown as {
      serial: string;
      status: string | null;
      destination: string | null;
      duration: string | null;
      total: number | null;
      currency: string | null;
      employee_id: string | null;
      partner_company_id: string | null;
      customers: OfferClient["customer"] | OfferClient["customer"][];
      employees: { arabic_name: string | null } | { arabic_name: string | null }[] | null;
    } | null;
    if (!row) return null;
    const customer = Array.isArray(row.customers) ? (row.customers[0] ?? null) : row.customers;
    const issuer = Array.isArray(row.employees) ? row.employees[0] : row.employees;
    const base = (process.env["NEXT_PUBLIC_SITE_URL"] ?? "https://pkg.traveliun.com").replace(/\/$/, "");
    const where = [row.destination, row.duration ? `(${row.duration})` : ""].filter(Boolean).join(" ");
    const link = `${base}/client-offer/${row.serial}`;
    const key = updated ? "programme_updated" : "programme";
    // short, and no link: the PDF follows, the bookings' link comes once the client confirms (client-messages.ts)
    const text = programmeMessage({
      hello: greeting(customer?.arabic_name),
      destination: row.destination,
      duration: row.duration,
      serial: row.serial,
      updated,
      confirmed: row.status === "confirmed",
    });
    const note = [
      `${updated ? "أُعيد إصدار" : "أُصدر"} العرض ${row.serial}${where ? ` — ${where}` : ""}`,
      row.total != null ? `الإجمالي: ${Number(row.total).toLocaleString("en-US")} ${row.currency ?? ""}`.trim() : null,
      issuer?.arabic_name ? `أصدره: ${issuer.arabic_name}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    const pdfName = `برنامج-رحلتك-${row.serial}.pdf`;
    return {
      text,
      client: { employee_id: row.employee_id, partner_company_id: row.partner_company_id, customer },
      link,
      pdf: `${link}/pdf`,
      note,
      labels: [updated ? "عرض-محدث" : "عرض-مرسل"],
      pdfName,
      // after the 24 hours: the approved template — the same words, no link — the PDF riding as its document;
      // none for a confirmed client's first send (the text waits as a note for the agent)
      template: row.status === "confirmed" && !updated ? undefined : {
        key,
        params: waParams(key, { name: customer?.arabic_name ?? "", destination: where, serial: row.serial, link, rate_link: "" }),
        document: { url: `${link}/pdf`, name: pdfName, serial: row.serial },
      },
    };
  } catch {
    return null;
  }
}

/**
 * Send the programme to its client — only from the employee's «أرسل إلى العميل
 * عبر واتساب» (offer-send.ts), with the text as they reviewed it (`body`).
 * The PDF follows the text inside WhatsApp's 24 hours; after them it rides on
 * the approved template.
 */
export async function sendOfferToClient(serial: string, updated: boolean, body?: string): Promise<ClientSendResult> {
  const message = await offerMessage(serial, updated);
  if (!message) return "unreachable";
  return messageClient(message.client, body?.trim() || message.text, {
    note: message.note,
    labels: message.labels,
    pdf: { serial, name: message.pdfName },
    template: message.template,
  });
}
