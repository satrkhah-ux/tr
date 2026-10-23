import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { asSystem } from "@/lib/supabase/system-actor";
import { logAudit } from "@/lib/data/audit";
import { managerSnapshot, type ManagerSnapshot } from "@/lib/manager-screen/snapshot";
import type { UrgentItem } from "@/lib/manager-screen/rules";
import { escapeHtml, staffSend, type StaffMember } from "./staff-bot";
import { colleagues, isBotManager } from "./staff-manager";
import type { ScreenView } from "./staff-screen";
import type { InlineButton } from "./ops-bot";

/**
 * «قرارات الإدارة» in the bot (the user, 2026-10-22: «اريد اضافة للإدارة في
 * البوت قرارات الادارة التي تظهر على الشاشة و تطلب تدخل»). It is the same
 * screen as «قناة المدير» (/m) and the same decisions as /management-decisions.
 *
 *   - «🚨 يحتاج تدخلك»: the screen's red items («يحتاج تدخلك الآن»), and the
 *     amber ones («تحت المتابعة») behind a button, each with its reason and
 *     what to do;
 *   - «📝 اتخذ قراراً» on an item, or «➕ قرار جديد»: the text, then the owner,
 *     then the date. The decision is written to management_decisions with the
 *     item as its evidence, exactly as the web page writes it, and the owner is
 *     told in the bot;
 *   - «📋 قرارات الإدارة»: the open ones, overdue first in red, moved to
 *     «قيد التنفيذ» or «تم»;
 *   - pushed: a NEW red item reaches the bot's managers once a day (one message
 *     per round, never one per item), and a decision made on the web reaches its
 *     owner.
 * The bot's managers only (staff-manager.ts isBotManager), checked on every step.
 */

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
const REFUSED: ScreenView = { text: "هذا للإدارة فقط.", buttons: [] };
const UNREAD: ScreenView = { text: "تعذّر قراءة شاشة الإدارة الآن — جرّب بعد دقيقة.", buttons: [[{ text: "🔄 تحديث", callback_data: "si" }]] };

/** The screen's own snapshot (kept a minute, shared with the TVs), read as the system with the screen's permission. */
async function snapshot(): Promise<ManagerSnapshot | null> {
  return asSystem({ name: "تنبيهاتي", can: ["dashboard.admin"] }, () => managerSnapshot()).catch(() => null);
}

const keyOf = (s: UrgentItem) => `${s.panel}:${s.key}`;
/** Telegram's button data is 64 bytes, so an item travels as a short hash of its key. */
const short = (key: string) => createHash("sha1").update(key).digest("hex").slice(0, 10);
const riyadhDate = (nowMs: number, plusDays = 0) => new Date(nowMs + 3 * 3600_000 + plusDays * 86_400_000).toISOString().slice(0, 10);

function itemButton(s: UrgentItem, red: boolean): InlineButton[] {
  return [{ text: `${red ? "🔴" : "🟡"} ${s.label}: ${s.value}`.slice(0, 60), callback_data: `sg:${short(keyOf(s))}` }];
}

/** «🚨 يحتاج تدخلك»: the red items, or the amber ones (`watch`). */
export async function interventionView(me: StaffMember, watch = false): Promise<ScreenView> {
  if (!(await isBotManager(me.id))) return REFUSED;
  const snap = await snapshot();
  if (!snap) return UNREAD;
  const list = watch ? snap.watch : snap.urgent;
  const head = watch
    ? `🟡 <b>تحت المتابعة</b> — ${list.length}`
    : list.length
      ? `🚨 <b>يحتاج تدخلك الآن</b> — ${list.length}`
      : "✅ لا شيء يحتاج تدخلك الآن.";
  return {
    text: [head, list.length ? "اضغط على البند لترى سببه وما يُقترح فعله، ومنه تتخذ قراراً." : null].filter(Boolean).join("\n"),
    buttons: [
      ...list.slice(0, 12).map((s) => itemButton(s, !watch)),
      watch ? [{ text: `🚨 يحتاج تدخلك (${snap.urgent.length})`, callback_data: "si" }] : [{ text: `🟡 تحت المتابعة (${snap.watch.length})`, callback_data: "sw" }],
      [{ text: "📋 قرارات الإدارة", callback_data: "dl" }, { text: "🔄 تحديث", callback_data: watch ? "sw" : "si" }],
    ],
  };
}

/** One item: what the screen says about it, and «📝 اتخذ قراراً». */
export async function signalView(me: StaffMember, hash: string): Promise<ScreenView> {
  if (!(await isBotManager(me.id))) return REFUSED;
  const snap = await snapshot();
  if (!snap) return UNREAD;
  const red = snap.urgent.find((s) => short(keyOf(s)) === hash);
  const item = red ?? snap.watch.find((s) => short(keyOf(s)) === hash);
  if (!item) return { text: "تغيّر هذا البند — لم يعد على الشاشة.", buttons: [[{ text: "🚨 يحتاج تدخلك", callback_data: "si" }]] };
  return {
    text: [
      `${red ? "🔴" : "🟡"} <b>${escapeHtml(item.panelTitle)}</b>`,
      `${escapeHtml(item.label)}: <b>${escapeHtml(item.value)}</b>`,
      escapeHtml(item.detail ?? item.reason),
      item.action ? `← ${escapeHtml(item.action)}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    buttons: [[{ text: "📝 اتخذ قراراً", callback_data: `sd:${hash}` }], [{ text: "🚨 يحتاج تدخلك", callback_data: "si" }, { text: "📋 قرارات الإدارة", callback_data: "dl" }]],
  };
}

// ---------- making a decision: text → owner → date ----------

/** «📝 اتخذ قراراً» / «➕ قرار جديد»: the manager's next text becomes the decision. `hash` is the item it comes from. */
export async function promptDecision(me: StaffMember, chatId: number, hash: string | null): Promise<void> {
  if (!(await isBotManager(me.id))) {
    await staffSend(chatId, REFUSED.text);
    return;
  }
  let sourceKey: string | null = null;
  let about = "";
  if (hash) {
    const snap = await snapshot();
    const item = snap ? [...snap.urgent, ...snap.watch].find((s) => short(keyOf(s)) === hash) : undefined;
    if (!item) {
      await staffSend(chatId, "تغيّر هذا البند — لم يعد على الشاشة.");
      return;
    }
    sourceKey = keyOf(item);
    about = ` بخصوص «${escapeHtml(item.label)}: ${escapeHtml(item.value)}»`;
  }
  await db().from("staff_bot_pending").upsert({ chat_id: chatId, kind: "decision", target_id: null, source_key: sourceKey, created_at: new Date().toISOString() });
  await staffSend(chatId, `📝 اكتب القرار${about}:\n<i>مثلاً: «تابع العملاء المنتظرين الآن». بعدها تختار المسؤول والموعد.</i>`, undefined, {
    reply_markup: { force_reply: true, input_field_placeholder: "نص القرار" },
  });
}

/** The text → a draft, and the owner picker. */
export async function decisionText(me: StaffMember, chatId: number, title: string, sourceKey: string | null): Promise<void> {
  if (!(await isBotManager(me.id))) {
    await staffSend(chatId, REFUSED.text);
    return;
  }
  const text = title.trim().slice(0, 500);
  if (!text) return;
  const { data } = await db().from("staff_bot_decision_drafts").insert({ employee_id: me.id, chat_id: chatId, source_key: sourceKey, title: text }).select("id").single();
  const id = (data as { id: number } | null)?.id;
  if (!id) {
    await staffSend(chatId, "تعذّر حفظ القرار — جرّب مرة أخرى.");
    return;
  }
  const people = (await colleagues()).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  const rows: InlineButton[][] = [];
  for (let i = 0; i < people.length; i += 2) rows.push(people.slice(i, i + 2).map((p) => ({ text: p.name.slice(0, 24), callback_data: `do:${id}:${p.id}` })));
  await staffSend(chatId, `📝 «${escapeHtml(text)}»\n\n👤 من المسؤول عن تنفيذه؟`, [...rows, [{ text: "✖️ إلغاء", callback_data: `dx:${id}` }]]);
}

type Draft = { id: number; employee_id: string; source_key: string | null; title: string | null; owner_id: string | null };

async function ownDraft(me: StaffMember, id: number): Promise<Draft | null> {
  const { data } = await db().from("staff_bot_decision_drafts").select("id, employee_id, source_key, title, owner_id").eq("id", id).maybeSingle();
  const draft = data as Draft | null;
  return draft && draft.employee_id === me.id ? draft : null;
}

const DUE = [
  { days: 0, label: "اليوم" },
  { days: 1, label: "غداً" },
  { days: 3, label: "بعد ٣ أيام" },
  { days: 7, label: "بعد أسبوع" },
];

/** The owner picked → the date picker. «dx» drops the draft. */
export async function decisionStep(me: StaffMember, chatId: number, data: string): Promise<ScreenView> {
  if (!(await isBotManager(me.id))) return REFUSED;
  const [kind, rawId, value] = data.split(":");
  const draft = await ownDraft(me, Number(rawId));
  if (!draft) return { text: "انتهى هذا القرار أو سُجّل من قبل.", buttons: [] };
  if (kind === "dx") {
    await db().from("staff_bot_decision_drafts").delete().eq("id", draft.id);
    return { text: "✖️ أُلغي — لم يُسجَّل قرار.", buttons: [] };
  }
  if (kind === "do") {
    const owner = (await colleagues()).find((p) => p.id === value);
    if (!owner) return { text: "هذا الموظف لم يعد نشطاً — اختر غيره.", buttons: [] };
    await db().from("staff_bot_decision_drafts").update({ owner_id: owner.id }).eq("id", draft.id);
    return {
      text: `📝 «${escapeHtml(draft.title ?? "")}»\n👤 المسؤول: ${escapeHtml(owner.name)}\n\n🗓️ متى يجب أن يُنفَّذ؟`,
      buttons: [DUE.slice(0, 2).map((d) => ({ text: d.label, callback_data: `dd:${draft.id}:${d.days}` })), DUE.slice(2).map((d) => ({ text: d.label, callback_data: `dd:${draft.id}:${d.days}` })), [{ text: "✖️ إلغاء", callback_data: `dx:${draft.id}` }]],
    };
  }
  // «dd»: the date — the decision is written, the owner told
  const days = DUE.find((d) => String(d.days) === value)?.days;
  if (days === undefined || !draft.owner_id || !draft.title) return { text: "اختر المسؤول أولاً.", buttons: [] };
  const people = await colleagues();
  const owner = people.find((p) => p.id === draft.owner_id);
  if (!owner) return { text: "المسؤول لم يعد نشطاً — ابدأ القرار من جديد.", buttons: [] };
  const snap = draft.source_key ? await snapshot() : null;
  const item = snap ? [...snap.urgent, ...snap.watch].find((s) => keyOf(s) === draft.source_key) : undefined;
  const { data: me2 } = await db().from("employees").select("auth_user_id").eq("id", me.id).maybeSingle();
  const dueOn = riyadhDate(Date.now(), days);
  const { data: created, error } = await db()
    .from("management_decisions")
    .insert({
      title: draft.title,
      owner_id: owner.id,
      due_on: dueOn,
      evidence: item ? `${item.panelTitle} — ${item.label}: ${item.value}. ${item.reason}` : "",
      source_key: draft.source_key,
      source_at: item ? snap?.at : null,
      // the web stamps the signed-in user; from the bot it is the manager's account, or the employee when they have none
      created_by: (me2 as { auth_user_id: string | null } | null)?.auth_user_id ?? me.id,
    })
    .select("id")
    .single();
  if (error || !created) return { text: "تعذّر تسجيل القرار — جرّب مرة أخرى.", buttons: [] };
  const decisionId = (created as { id: string }).id;
  await db().from("staff_bot_decision_drafts").delete().eq("id", draft.id);
  await logAudit({
    action: "management.decision.created",
    entity: "management_decisions",
    entity_id: decisionId,
    meta: { title: draft.title, owner: owner.id, due: dueOn, from: "staff_bot" },
    actor: { id: me.id, label: me.name },
  });
  const told = await announceDecision({ id: decisionId, title: draft.title, due_on: dueOn, evidence: item ? `${item.label}: ${item.value}` : "", owner_id: owner.id }, people, me.name);
  return {
    text: [`✅ سُجّل القرار: «${escapeHtml(draft.title)}»`, `👤 ${escapeHtml(owner.name)} · 🗓️ ${dueOn}`, told ? `📨 وصل إلى ${escapeHtml(owner.name)} في البوت.` : `⚠️ لم يصل إلى ${escapeHtml(owner.name)} — حسابه في تيليجرام غير مربوط أو لم يضغط «ابدأ».`].join("\n"),
    buttons: [[{ text: "📋 قرارات الإدارة", callback_data: "dl" }, { text: "🚨 يحتاج تدخلك", callback_data: "si" }]],
  };
}

type DecisionRow = { id: string; title: string; due_on: string; evidence: string; owner_id: string; status?: string; updated_at?: string };

/** The owner hears of their decision once (staff_bot_decision_sent), from the bot or from the web page. */
async function announceDecision(d: DecisionRow, people: Awaited<ReturnType<typeof colleagues>>, by: string | null): Promise<boolean> {
  const { data: claimed } = await db().from("staff_bot_decision_sent").upsert({ decision_id: d.id }, { onConflict: "decision_id", ignoreDuplicates: true }).select("decision_id");
  if (!claimed?.length) return false;
  const owner = people.find((p) => p.id === d.owner_id);
  if (!owner?.chatId) return false;
  const sent = await staffSend(
    owner.chatId,
    [
      "📋 <b>قرار من الإدارة مسند إليك</b>",
      "",
      escapeHtml(d.title),
      `🗓️ الموعد: <b>${d.due_on}</b>`,
      d.evidence ? `السبب: ${escapeHtml(d.evidence.slice(0, 300))}` : null,
      by ? `— ${escapeHtml(by)}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    undefined,
    {},
    `dec:${d.id}`,
  );
  return sent.ok;
}

// ---------- «📋 قرارات الإدارة» ----------

const STATUS: Record<string, string> = { open: "بانتظار التنفيذ", in_progress: "قيد التنفيذ", done: "تم" };

export async function decisionsView(me: StaffMember): Promise<ScreenView> {
  if (!(await isBotManager(me.id))) return REFUSED;
  const [{ data }, people] = await Promise.all([
    db().from("management_decisions").select("id, title, due_on, status, owner_id").neq("status", "done").order("due_on").limit(15),
    colleagues(),
  ]);
  const rows = (data ?? []) as { id: string; title: string; due_on: string; status: string; owner_id: string }[];
  const today = riyadhDate(Date.now());
  const late = rows.filter((r) => r.due_on < today).length;
  return {
    text: rows.length
      ? [`📋 <b>قرارات الإدارة المفتوحة</b> — ${rows.length}`, late ? `🔴 متأخرة عن موعدها: ${late}` : null, "🔴 متأخر · 🔵 قيد التنفيذ · ⚪ بانتظار التنفيذ"].filter(Boolean).join("\n")
      : "✅ لا قرارات مفتوحة.",
    buttons: [
      ...rows.map((r) => [
        {
          text: `${r.due_on < today ? "🔴" : r.status === "in_progress" ? "🔵" : "⚪"} ${r.title.slice(0, 28)} — ${people.find((p) => p.id === r.owner_id)?.name ?? "—"}`.slice(0, 60),
          callback_data: `dc:${r.id}`,
        },
      ]),
      [{ text: "➕ قرار جديد", callback_data: "dn" }, { text: "🚨 يحتاج تدخلك", callback_data: "si" }],
    ],
  };
}

export async function decisionView(me: StaffMember, id: string): Promise<ScreenView> {
  if (!(await isBotManager(me.id))) return REFUSED;
  const [{ data }, people] = await Promise.all([db().from("management_decisions").select("id, title, due_on, status, owner_id, evidence").eq("id", id).maybeSingle(), colleagues()]);
  const d = data as (DecisionRow & { status: string }) | null;
  if (!d) return { text: "لم أجد هذا القرار.", buttons: [[{ text: "📋 قرارات الإدارة", callback_data: "dl" }]] };
  const today = riyadhDate(Date.now());
  return {
    text: [
      `📋 <b>${escapeHtml(d.title)}</b>`,
      "",
      `👤 المسؤول: ${escapeHtml(people.find((p) => p.id === d.owner_id)?.name ?? "موظف غير نشط")}`,
      `🗓️ الموعد: ${d.due_on}${d.status !== "done" && d.due_on < today ? " — 🔴 متأخر" : ""}`,
      `📌 الحالة: ${STATUS[d.status] ?? d.status}`,
      d.evidence ? `\nالسبب: ${escapeHtml(d.evidence)}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    buttons: [
      d.status === "done"
        ? []
        : [
            ...(d.status === "open" ? [{ text: "▶️ قيد التنفيذ", callback_data: `ds:${d.id}:p` }] : []),
            { text: "✅ تم التنفيذ", callback_data: `ds:${d.id}:d` },
          ],
      [{ text: "📋 قرارات الإدارة", callback_data: "dl" }],
    ].filter((row) => row.length > 0),
  };
}

export async function setDecisionStatus(me: StaffMember, data: string): Promise<ScreenView> {
  if (!(await isBotManager(me.id))) return REFUSED;
  const [, id, code] = data.split(":");
  const status = code === "d" ? "done" : code === "p" ? "in_progress" : null;
  if (!status || !/^[0-9a-f-]{36}$/i.test(id)) return decisionsView(me);
  const { data: moved } = await db().from("management_decisions").update({ status, updated_at: new Date().toISOString() }).eq("id", id).neq("status", status).select("id").maybeSingle();
  if (moved) {
    await logAudit({ action: "management.decision.updated", entity: "management_decisions", entity_id: id, meta: { status, from: "staff_bot" }, actor: { id: me.id, label: me.name } });
  }
  return decisionView(me, id);
}

// ---------- pushed by the minute job ----------

/** The bot's managers with a linked Telegram. */
export async function managers(): Promise<{ id: string; chatId: number }[]> {
  const people = (await colleagues()).filter((p) => p.chatId);
  const checks = await Promise.all(people.map(async (p) => ((await isBotManager(p.id)) ? { id: p.id, chatId: p.chatId as number } : null)));
  return checks.filter((x): x is { id: string; chatId: number } => x !== null);
}

/**
 * Every fifth minute, during working hours: the screen's red items not yet
 * pushed today go to the bot's managers, all in ONE message. Then the decisions
 * made on the web in the last two hours reach their owners. Older ones do not,
 * so the first run cannot replay the past.
 */
export async function pushDecisions(nowMs = Date.now()): Promise<{ newRed: number; owners: number } | null> {
  if (Math.floor(nowMs / 60_000) % 5 !== 0) return null;
  const hour = new Date(nowMs + 3 * 3600_000).getUTCHours();
  if (hour < 9 || hour >= 23) return null;

  let newRed: UrgentItem[] = [];
  const snap = await snapshot();
  if (snap?.urgent.length) {
    const day = riyadhDate(nowMs);
    for (const item of snap.urgent) {
      const { data: claimed } = await db().from("staff_bot_signal_alerts").upsert({ day, signal_key: keyOf(item) }, { onConflict: "day,signal_key", ignoreDuplicates: true }).select("signal_key");
      if (claimed?.length) newRed.push(item);
    }
    newRed = newRed.slice(0, 8);
    if (newRed.length) {
      const text = [
        `🚨 <b>يحتاج تدخلك</b> — ${newRed.length} ${newRed.length === 1 ? "بند جديد" : "بنود جديدة"} على شاشة الإدارة`,
        "",
        ...newRed.map((s) => `🔴 <b>${escapeHtml(s.label)}: ${escapeHtml(s.value)}</b>\n${escapeHtml(s.reason)}${s.action ? `\n← ${escapeHtml(s.action)}` : ""}`),
      ].join("\n");
      const buttons = [...newRed.map((s) => itemButton(s, true)), [{ text: "🚨 كل ما يحتاج تدخلك", callback_data: "si" }]];
      for (const m of await managers()) await staffSend(m.chatId, text, buttons, {}, "urgent");
    }
  }

  const { data } = await db()
    .from("management_decisions")
    .select("id, title, due_on, evidence, owner_id")
    .neq("status", "done")
    .gte("created_at", new Date(nowMs - 2 * 3600_000).toISOString());
  let owners = 0;
  const fresh = (data ?? []) as DecisionRow[];
  if (fresh.length) {
    const people = await colleagues();
    for (const d of fresh) if (await announceDecision(d, people, null)) owners += 1;
  }
  return { newRed: newRed.length, owners };
}
