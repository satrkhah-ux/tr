import "server-only";
import { createElement } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import { countAgentConversations, listOpenConversations, listTeletelTeams, returnToTeam } from "@/lib/providers/teletel";
import { renderDocHtml } from "@/lib/offer-doc/html";
import { documentToPng } from "@/lib/offer-doc/pdf";
import { StaffLetterDocument, type PreviousLetter } from "@/components/offer-doc/StaffLetterDocument";
import { escapeHtml, staffCall, staffSend, staffSendPhoto, type StaffMember } from "./staff-bot";
import { loadTargets } from "./staff-numbers";
import { closedEnough, SECOND_LETTER_DAYS, toWithdraw, WITHDRAW_AFTER_DAYS, type LetterNumbers } from "./staff-letter";
import { managers } from "./staff-decisions";
import { isBotManager } from "./staff-manager";
import type { InlineButton } from "./ops-bot";

/**
 * «الخطاب الرسمي» (the owner, 2026-10-23) — sales only.
 *
 *   - Letter 1 goes out once EVERY sales employee with a Teletel account and a
 *     linked Telegram has pressed «ابدأ» in the bot, to all of them together.
 *     After that a newcomer (or one linked later) gets theirs as soon as they join.
 *   - Letter 2 follows ten days after each one's letter 1: the two side by side,
 *     and the notice that their conversations will be withdrawn when they did
 *     not close the finished ones (closedEnough).
 *   - Once a warned letter 2 has reached them, their open conversations where
 *     the client has been silent for three days (nobody waiting for us) go back
 *     to «قسم المبيعات» with no agent (toWithdraw, once: withdrawn_at).
 *   - «✍️ اعتمدت الخطاب» is the employee's electronic signature: signed_at, an
 *     audit row, and the managers' summary updated.
 *
 * Numbers are frozen in the row when the letter is issued, so a re-send prints
 * the same letter.
 */

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;

type Member = { id: string; name: string; chatId: number | null; agentId: number };
type LetterRow = {
  id: number;
  employee_id: string;
  number: 1 | 2;
  numbers: LetterNumbers;
  warned: boolean;
  issued_at: string;
  delivered: boolean;
  signed_at: string | null;
  withdrawn: number[] | null;
};
const COLS = "id, employee_id, number, numbers, warned, issued_at, delivered, signed_at, withdrawn";

/** where a withdrawn conversation goes back to */
const SALES_TEAM = "قسم المبيعات";

/**
 * The withdrawal is OFF until the owner says otherwise (2026-10-23: «لا تسحب الآن
 * إلا بعد أن أبلغك»): app_settings «staff_letters_withdraw» = "on" turns it on.
 * A missing row reads as off.
 */
const WITHDRAW_SETTING = "staff_letters_withdraw";
async function withdrawOn(): Promise<boolean> {
  const { data } = await db().from("app_settings").select("value").eq("key", WITHDRAW_SETTING).maybeSingle();
  return (data as { value?: string } | null)?.value === "on";
}

/** what counts as «أكّد»: an operations file confirmed (or paid, or done) on an offer they sold */
const CONFIRMED = ["confirmed", "paid_partial", "paid_full", "completed"];

const riyadh = { timeZone: "Asia/Riyadh" } as const;
const dateText = (ms: number) => new Date(ms).toLocaleDateString("en-GB", riyadh);
const dateTimeText = (ms: number) => `${dateText(ms)} ${new Date(ms).toLocaleTimeString("en-GB", { ...riyadh, hour: "2-digit", minute: "2-digit" })}`;

/** «قسم المبيعات»: the active sales employees who have a Teletel account. */
async function salesTeam(): Promise<Member[]> {
  const { data: roles } = await db().from("roles").select("id").eq("english_name", "sales");
  const ids = ((roles ?? []) as { id: string }[]).map((r) => r.id);
  if (!ids.length) return [];
  const { data } = await db()
    .from("employees")
    .select("id, arabic_name, telegram_chat_id, teletel_agent_id")
    .eq("status", "Active")
    .in("role_id", ids)
    .not("teletel_agent_id", "is", null);
  return ((data ?? []) as { id: string; arabic_name: string; telegram_chat_id: number | string | null; teletel_agent_id: number }[]).map((e) => ({
    id: e.id,
    name: e.arabic_name.trim(),
    chatId: e.telegram_chat_id != null && Number(e.telegram_chat_id) ? Number(e.telegram_chat_id) : null,
    agentId: e.teletel_agent_id,
  }));
}

/** Telegram knows the chat only once they pressed «ابدأ». */
const joined = async (m: Member) => (m.chatId ? (await staffCall("getChat", { chat_id: m.chatId })).ok : false);

async function letterNumbers(m: Member): Promise<LetterNumbers | null> {
  const [total, open, closed, ops, external] = await Promise.all([
    countAgentConversations(m.agentId, "all"),
    countAgentConversations(m.agentId, "open"),
    countAgentConversations(m.agentId, "resolved"),
    db().from("operations").select("id, offers!inner(employee_id)", { count: "exact", head: true }).eq("offers.employee_id", m.id).in("client_status", CONFIRMED),
    db().from("external_trips").select("id", { count: "exact", head: true }).eq("employee_id", m.id),
  ]);
  if (total == null || open == null || closed == null || ops.error || external.error) return null;
  return { total, open, closed, confirmed: (ops.count ?? 0) + (external.count ?? 0) };
}

function caption(row: LetterRow): string {
  return [
    `📄 <b>خطاب رسمي رقم ${row.number} من إدارة ترافليون</b>`,
    row.warned ? "⚠️ يتضمن إبلاغاً رسمياً بسحب المحادثات." : null,
    "",
    "اقرأه، ثم اضغط «✍️ اعتمدت الخطاب». يُحفظ اعتمادك في النظام توقيعاً إلكترونياً منك.",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/** The letter as a picture (same sheet as the PDF pipeline), with the signing button. Letter 2 reads letter 1 for the comparison. */
async function deliver(row: LetterRow, m: Member): Promise<boolean> {
  if (!m.chatId || !(await joined(m))) return false;
  let previous: PreviousLetter | undefined;
  if (row.number === 2) {
    const { data } = await db().from("staff_letters").select("numbers, issued_at, signed_at").eq("employee_id", m.id).eq("number", 1).maybeSingle();
    const first = data as { numbers: LetterNumbers; issued_at: string; signed_at: string | null } | null;
    if (!first) return false;
    previous = { numbers: first.numbers, date: dateText(Date.parse(first.issued_at)), signed: first.signed_at ? dateTimeText(Date.parse(first.signed_at)) : null };
  }
  const t = await loadTargets();
  const html = await renderDocHtml((assets) =>
    createElement(StaffLetterDocument, {
      name: m.name,
      number: row.number,
      numbers: row.numbers,
      targets: { firstReply: t.firstReply[0], reply: t.reply[0] },
      date: dateText(Date.parse(row.issued_at)),
      previous,
      warned: row.warned,
      assets,
    }),
  );
  const png = await documentToPng(html);
  const sent = await staffSendPhoto(m.chatId, png, caption(row), [[{ text: "✍️ اعتمدت الخطاب", callback_data: `ls:${row.id}` }]], `letter:${row.number}`);
  if (!sent.ok) return false;
  await db().from("staff_letters").update({ delivered: true, chat_id: m.chatId, message_id: sent.messageId }).eq("id", row.id);
  if (row.number === 2 && row.warned) await withdraw(row, m);
  return true;
}

/**
 * What the warned letter announced, right after it arrived: claimed once
 * (withdrawn_at), read from a fresh open list, each conversation handed back to
 * «قسم المبيعات» and read back. The employee is told how many, and why.
 */
async function withdraw(row: LetterRow, m: Member): Promise<void> {
  // held until the owner says so; the letter's row waits (withdrawn null) and the tick takes it once it is on
  if (!(await withdrawOn())) return;
  const { data: claimed } = await db().from("staff_letters").update({ withdrawn_at: new Date().toISOString() }).eq("id", row.id).is("withdrawn_at", null).select("id");
  if (!claimed?.length) return;
  const [list, teams] = await Promise.all([listOpenConversations(true), listTeletelTeams()]);
  const team = teams.find((t) => t.name === SALES_TEAM);
  if (!list || !team) {
    // Teletel unreadable: released, the next tick tries again
    await db().from("staff_letters").update({ withdrawn_at: null }).eq("id", row.id);
    return;
  }
  const done: number[] = [];
  for (const id of toWithdraw(list.rows, m.agentId, Date.now() / 1000)) if (await returnToTeam(id, team.id, m.agentId)) done.push(id);
  await db().from("staff_letters").update({ withdrawn: done }).eq("id", row.id);
  await logAudit({
    action: "staff_letter.withdrawn",
    entity: "employees",
    entity_id: m.id,
    meta: { letter: row.id, conversations: done, team: team.id },
    actor: { id: null, label: "تنبيهاتي" },
  });
  if (done.length && m.chatId) {
    await staffSend(
      m.chatId,
      `🔁 <b>سحب المحادثات</b>\n\nكما ورد في الخطاب رقم 2، سُحبت منك <b>${done.length}</b> محادثة مفتوحة مرّ عليها ${WITHDRAW_AFTER_DAYS} أيام بلا رد من العميل، وأُعيدت لقسم المبيعات.`,
      undefined,
      {},
      "withdrawn",
    );
  }
}

/** Numbers frozen, the row claimed (one per employee and number), then delivered. */
async function issue(m: Member, number: 1 | 2, before?: LetterNumbers): Promise<boolean> {
  const numbers = await letterNumbers(m);
  if (!numbers) return false;
  const warned = number === 2 && before ? !closedEnough(before, numbers) : false;
  const { data } = await db()
    .from("staff_letters")
    .upsert({ employee_id: m.id, number, numbers, warned }, { onConflict: "employee_id,number", ignoreDuplicates: true })
    .select(COLS);
  const row = ((data ?? []) as LetterRow[])[0];
  if (!row) return false;
  await logAudit({ action: "staff_letter.issued", entity: "employees", entity_id: m.id, meta: { number, numbers, warned }, actor: { id: null, label: "تنبيهاتي" } });
  return deliver(row, m);
}

/** The minute job's share, every fifth minute from 09:00 to 21:00 Riyadh. */
export async function lettersTick(nowMs = Date.now()): Promise<{ issued: number; waiting?: number } | null> {
  if (Math.floor(nowMs / 60_000) % 5 !== 2) return null;
  const hour = new Date(nowMs + 3 * 3600_000).getUTCHours();
  if (hour < 9 || hour >= 21) return null;
  const [team, { data }] = await Promise.all([salesTeam(), db().from("staff_letters").select(COLS)]);
  const rows = (data ?? []) as LetterRow[];
  const has = (id: string, n: number) => rows.some((r) => r.employee_id === id && r.number === n);
  let issued = 0;

  // issued but not delivered (Telegram refused, or the render failed): again, once they can be reached
  for (const r of rows.filter((x) => !x.delivered)) {
    const m = team.find((x) => x.id === r.employee_id);
    if (m && (await deliver(r, m))) issued += 1;
  }

  // a warned letter 2 that arrived while Teletel could not be read: its withdrawal again
  for (const r of rows.filter((x) => x.number === 2 && x.warned && x.delivered && !x.withdrawn)) {
    const m = team.find((x) => x.id === r.employee_id);
    if (m) await withdraw(r, m);
  }

  // letter 1: only once everyone with a linked Telegram has joined (the owner, 2026-10-23: the
  // two without one don't hold it back); then each newcomer when they join
  const without = team.filter((m) => !has(m.id, 1));
  const ready = await Promise.all(without.map(joined));
  const waiting = without.filter((m, i) => m.chatId && !ready[i]).length;
  if (rows.some((r) => r.number === 1) || !waiting) {
    for (const [i, m] of without.entries()) if (ready[i] && (await issue(m, 1))) issued += 1;
  }

  // letter 2: ten days after their letter 1
  for (const first of rows.filter((r) => r.number === 1 && Date.parse(r.issued_at) <= nowMs - SECOND_LETTER_DAYS * 86_400_000)) {
    const m = team.find((x) => x.id === first.employee_id);
    if (m && !has(m.id, 2) && (await issue(m, 2, first.numbers))) issued += 1;
  }

  if (issued) await tellManagers();
  return { issued, ...(waiting && !rows.length ? { waiting } : {}) };
}

/** «✍️ اعتمدت الخطاب» — theirs only, once. The button turns into the signature line. */
export async function signLetter(me: StaffMember, chatId: number, id: number, messageId?: number): Promise<void> {
  const nowMs = Date.now();
  const { data } = await db()
    .from("staff_letters")
    .update({ signed_at: new Date(nowMs).toISOString() })
    .eq("id", id)
    .eq("employee_id", me.id)
    .is("signed_at", null)
    .select("number")
    .maybeSingle();
  const row = data as { number: number } | null;
  if (!row) return;
  await logAudit({ action: "staff_letter.signed", entity: "staff_letters", entity_id: String(id), meta: { number: row.number, chat: chatId }, actor: { id: me.id, label: me.name } });
  if (messageId) {
    await staffCall("editMessageCaption", {
      chat_id: chatId,
      message_id: messageId,
      caption: `📄 <b>خطاب رسمي رقم ${row.number} من إدارة ترافليون</b>\n\n✅ اعتمدته في ${dateTimeText(nowMs)}. اعتمادك محفوظ في النظام توقيعاً إلكترونياً منك.`,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [] },
    });
  }
  await tellManagers();
}

/** Who got which letter and who signed it — «📄 الخطابات» in the team view, and pushed to managers when it changes. */
async function lettersText(): Promise<string> {
  const [team, { data }] = await Promise.all([salesTeam(), db().from("staff_letters").select(COLS)]);
  const rows = (data ?? []) as LetterRow[];
  const lines = ["📄 <b>الخطابات الرسمية — قسم المبيعات</b>", ""];
  if (!rows.length) {
    const linked = team.filter((m) => m.chatId);
    const ready = await Promise.all(linked.map(joined));
    const missing = linked.filter((_, i) => !ready[i]).map((m) => escapeHtml(m.name));
    const unlinked = team.filter((m) => !m.chatId).map((m) => escapeHtml(m.name));
    lines.push("الخطاب رقم 1 لم يُرسل بعد: يُرسل تلقائياً عندما يدخل البوت كل موظفي المبيعات المربوطين بتيليجرام.");
    lines.push(missing.length ? `⏳ بانتظار دخول ${missing.length}: ${missing.join("، ")}` : "✅ دخل الجميع — يُرسل في الدقائق القادمة (من 9 صباحاً إلى 9 مساءً).");
    if (unlinked.length) lines.push(`➖ بلا تيليجرام، فلا ينتظرهم الخطاب: ${unlinked.join("، ")}`);
    return lines.join("\n");
  }
  for (const n of [1, 2] as const) {
    const of = rows.filter((r) => r.number === n);
    if (!of.length) {
      lines.push(`<b>الخطاب رقم 2</b>: يصدر تلقائياً بعد ${SECOND_LETTER_DAYS} أيام من الخطاب رقم 1.`);
      continue;
    }
    const signed = of.filter((r) => r.signed_at).length;
    lines.push(`<b>الخطاب رقم ${n}</b> — اعتمده ${signed} من ${of.length}`);
    for (const r of of) {
      const name = escapeHtml(team.find((m) => m.id === r.employee_id)?.name ?? "—");
      const state = r.signed_at ? `✅ اعتمده ${dateTimeText(Date.parse(r.signed_at))}` : r.delivered ? "⏳ وصله ولم يعتمده" : "⚠️ لم يصله بعد";
      const withdrawn = r.withdrawn ? ` · 🔁 سُحب منه ${r.withdrawn.length}` : r.warned ? " · 🔴 إبلاغ بسحب المحادثات" : "";
      lines.push(`${state} · ${name}${withdrawn}`);
    }
    lines.push("");
  }
  if (rows.some((r) => r.warned && !r.withdrawn) && !(await withdrawOn())) lines.push("⏸️ السحب الآلي للمحادثات موقوف حتى تأذن الإدارة.");
  return lines.join("\n").trim();
}

const LETTERS_BUTTONS: InlineButton[][] = [[{ text: "🔄 تحديث", callback_data: "lt" }, { text: "↩️ الفريق", callback_data: "team" }]];

export async function lettersView(me: StaffMember): Promise<{ text: string; buttons: InlineButton[][] }> {
  if (!(await isBotManager(me.id))) return { text: "هذا للإدارة فقط.", buttons: [] };
  return { text: await lettersText(), buttons: LETTERS_BUTTONS };
}

/** One message per manager (slot «letters»), replaced each time something changes. */
async function tellManagers(): Promise<void> {
  const text = await lettersText();
  for (const m of await managers()) await staffSend(m.chatId, text, LETTERS_BUTTONS, {}, "letters");
}
