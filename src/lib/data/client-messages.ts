import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { clientWhatsappAllowed, messageClient } from "./client-whatsapp";
import { arabicDay, CLIENT_MESSAGE_LABEL, fillTemplate, followerOf, waParams, type ClientMessageKey } from "@/lib/operations/client-messages";
import { conversationForPhone, getTeletelConfig, teletelGet } from "@/lib/providers/teletel";
import { notifyEmployee } from "@/lib/notifications/notify";
import { escapeHtml, staffSend } from "@/lib/telegram/staff-bot";

/**
 * Send the client the stage's message (operations order 11, suggestion 5):
 * only a template a manager switched on, only once per case and stage
 * (operation_alerts), only into the client's existing WhatsApp thread on
 * Teletel, and never to a partner's client — that client is the partner's to
 * talk to (the partner hears through notifyPartnerCase). Best-effort.
 */
/**
 * What the system just sent a client on its own, told at once to the colleague who follows that client (the owner,
 * 2026-10-29): the bell (notifyEmployee) and «تنبيهاتي», with what was sent and the conversation — so they follow up.
 * Nothing more reaches the client. Best-effort: never holds up or undoes the send.
 */
async function tellFollower(
  supabase: SupabaseClient,
  i: { operationId: string; key: ClientMessageKey; text: string; name: string; mobile: string; opsId: string | null; sellerId: string | null },
): Promise<void> {
  const conversationId = await conversationForPhone(i.mobile);
  const conv = conversationId ? await teletelGet<{ meta?: { assignee?: { id?: number } | null } }>(`/conversations/${conversationId}`) : null;
  const agentId = conv?.meta?.assignee?.id ?? null;
  const { data: holder } = agentId ? await supabase.from("employees").select("id").eq("teletel_agent_id", agentId).eq("status", "Active").maybeSingle() : { data: null };
  const employeeId = followerOf({ holderEmployeeId: (holder as { id: string } | null)?.id ?? null, opsEmployeeId: i.opsId, sellerId: i.sellerId });
  if (!employeeId) return;
  const label = CLIENT_MESSAGE_LABEL[i.key];
  const who = i.name.trim() || "العميل";
  await notifyEmployee({
    employeeId,
    kind: "client_msg",
    title: `📨 أُرسلت لـ${who}: ${label} — تابِعه`,
    body: i.text.slice(0, 600),
    href: `/operations/${i.operationId}`,
    source: "operations",
    dedupeKey: `cmsg:${i.operationId}:${i.key}`,
  });
  const { data: emp } = await supabase.from("employees").select("telegram_chat_id").eq("id", employeeId).maybeSingle();
  const chat = Number((emp as { telegram_chat_id: number | string | null } | null)?.telegram_chat_id);
  if (!chat) return;
  const config = getTeletelConfig();
  const link = conversationId && config ? `${config.baseUrl}/app/accounts/${config.accountId}/conversations/${conversationId}` : null;
  await staffSend(
    chat,
    [`📨 أُرسلت لـ<b>${escapeHtml(who)}</b>: <b>${escapeHtml(label)}</b> — تابِعه.`, `«${escapeHtml(i.text.trim().slice(0, 300))}»`].join("\n"),
    link ? [[{ text: "افتح المحادثة", url: link }]] : undefined,
    {},
    `cmsg:${i.operationId}`,
  );
}

export async function sendClientMessage(operationId: string, key: ClientMessageKey): Promise<boolean> {
  try {
    const supabase = createSupabaseServiceClient() as unknown as SupabaseClient;
    const { data: tpl } = await supabase.from("client_message_templates").select("body, enabled").eq("key", key).maybeSingle();
    const template = tpl as { body: string; enabled: boolean } | null;
    if (!template?.enabled) return false;

    const { data } = await supabase
      .from("operations")
      .select("id, client_token, client_token_revoked_at, travel_start, assignee_id, offers(serial, destination, employee_id, partner_company_id, customers(arabic_name, mobile))")
      .eq("id", operationId)
      .maybeSingle();
    const op = data as unknown as {
      id: string;
      client_token: string | null;
      client_token_revoked_at: string | null;
      travel_start: string | null;
      assignee_id: string | null;
      offers: { serial: string; destination: string | null; employee_id: string | null; partner_company_id: string | null; customers: unknown } | null;
    } | null;
    const offer = Array.isArray(op?.offers) ? op?.offers[0] : op?.offers;
    if (!op || !offer || offer.partner_company_id) return false;
    const c = offer.customers as { arabic_name: string | null; mobile: string | null } | { arabic_name: string | null; mobile: string | null }[] | null;
    const customer = Array.isArray(c) ? c[0] : c;
    if (!customer?.mobile) return false;
    // the trial gate (client-whatsapp.ts) BEFORE the once-per-stage mark — a file
    // not yet in the trial must still get its message when it is let in
    if (await clientWhatsappAllowed({ employee_id: offer.employee_id, partner_company_id: offer.partner_company_id, customer })) return false;

    // once per stage: the unique key refuses the second
    const { error: dup } = await supabase.from("operation_alerts").insert({ operation_id: operationId, kind: "client_msg", ref: key });
    if (dup) return false;

    // the link the message points at — minted if the agent never opened it (a stopped link stays stopped)
    let token = op.client_token && !op.client_token_revoked_at ? op.client_token : null;
    if (!token && !op.client_token_revoked_at) {
      token = randomBytes(24).toString("base64url");
      await supabase.from("operations").update({ client_token: token }).eq("id", operationId);
    }
    const base = (process.env["NEXT_PUBLIC_SITE_URL"] ?? "https://pkg.traveliun.com").replace(/\/$/, "");
    const fields = {
      name: customer.arabic_name ?? "",
      destination: offer.destination ?? "",
      serial: offer.serial,
      link: token ? `${base}/trip/${token}` : "",
      rate_link: token ? `${base}/trip/${token}/rate` : "",
      date: arabicDay(op.travel_start),
    };
    // a thread is opened if Teletel has never seen them; outside WhatsApp's 24
    // hours it goes as its approved template, or waits as a team note
    const text = fillTemplate(template.body, fields);
    const sent = await messageClient({ employee_id: offer.employee_id, partner_company_id: offer.partner_company_id, customer }, text, {
      labels: [`مرحلة-${key}`],
      template: { key, params: waParams(key, fields) },
    });
    const ok = sent === "sent" || sent === "template";
    if (ok) await tellFollower(supabase, { operationId, key, text, name: customer.arabic_name ?? "", mobile: customer.mobile, opsId: op.assignee_id, sellerId: offer.employee_id }).catch(() => undefined);
    return ok;
  } catch {
    return false;
  }
}
