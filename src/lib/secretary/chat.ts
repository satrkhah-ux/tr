"use server";

import { logAudit } from "@/lib/data/audit";
import { muradJson } from "@/lib/murad/model";
import { currentCan } from "@/lib/roles/current";
import { currentSecretaryEmployee, planText, renderBriefing, secretaryBriefing, secretaryDb, secretarySettings, type SecretaryEmployee } from "./core";

/**
 * «سكرتيري الخاص» — the chat (phase أ: read-only answers about the employee's
 * own conversations, tasks and hot clients). Every call resolves the signed-in
 * employee itself; nothing takes an employee id from the client.
 */

export type SecretaryMsg = { id: string; role: "user" | "secretary" | "plan"; content: string; created_at: string };

const SECRETARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply"],
  properties: { reply: { type: "string" } },
} as const;

const SECRETARY_SYSTEM = [
  "أنت «السكرتير الخاص» لموظف في ترافليون للسفر والسياحة. تجيبه عن محادثاته وملفات متابعته ومهامه اليومية وعملائه الساخنين — من البيانات المعطاة لك فقط.",
  "قواعد لا تُكسر:",
  "- أجب من البيانات المعطاة فقط. ما ليس فيها قل «غير ظاهر عندي». لا تخترع عميلاً ولا سعراً ولا موعداً.",
  "- أنت تساعد الموظف ولا تراسل العملاء: لا تَعِد بإرسال شيء لعميل.",
  "- بالعربية البسيطة، قصيراً ومرتباً (نقاط عند الحاجة)، وبأسماء العملاء كما وردت.",
  "- رتّب الأولوية: من رد وينتظر، ثم الساخن، ثم المستحق اليوم.",
].join("\n");

const TABLE_MISSING = "42P01";

async function thread(employeeId: string, limit = 50): Promise<SecretaryMsg[] | null> {
  const { data, error } = await secretaryDb()
    .from("secretary_messages")
    .select("id, role, content, created_at")
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return (error as { code?: string }).code === TABLE_MISSING ? null : [];
  return ((data ?? []) as SecretaryMsg[]).reverse();
}

export type SecretaryThread = { ok: true; messages: SecretaryMsg[] } | { ok: false; error: string };

export async function getSecretaryThread(): Promise<SecretaryThread> {
  const employee = await currentSecretaryEmployee();
  if (!employee) return { ok: false, error: "سجّل الدخول بحساب موظف." };
  const messages = await thread(employee.id);
  if (!messages) return { ok: false, error: "السكرتير لم يُفعَّل بعد (جدول الرسائل غير موجود)." };
  return { ok: true, messages };
}

export async function askSecretary(text: string): Promise<SecretaryThread> {
  const question = typeof text === "string" ? text.trim().slice(0, 2000) : "";
  if (!question) return { ok: false, error: "اكتب سؤالك." };
  const employee = await currentSecretaryEmployee();
  if (!employee) return { ok: false, error: "سجّل الدخول بحساب موظف." };
  const db = secretaryDb();
  const settings = await secretarySettings(db);
  if (settings.off) return { ok: false, error: "السكرتير موقوف حالياً من الإدارة." };

  // the day's cap, per employee — the model costs money on every turn
  const dayStart = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(Date.now()) + "T00:00:00+03:00").toISOString();
  const { count, error: countError } = await db
    .from("secretary_messages")
    .select("id", { count: "exact", head: true })
    .eq("employee_id", employee.id)
    .eq("role", "user")
    .gte("created_at", dayStart);
  if (countError) return { ok: false, error: (countError as { code?: string }).code === TABLE_MISSING ? "السكرتير لم يُفعَّل بعد (جدول الرسائل غير موجود)." : "تعذّر الوصول للرسائل." };
  if ((count ?? 0) >= settings.dailyLimit) return { ok: false, error: "وصلت حد أسئلة اليوم — يتجدد غداً." };

  const { error: insertError } = await db.from("secretary_messages").insert({ employee_id: employee.id, role: "user", content: question });
  if (insertError) return { ok: false, error: "تعذّر الحفظ." };

  const [briefing, history] = await Promise.all([secretaryBriefing(employee), thread(employee.id, 12)]);
  const context = [
    renderBriefing(employee, briefing),
    "",
    "آخر الحوار بينك وبين الموظف:",
    ...(history ?? []).map((m) => `${m.role === "user" ? "الموظف" : "السكرتير"}: ${m.content.slice(0, 600)}`),
    "",
    `سؤال الموظف الآن: ${question}`,
  ].join("\n");

  let reply = "تعذّر عليّ الرد الآن — جرّب بعد قليل.";
  try {
    const raw = await muradJson("secretary_chat", SECRETARY_SYSTEM, context, SECRETARY_SCHEMA as unknown as Record<string, unknown>);
    const parsed = raw ? (JSON.parse(raw) as { reply?: string }) : null;
    if (parsed?.reply?.trim()) reply = parsed.reply.trim().slice(0, 4000);
  } catch { /* keep the holding reply */ }

  await db.from("secretary_messages").insert({ employee_id: employee.id, role: "secretary", content: reply });
  await logAudit({ action: "secretary.chat", entity: "secretary_messages", entity_id: employee.id, meta: { chars: question.length } });
  const messages = await thread(employee.id);
  return { ok: true, messages: messages ?? [] };
}

/* ---- «مشاهدة الإدارة» (the owner, 2026-10-26): an admin opens any employee's
   secretary READ-ONLY — their day now, their thread, nothing written in their
   name (there is deliberately no admin ask/write verb here). Every open is
   audited with who was viewed. ---- */

const adminAllowed = async () => (await currentCan("dashboard.admin")) || (await currentCan("developer.access"));
const UUID = /^[0-9a-f-]{36}$/i;

/** The picker's list — null hides the whole admin view (not an admin, or view-as an employee). */
export async function adminSecretaryEmployees(): Promise<{ id: string; name: string }[] | null> {
  if (!(await adminAllowed())) return null;
  const { data } = await secretaryDb().from("employees").select("id, arabic_name").eq("status", "Active").order("arabic_name");
  return ((data ?? []) as { id: string; arabic_name: string | null }[]).map((e) => ({ id: e.id, name: e.arabic_name ?? "بلا اسم" }));
}

export type AdminSecretaryView = { ok: true; name: string; today: string; messages: SecretaryMsg[] } | { ok: false; error: string };

export async function adminSecretaryView(employeeId: string): Promise<AdminSecretaryView> {
  if (!(await adminAllowed())) return { ok: false, error: "لا صلاحية" };
  if (typeof employeeId !== "string" || !UUID.test(employeeId)) return { ok: false, error: "قيمة غير صالحة" };
  const db = secretaryDb();
  const { data } = await db.from("employees").select("id, arabic_name, teletel_agent_id, telegram_chat_id").eq("id", employeeId).maybeSingle();
  const e = data as { id: string; arabic_name: string | null; teletel_agent_id: number | string | null; telegram_chat_id: number | string | null } | null;
  if (!e) return { ok: false, error: "موظف غير موجود" };
  const employee: SecretaryEmployee = {
    id: e.id,
    name: e.arabic_name ?? "",
    agentId: e.teletel_agent_id == null ? null : Number(e.teletel_agent_id),
    chatId: e.telegram_chat_id == null ? null : Number(e.telegram_chat_id),
  };
  const [briefing, messages] = await Promise.all([secretaryBriefing(employee).catch(() => null), thread(employee.id)]);
  await logAudit({ action: "secretary.admin_view", entity: "secretary_messages", entity_id: employee.id, meta: { name: employee.name } });
  return {
    ok: true,
    name: employee.name || "بلا اسم",
    today: briefing ? planText(employee, briefing) : "تعذّر قراءة بيانات يومه الآن.",
    messages: messages ?? [],
  };
}
