import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import { leaveRange, overlaps, riyadhDay } from "@/lib/presence/excuse";
import { escapeHtml, staffSend, type StaffMember } from "./staff-bot";
import { colleagues, isBotManager } from "./staff-manager";
import { BACK_ADMIN } from "./staff-admin-core";
import type { InlineButton } from "./ops-bot";

/**
 * «🏖️ منح إجازة» in the administration's bot (the owner, 2026-10-29): the colleague → how many days from today → why →
 * a preview → «امنح». The leave starts and ends by itself (presence/availability.ts reads it); the colleague is told.
 * Every step checks the bot's manager first — a callback_data can be sent by any linked account.
 */

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
type View = { text: string; buttons: InlineButton[][] };
const REFUSED: View = { text: "هذا للإدارة فقط.", buttons: [] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LEAVE_DAYS = [1, 2, 3, 5, 7, 14] as const;
export const LEAVE_REASONS = ["سنوية", "مرضية", "طارئة", "أخرى"] as const;
const daysWord = (n: number) => (n === 1 ? "اليوم فقط" : n === 2 ? "يومان" : `${n} أيام`);

/** «lv:<id>» / «lv:<id>:<days>» / «lv:<id>:<days>:<reason>» / «lvok:…» — anything else is not ours */
export function parseLeaveData(data: string): { ok: boolean; id: string | null; days: number | null; reason: number | null } | null {
  const p = data.split(":");
  if (p[0] !== "lv" && p[0] !== "lvok") return null;
  const id = p[1] ?? null;
  if (id !== null && !UUID.test(id)) return null;
  const days = p[2] !== undefined ? Number(p[2]) : null;
  if (days !== null && !(LEAVE_DAYS as readonly number[]).includes(days)) return null;
  const reason = p[3] !== undefined ? Number(p[3]) : null;
  if (reason !== null && !(Number.isInteger(reason) && reason >= 0 && reason < LEAVE_REASONS.length)) return null;
  if (p[0] === "lvok" && (id === null || days === null || reason === null)) return null;
  return { ok: p[0] === "lvok", id, days, reason };
}

export async function leaveView(me: StaffMember, data: string): Promise<View> {
  if (!(await isBotManager(me.id))) return REFUSED;
  const step = parseLeaveData(data) ?? { ok: false, id: null, days: null, reason: null };
  const people = (await colleagues()).filter((p) => p.id !== me.id).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  const who = step.id ? people.find((p) => p.id === step.id) : undefined;
  if (!who) {
    const rows = people.map((p) => ({ text: p.name.trim().slice(0, 20), callback_data: `lv:${p.id}` }));
    return {
      text: "🏖️ <b>منح إجازة</b>\n\nاختر الموظف. لا تُحوَّل إليه طلبات ولا يُحسب عليه تأخير حتى تنتهي، ثم يعود وحده.",
      buttons: [...Array.from({ length: Math.ceil(rows.length / 2) }, (_, i) => rows.slice(i * 2, i * 2 + 2)), [BACK_ADMIN]],
    };
  }
  const name = escapeHtml(who.name.trim());
  if (step.days === null) {
    return {
      text: `🏖️ <b>إجازة ${name}</b>\n\nكم يوماً من اليوم؟`,
      buttons: [
        ...[LEAVE_DAYS.slice(0, 3), LEAVE_DAYS.slice(3)].map((row) => row.map((d) => ({ text: daysWord(d), callback_data: `lv:${who.id}:${d}` }))),
        [{ text: "↩️ الموظفون", callback_data: "lv" }, BACK_ADMIN],
      ],
    };
  }
  const range = leaveRange(riyadhDay(Date.now()), step.days);
  if (step.reason === null) {
    return {
      text: `🏖️ <b>إجازة ${name}</b> — ${daysWord(step.days)} (${range.starts_on} → ${range.ends_on})\n\nما سببها؟`,
      buttons: [
        LEAVE_REASONS.map((r, i) => ({ text: r, callback_data: `lv:${who.id}:${step.days}:${i}` })),
        [{ text: "↩️ المدة", callback_data: `lv:${who.id}` }, BACK_ADMIN],
      ],
    };
  }
  return {
    text: [
      `🏖️ <b>تأكيد الإجازة</b>`,
      "",
      `الموظف: <b>${name}</b>`,
      `من ${range.starts_on} إلى ${range.ends_on} (${daysWord(step.days)})`,
      `السبب: ${LEAVE_REASONS[step.reason]}`,
      "",
      "يصله تنبيه في «تنبيهاتي». لا تُحوَّل إليه طلبات ولا يُحسب عليه تأخير حتى تنتهي.",
    ].join("\n"),
    buttons: [
      [
        { text: "✅ امنح الإجازة", callback_data: `lvok:${who.id}:${step.days}:${step.reason}` },
        { text: "✖️ إلغاء", callback_data: "ad" },
      ],
    ],
  };
}

/** «امنح الإجازة»: checked again, refused when it meets one already given, saved, recorded, told. */
export async function grantLeave(me: StaffMember, chatId: number, data: string): Promise<void> {
  if (!(await isBotManager(me.id))) {
    await staffSend(chatId, REFUSED.text);
    return;
  }
  const step = parseLeaveData(data);
  const who = step?.ok ? (await colleagues()).find((p) => p.id === step.id) : undefined;
  if (!step?.ok || !who || step.days === null || step.reason === null) {
    await staffSend(chatId, "لم أفهم الطلب — ابدأ من «🏖️ منح إجازة».", [[BACK_ADMIN]]);
    return;
  }
  const range = leaveRange(riyadhDay(Date.now()), step.days);
  const { data: same } = await db().from("employee_leaves").select("starts_on, ends_on").eq("employee_id", who.id).is("cancelled_at", null);
  if (((same ?? []) as { starts_on: string; ends_on: string }[]).some((l) => overlaps(l, range))) {
    await staffSend(chatId, `لـ${escapeHtml(who.name.trim())} إجازة تتقاطع مع هذه الأيام — لم تُسجَّل مرة ثانية.`, [[BACK_ADMIN]]);
    return;
  }
  const reason = LEAVE_REASONS[step.reason];
  const { data: row, error } = await db()
    .from("employee_leaves")
    .insert({ employee_id: who.id, ...range, reason, created_by: me.id })
    .select("id")
    .single();
  if (error || !row) {
    await staffSend(chatId, "تعذّر الحفظ — جرّب مرة أخرى.", [[BACK_ADMIN]]);
    return;
  }
  await logAudit({
    action: "presence.leave_added",
    entity: "employees",
    entity_id: who.id,
    meta: { leave: (row as { id: number }).id, from: range.starts_on, to: range.ends_on, via: "bot" },
    actor: { id: me.id, label: me.name },
  });
  if (who.chatId)
    await staffSend(
      who.chatId,
      `🏖️ <b>إجازة</b>\n\nمن ${range.starts_on} إلى ${range.ends_on} — ${reason}.\nلن تُحوَّل إليك طلبات ولا يُحسب عليك تأخير حتى تعود.\n\n— ${escapeHtml(me.name.trim())}`,
      undefined,
      {},
      "leave",
    );
  await staffSend(chatId, `✅ سُجّلت إجازة ${escapeHtml(who.name.trim())} من ${range.starts_on} إلى ${range.ends_on}${who.chatId ? " وأُبلغ بها." : "."}`, [
    [BACK_ADMIN],
  ]);
}
