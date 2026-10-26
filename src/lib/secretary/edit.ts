"use server";

import { logAudit } from "@/lib/data/audit";
import { insertDraft, loadDraft } from "@/lib/data/draft-store";
import { FOLLOWUP_SETTINGS_KEY, handlerOf, parseFollowupSettings } from "@/lib/followups/rules";
import { muradJson } from "@/lib/murad/model";
import { dedupeKeys } from "@/lib/notifications/core";
import { notifyEmployee } from "@/lib/notifications/notify";
import { conversationThread } from "@/lib/providers/teletel";
import { applyClientEdit, CLIENT_EDIT_SCHEMA, type ClientEditPlan } from "./edit-core";
import { currentSecretaryEmployee, secretaryDb, secretarySettings } from "./core";

/**
 * «تنفيذ طلب العميل على الملف» (phase ب) — the doing: the employee names the
 * client's request (or pastes it), the secretary reads the client's own last
 * messages and the file linked to the conversation, and prepares a NEW copy
 * ready for review on /basic. The original draft is never touched, nothing is
 * issued, nothing reaches the client.
 */

const EDIT_SYSTEM = [
  "أنت سكرتير موظف في شركة سياحة. اقرأ طلب العميل (من كلام الموظف وآخر رسائل العميل) وأخرج خطة تعديل منظّمة على ملف رحلته.",
  "قواعد لا تُكسر:",
  "- استخرج فقط: حذف مدن، إبقاء مدن فقط، تغيير عدد الأيام، عدد الأشخاص، عدد الغرف، تاريخ الوصول.",
  "- لا تخترع شيئاً لم يُقل. ما لا تغطيه هذه العمليات (تغيير فندق بعينه، إضافة مدينة جديدة، طيران، ميزانية…) اكتبه في beyond ولا تحوّله لعملية.",
  "- أسماء المدن كما قيلت. summary سطر واحد بالعربية يلخص طلب العميل.",
].join("\n");

export type EditFile = { conversationId: number; client: string; destination: string | null };

/** The employee's own conversations that have a file to edit (an issued offer's draft, or the lead's draft). */
export async function listEditableFiles(): Promise<EditFile[] | null> {
  const employee = await currentSecretaryEmployee();
  if (!employee) return null;
  const db = secretaryDb();
  const [{ data: rows }, { data: setting }] = await Promise.all([
    db.from("sla_followups").select("conversation_id, contact_name, destination, assigned_to, step, status, offer_id").eq("status", "open").order("last_client_at", { ascending: false }).limit(200),
    db.from("app_settings").select("value").eq("key", FOLLOWUP_SETTINGS_KEY).maybeSingle(),
  ]);
  const settings = parseFollowupSettings((setting as { value?: string } | null)?.value);
  type R = { conversation_id: number; contact_name: string | null; destination: string | null; assigned_to: string | null; step: number | null; status: "open" | "done"; offer_id: string | null };
  const mine = ((rows ?? []) as R[]).filter((r) => handlerOf(r, settings) === employee.id);
  const leadFor = new Map<number, string>();
  const noOffer = mine.filter((r) => !r.offer_id).map((r) => r.conversation_id);
  if (noOffer.length) {
    const { data: leads } = await db.from("client_leads").select("teletel_conversation_id, draft_id").in("teletel_conversation_id", noOffer).not("draft_id", "is", null);
    for (const l of (leads ?? []) as { teletel_conversation_id: number; draft_id: string }[]) leadFor.set(l.teletel_conversation_id, l.draft_id);
  }
  return mine
    .filter((r) => r.offer_id || leadFor.has(r.conversation_id))
    .map((r) => ({ conversationId: r.conversation_id, client: r.contact_name || `محادثة #${r.conversation_id}`, destination: r.destination }));
}

async function draftIdFor(conversationId: number): Promise<string | null> {
  const db = secretaryDb();
  const { data: fu } = await db.from("sla_followups").select("offer_id").eq("conversation_id", conversationId).eq("status", "open").maybeSingle();
  const offerId = (fu as { offer_id: string | null } | null)?.offer_id;
  if (offerId) {
    const { data: offer } = await db.from("offers").select("serial").eq("id", offerId).maybeSingle();
    const serial = (offer as { serial: string } | null)?.serial;
    if (serial) {
      const { data: draft } = await db.from("offer_drafts").select("id").eq("data->>produced_serial", serial).limit(1).maybeSingle();
      if (draft) return (draft as { id: string }).id;
    }
  }
  const { data: lead } = await db.from("client_leads").select("draft_id").eq("teletel_conversation_id", conversationId).not("draft_id", "is", null).maybeSingle();
  return (lead as { draft_id: string } | null)?.draft_id ?? null;
}

export type PrepareResult =
  | { ok: true; draftId: string; summary: string; flags: string[]; beyond: string }
  | { ok: false; error: string };

export async function prepareClientEdit(conversationId: number, instruction: string): Promise<PrepareResult> {
  const text = typeof instruction === "string" ? instruction.trim().slice(0, 2000) : "";
  if (!Number.isSafeInteger(conversationId) || !text) return { ok: false, error: "اكتب طلب العميل." };
  const employee = await currentSecretaryEmployee();
  if (!employee) return { ok: false, error: "سجّل الدخول بحساب موظف." };
  const db = secretaryDb();
  const settings = await secretarySettings(db);
  if (settings.off) return { ok: false, error: "السكرتير موقوف حالياً من الإدارة." };

  // the conversation must be the employee's own
  const files = await listEditableFiles();
  if (!files?.some((f) => f.conversationId === conversationId)) return { ok: false, error: "هذه المحادثة ليست من ملفاتك أو لا ملف مرتبطاً بها." };

  const draftId = await draftIdFor(conversationId);
  if (!draftId) return { ok: false, error: "لم أجد ملفاً مرتبطاً بالمحادثة." };
  const record = await loadDraft(draftId);
  if (!record) return { ok: false, error: "تعذّر فتح الملف." };

  const thread = await conversationThread(conversationId, 2).catch(() => null);
  const lastMsgs = (thread?.messages ?? [])
    .filter((m) => m.text?.trim())
    .slice(-12)
    .map((m) => `${m.fromClient ? "العميل" : "نحن"}: ${m.text.slice(0, 400)}`);

  const d = record.data;
  const fileLine = [
    `الملف الحالي: ${d.trip.country || d.trip.destination} — ${d.trip.days} أيام / ${d.trip.nights} ليالٍ، ${d.trip.adults} بالغ، ${d.trip.rooms} غرفة، الوصول ${d.trip.arrival_date ?? "غير محدد"}.`,
    `مدنه: ${d.cities.map((c) => `${c.city_name} (${c.nights} ليالٍ)`).join("، ") || "بلا مدن"}.`,
  ].join("\n");

  const prompt = [fileLine, "", "آخر الرسائل:", ...lastMsgs, "", `طلب الموظف الآن: ${text}`].join("\n");

  let plan: ClientEditPlan | null = null;
  try {
    const raw = await muradJson("secretary_edit", EDIT_SYSTEM, prompt, CLIENT_EDIT_SCHEMA as unknown as Record<string, unknown>);
    plan = raw ? (JSON.parse(raw) as ClientEditPlan) : null;
  } catch { /* fall through */ }
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.remove_cities) || !Array.isArray(plan.keep_only_cities)) {
    return { ok: false, error: "تعذّر فهم الطلب الآن — جرّب بصياغة أوضح." };
  }

  const applied = applyClientEdit(d, plan);
  if (!applied.changed) {
    return { ok: false, error: plan.beyond?.trim() ? `هذا الطلب خارج ما أستطيع تنفيذه بأمان (${plan.beyond.trim()}) — نفّذه بنفسك في الملف.` : "لم أجد تغييراً أنفّذه من هذا الطلب." };
  }

  const title = `طلب العميل — ${d.customer.customer_name || files.find((f) => f.conversationId === conversationId)?.client || ""}`.trim();
  const inserted = await insertDraft(applied.data, title);
  if (!inserted.ok) return { ok: false, error: "تعذّر إنشاء النسخة." };

  const note = [
    `جهّزت نسخة جديدة من ملف ${d.customer.customer_name || "العميل"} حسب طلبه: ${plan.summary || text}`,
    ...applied.flags.map((f) => `⚠️ ${f}`),
    ...(plan.beyond?.trim() ? [`خارج ما نفّذته (يحتاجك): ${plan.beyond.trim()}`] : []),
    `راجع الأسعار ثم أصدرها من /basic/${inserted.id} — الملف الأصلي كما هو، ولم يُرسل شيء للعميل.`,
  ].join("\n");
  await db.from("secretary_messages").insert({ employee_id: employee.id, role: "secretary", content: note }).select("id").maybeSingle();
  await notifyEmployee({
    employeeId: employee.id, kind: "draft_ready", source: "secretary", href: `/basic/${inserted.id}`,
    title: `📝 مسودة طلب العميل جاهزة — ${d.customer.customer_name || "عميل"}`, body: (plan.summary || text).slice(0, 300), dedupeKey: dedupeKeys.draftReady(inserted.id),
  }).catch(() => null);
  await logAudit({
    action: "secretary.file_prepared",
    entity: "offer_drafts",
    entity_id: inserted.id,
    meta: { conversation: conversationId, from_draft: draftId, summary: plan.summary, flags: applied.flags.length },
  });
  return { ok: true, draftId: inserted.id, summary: plan.summary || text, flags: applied.flags, beyond: plan.beyond?.trim() ?? "" };
}
