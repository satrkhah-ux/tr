import "server-only";
import { createElement } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/data/audit";
import { notifyEmployee } from "@/lib/notifications/notify";
import { listTeletelTeams, teamMembers } from "@/lib/providers/teletel";
import { openaiJson } from "@/lib/providers/openai";
import { renderDocHtml } from "@/lib/offer-doc/html";
import { documentToPng, offerDocumentToPdf } from "@/lib/offer-doc/pdf";
import { AdminDecisionDocument } from "@/components/offer-doc/AdminDecisionDocument";
import {
  escapeHtml,
  staffSend,
  staffSendPhoto,
} from "@/lib/telegram/staff-bot";
import {
  audienceEmpty,
  audienceLabel,
  dueReminders,
  expandAudience,
  inventedNumbers,
  letterEntry,
  officeDecision,
  parseAudience,
  parseSettings,
  SETTINGS_KEY,
  splitTitle,
  type ArchiveEntry,
  type Audience,
  type DecisionSettings,
  type Named,
  type Person,
} from "./core";

/**
 * «القرارات الإدارية» — the register's server half: drafts, issue, delivery («تنبيهاتي» + the bell), «استلمت», the daily
 * reminders, the archive and the office screens' reader. The callers (the bot: telegram/staff-decree.ts; the system:
 * data/admin-decisions.ts) check who is asking BEFORE they call: this module trusts its caller.
 */

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
const riyadh = { timeZone: "Asia/Riyadh" } as const;
export const dateText = (iso: string | number) =>
  new Date(iso).toLocaleDateString("en-GB", riyadh);
export const dateTimeText = (iso: string | number) =>
  `${dateText(iso)} ${new Date(iso).toLocaleTimeString("en-GB", { ...riyadh, hour: "2-digit", minute: "2-digit" })}`;

export type DecisionRow = {
  id: string;
  serial: string | null;
  status: "draft" | "issued";
  kind: string;
  title: string;
  original_text: string;
  final_text: string;
  audience: Audience;
  audience_label: string;
  ai_worded: boolean;
  created_by: string | null;
  issued_by_name: string | null;
  created_at: string;
  issued_at: string | null;
};
const COLS =
  "id, serial, status, kind, title, original_text, final_text, audience, audience_label, ai_worded, created_by, issued_by_name, created_at, issued_at";

export type RecipientRow = {
  decision_id: string;
  employee_id: string;
  name: string;
  chat_id: number | null;
  message_id: number | null;
  delivered_at: string | null;
  opened_at: string | null;
  acknowledged_at: string | null;
  ack_via: "bot" | "web" | null;
  reminded_at: string | null;
  reminders: number;
};
const R_COLS =
  "decision_id, employee_id, name, chat_id, message_id, delivered_at, opened_at, acknowledged_at, ack_via, reminded_at, reminders";

export async function loadSettings(): Promise<DecisionSettings> {
  const { data } = await db()
    .from("app_settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle();
  return parseSettings((data as { value?: string } | null)?.value);
}

export async function saveSettings(
  s: DecisionSettings,
  actor: { id: string; name: string },
): Promise<void> {
  const clean = parseSettings(JSON.stringify(s));
  await db()
    .from("app_settings")
    .upsert({
      key: SETTINGS_KEY,
      value: JSON.stringify(clean),
      updated_at: new Date().toISOString(),
    });
  await logAudit({
    action: "admin_decision.settings_saved",
    entity: "app_settings",
    entity_id: SETTINGS_KEY,
    meta: clean,
    actor: { id: actor.id, label: actor.name },
  });
}

// ---------- who can be addressed ----------

export type Directory = {
  people: (Person & { chatId: number | null })[];
  roles: Named[];
  teams: Named[];
};

/** the active employees, the roles that have any, and the Teletel teams — what a decision may be addressed to */
export async function directory(): Promise<Directory> {
  const [{ data: emps }, { data: roles }, teams] = await Promise.all([
    db()
      .from("employees")
      .select("id, arabic_name, role_id, teletel_agent_id, telegram_chat_id")
      .eq("status", "Active"),
    db().from("roles").select("id, arabic_name"),
    listTeletelTeams().catch(() => []),
  ]);
  const people = (
    (emps ?? []) as {
      id: string;
      arabic_name: string;
      role_id: string | null;
      teletel_agent_id: number | null;
      telegram_chat_id: number | string | null;
    }[]
  ).map((e) => ({
    id: e.id,
    name: e.arabic_name.trim(),
    roleId: e.role_id,
    agentId: e.teletel_agent_id,
    chatId:
      e.telegram_chat_id != null && Number(e.telegram_chat_id)
        ? Number(e.telegram_chat_id)
        : null,
  }));
  const used = new Set(people.map((p) => p.roleId));
  return {
    people: people.sort((a, b) => a.name.localeCompare(b.name, "ar")),
    roles: ((roles ?? []) as { id: string; arabic_name: string }[])
      .filter((r) => used.has(r.id))
      .map((r) => ({ id: r.id, name: r.arabic_name.trim() })),
    teams: teams.map((t) => ({ id: t.id, name: t.name })),
  };
}

/** the exact employees now, and the «إلى» line; null when a Teletel team could not be read (never «nobody» by accident) */
export async function resolveAudience(
  a: Audience,
  dir?: Directory,
): Promise<{ people: { id: string; name: string }[]; label: string } | null> {
  const d = dir ?? (await directory());
  const teamAgents = new Map<number, number[]>();
  for (const t of a.all ? [] : (a.teams ?? [])) {
    const members = await teamMembers(t).catch(() => null);
    if (!members) return null;
    teamAgents.set(
      t,
      members.map((m) => m.id),
    );
  }
  return {
    people: expandAudience(a, d.people, teamAgents),
    label: audienceLabel(a, {
      roles: d.roles,
      teams: d.teams,
      people: d.people,
    }),
  };
}

// ---------- drafts ----------

export async function getDecision(id: string): Promise<DecisionRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await db()
    .from("admin_decisions")
    .select(COLS)
    .eq("id", id)
    .maybeSingle();
  return data
    ? {
        ...(data as DecisionRow),
        audience: parseAudience((data as DecisionRow).audience),
      }
    : null;
}

export async function createDraft(
  by: string,
  kind: string,
): Promise<string | null> {
  const { data } = await db()
    .from("admin_decisions")
    .insert({
      kind: kind.slice(0, 40),
      title: kind.slice(0, 200),
      created_by: by,
    })
    .select("id")
    .single();
  return (data as { id: string } | null)?.id ?? null;
}

/** only a draft changes; an issued decision is the record */
export async function updateDraft(
  id: string,
  patch: Partial<
    Pick<
      DecisionRow,
      | "kind"
      | "title"
      | "original_text"
      | "final_text"
      | "audience"
      | "audience_label"
      | "ai_worded"
    >
  >,
): Promise<DecisionRow | null> {
  const { data } = await db()
    .from("admin_decisions")
    .update(patch)
    .eq("id", id)
    .eq("status", "draft")
    .select(COLS)
    .maybeSingle();
  return data
    ? {
        ...(data as DecisionRow),
        audience: parseAudience((data as DecisionRow).audience),
      }
    : null;
}

/** «✖️ إلغاء»: a draft only — an issued decision stays in the register */
export async function deleteDraft(id: string): Promise<void> {
  if (/^[0-9a-f-]{36}$/i.test(id))
    await db()
      .from("admin_decisions")
      .delete()
      .eq("id", id)
      .eq("status", "draft");
}

/** the issuer's own text: the title from its first line when it is a heading, printed as written */
export async function setDraftText(
  id: string,
  text: string,
): Promise<DecisionRow | null> {
  const d = await getDecision(id);
  if (!d || d.status !== "draft") return null;
  const clean = text.trim().slice(0, 6000);
  const { title, body } = splitTitle(clean, d.kind);
  return updateDraft(id, {
    original_text: clean,
    final_text: body,
    title: title.slice(0, 200),
    ai_worded: false,
  });
}

export type Wording =
  { ok: true; draft: DecisionRow } | { ok: false; error: string };

/**
 * «✍️ اكتب صياغة مناسبة»: formal Arabic from the cheap model (openaiJson: the AI budget's door), never a fact the issuer
 * did not write — a wording that brings a number of its own is refused, and the issuer keeps their text.
 */
export async function wordDraft(id: string): Promise<Wording> {
  const d = await getDecision(id);
  if (!d || d.status !== "draft" || !d.original_text)
    return { ok: false, error: "اكتب نص القرار أولاً." };
  let raw: string | null = null;
  try {
    raw = await openaiJson({
      name: "admin_decision_draft",
      system: [
        "أنت كاتب إداري في شركة ترافليون للسفر والسياحة.",
        "أعد صياغة القرار الإداري الذي كتبته الإدارة بالعربية الفصحى الرسمية، بجمل واضحة مختصرة.",
        "لا تضف أي معلومة أو رقم أو تاريخ أو اسم أو مبلغ أو عقوبة أو موعد غير موجود في النص، ولا تحذف شيئاً منه، ولا تغيّر معناه.",
        "إن كان النص ناقصاً فاتركه ناقصاً — لا تكمله من عندك.",
        "لا تكتب التحية ولا الختام ولا التوقيع ولا الترويسة: تُضاف آلياً.",
        "العنوان: سطر واحد قصير (أقل من 12 كلمة) يلخّص القرار من النص نفسه.",
      ].join("\n"),
      user: `نوع القرار: ${d.kind}\n\nنص الإدارة:\n${d.original_text}`,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["title", "body"],
        properties: { title: { type: "string" }, body: { type: "string" } },
      },
      temperature: 0.2,
      timeoutMs: 30_000,
    });
  } catch (error) {
    const m = error instanceof Error ? error.message : "";
    return {
      ok: false,
      error:
        m === "not_configured"
          ? "الصياغة الآلية غير مفعّلة في النظام."
          : m === "ai_budget_exhausted"
            ? "انتهت ميزانية الذكاء الاصطناعي لليوم."
            : "تعذّرت الصياغة الآن — جرّب بعد دقيقة أو اعتمد نصك.",
    };
  }
  let out: { title?: unknown; body?: unknown } = {};
  try {
    out = JSON.parse(raw ?? "{}") as typeof out;
  } catch {
    out = {};
  }
  const title =
    typeof out.title === "string" ? out.title.trim().slice(0, 200) : "";
  const body =
    typeof out.body === "string" ? out.body.trim().slice(0, 6000) : "";
  if (!title || !body)
    return {
      ok: false,
      error: "لم تأتِ صياغة صالحة — جرّب مرة أخرى أو اعتمد نصك.",
    };
  const invented = inventedNumbers(d.original_text, `${title}\n${body}`);
  if (invented.length)
    return {
      ok: false,
      error: `الصياغة أضافت ما لم تكتبه (${invented.join("، ")}) فلم تُعتمد — جرّب مرة أخرى أو اعتمد نصك.`,
    };
  const draft = await updateDraft(id, {
    title,
    final_text: body,
    ai_worded: true,
  });
  return draft
    ? { ok: true, draft }
    : { ok: false, error: "صدر القرار أو حُذف." };
}

/** «↩️ النص الأصلي»: back to what the issuer wrote */
export async function restoreOriginal(id: string): Promise<DecisionRow | null> {
  const d = await getDecision(id);
  return d?.original_text ? setDraftText(id, d.original_text) : d;
}

// ---------- the document ----------

export async function decisionHtml(
  d: DecisionRow,
  o: {
    copy?: { name: string; acknowledgedAt: string | null };
    recipients?: RecipientRow[];
    issuerName?: string;
  } = {},
): Promise<string> {
  return renderDocHtml((assets) =>
    createElement(AdminDecisionDocument, {
      serial: d.serial,
      kind: d.kind,
      title: d.title,
      body: d.final_text,
      audience: d.audience_label || "—",
      date: dateText(d.issued_at ?? Date.now()),
      issuer: d.issued_by_name ?? o.issuerName ?? "الإدارة",
      copy: o.copy
        ? {
            name: o.copy.name,
            acknowledgedAt: o.copy.acknowledgedAt
              ? dateTimeText(o.copy.acknowledgedAt)
              : null,
          }
        : undefined,
      recipients: o.recipients?.map((r) => ({
        name: r.name,
        deliveredAt: r.delivered_at,
        acknowledgedAt: r.acknowledged_at
          ? dateTimeText(r.acknowledged_at)
          : null,
      })),
      assets,
    }),
  );
}

export const decisionPng = async (d: DecisionRow, issuerName?: string) =>
  documentToPng(await decisionHtml(d, { issuerName }));
export const decisionPdf = async (
  d: DecisionRow,
  o: Parameters<typeof decisionHtml>[1] = {},
) => offerDocumentToPdf(await decisionHtml(d, o));

// ---------- issue and delivery ----------

const ACK = (id: string) => [{ text: "✅ استلمت", callback_data: `zy:${id}` }];
const slotOf = (d: { id: string }) => `decision:${d.id}`;
const caption = (d: DecisionRow) =>
  [
    `📜 <b>قرار إداري ${escapeHtml(d.serial ?? "")} — ${escapeHtml(d.kind)}</b>`,
    escapeHtml(d.title),
    "",
    "اقرأه ثم اضغط «✅ استلمت»: يُحفظ إقرارك في النظام توقيعاً إلكترونياً.",
  ].join("\n");

async function deliverOne(
  d: DecisionRow,
  r: RecipientRow,
  chatId: number | null,
  png: Uint8Array,
): Promise<boolean> {
  if (!chatId) return false;
  const sent = await staffSendPhoto(
    chatId,
    png,
    caption(d),
    [ACK(d.id)],
    slotOf(d),
  );
  if (!sent.ok) return false;
  await db()
    .from("admin_decision_recipients")
    .update({
      delivered_at: new Date().toISOString(),
      chat_id: chatId,
      message_id: sent.messageId,
    })
    .eq("decision_id", d.id)
    .eq("employee_id", r.employee_id)
    .is("delivered_at", null);
  return true;
}

const bell = (
  d: DecisionRow,
  employeeId: string,
  dedupe: string,
  again = false,
) =>
  notifyEmployee({
    employeeId,
    kind: "decision",
    title: `${again ? "⏰ تذكير: " : "📜 "}قرار إداري ${d.serial ?? ""} — ${d.kind}`,
    body: `${d.title}${again ? " — لم تضغط «استلمت» بعد" : ""}`,
    href: `/my-decisions?d=${d.id}`,
    source: "decisions",
    dedupeKey: dedupe,
  });

/**
 * Deliver to the bot what is not delivered yet (one picture for all; the bell rang at issue). `budgetMs` keeps a big
 * audience inside the request; what is left goes with the next minute's tick.
 */
async function deliverPending(
  d: DecisionRow,
  budgetMs = 35_000,
): Promise<{ delivered: number; noTelegram: number }> {
  const started = Date.now();
  const [{ data }, dir] = await Promise.all([
    db()
      .from("admin_decision_recipients")
      .select(R_COLS)
      .eq("decision_id", d.id),
    directory(),
  ]);
  const rows = (data ?? []) as RecipientRow[];
  let png: Uint8Array | null = null;
  let delivered = 0;
  let noTelegram = 0;
  for (const r of rows) {
    if (r.delivered_at || r.acknowledged_at) continue;
    const chatId =
      dir.people.find((p) => p.id === r.employee_id)?.chatId ?? null;
    if (!chatId) {
      noTelegram += 1;
      continue;
    }
    if (Date.now() - started > budgetMs) continue;
    png ??= await decisionPng(d);
    if (await deliverOne(d, r, chatId, png)) delivered += 1;
  }
  return { delivered, noTelegram };
}

export type IssueResult =
  | {
      ok: true;
      serial: string;
      recipients: number;
      delivered: number;
      noTelegram: number;
    }
  | { ok: false; error: string };

/** the audience expanded now, the number taken with the recipients (admin_decision_issue: once, under the year's lock), then delivered */
export async function issueDecision(
  id: string,
  by: { id: string; name: string },
): Promise<IssueResult> {
  const d = await getDecision(id);
  if (!d) return { ok: false, error: "لم أجد هذا القرار." };
  if (d.status === "issued")
    return { ok: false, error: `صدر القرار ${d.serial} من قبل.` };
  if (!d.final_text.trim()) return { ok: false, error: "القرار بلا نص." };
  if (audienceEmpty(d.audience))
    return { ok: false, error: "اختر لمن يصدر القرار." };
  const who = await resolveAudience(d.audience);
  if (!who)
    return {
      ok: false,
      error: "تعذّر قراءة فرق تيلي تيل الآن — جرّب بعد دقيقة.",
    };
  if (!who.people.length)
    return { ok: false, error: "لا يوجد موظف نشط ضمن من اخترت." };
  await db()
    .from("admin_decisions")
    .update({ audience_label: who.label })
    .eq("id", id)
    .eq("status", "draft");
  const { data: serial, error } = await db().rpc("admin_decision_issue", {
    p_id: id,
    p_by: by.id,
    p_by_name: by.name,
    p_recipients: who.people,
  });
  if (error) return { ok: false, error: "تعذّر إصدار القرار — جرّب مرة أخرى." };
  // null: a second tap (or the other channel) issued it first
  if (typeof serial !== "string")
    return { ok: false, error: "صدر القرار من قبل." };
  await logAudit({
    action: "admin_decision.issued",
    entity: "admin_decisions",
    entity_id: id,
    meta: {
      serial,
      kind: d.kind,
      recipients: who.people.length,
      audience: d.audience,
      ai_worded: d.ai_worded,
    },
    actor: { id: by.id, label: by.name },
  });
  const issued = (await getDecision(id))!;
  for (const p of who.people) await bell(issued, p.id, `decision:${id}`);
  const sent = await deliverPending(issued);
  return { ok: true, serial, recipients: who.people.length, ...sent };
}

// ---------- «استلمت» ----------

/** theirs only, once — whichever of the bot and the system comes first */
export async function acknowledge(
  decisionId: string,
  employee: { id: string; name: string },
  via: "bot" | "web",
): Promise<RecipientRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(decisionId)) return null;
  const now = new Date().toISOString();
  const { data } = await db()
    .from("admin_decision_recipients")
    .update({ acknowledged_at: now, ack_via: via })
    .eq("decision_id", decisionId)
    .eq("employee_id", employee.id)
    .is("acknowledged_at", null)
    .select(R_COLS)
    .maybeSingle();
  const row = data as RecipientRow | null;
  if (!row) return null;
  await db()
    .from("admin_decision_recipients")
    .update({ opened_at: now })
    .eq("decision_id", decisionId)
    .eq("employee_id", employee.id)
    .is("opened_at", null);
  await logAudit({
    action: "admin_decision.acknowledged",
    entity: "admin_decisions",
    entity_id: decisionId,
    meta: { via },
    actor: { id: employee.id, label: employee.name },
  });
  return row;
}

export async function markOpened(
  decisionId: string,
  employeeId: string,
): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(decisionId)) return;
  await db()
    .from("admin_decision_recipients")
    .update({ opened_at: new Date().toISOString() })
    .eq("decision_id", decisionId)
    .eq("employee_id", employeeId)
    .is("opened_at", null);
}

export async function recipientsOf(
  decisionId: string,
): Promise<RecipientRow[]> {
  const { data } = await db()
    .from("admin_decision_recipients")
    .select(R_COLS)
    .eq("decision_id", decisionId)
    .order("name");
  return (data ?? []) as RecipientRow[];
}

export async function recipientOf(
  decisionId: string,
  employeeId: string,
): Promise<RecipientRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(decisionId)) return null;
  const { data } = await db()
    .from("admin_decision_recipients")
    .select(R_COLS)
    .eq("decision_id", decisionId)
    .eq("employee_id", employeeId)
    .maybeSingle();
  return data as RecipientRow | null;
}

/** «📄 اعرض القرار» from a reminder: the picture again, in its slot */
export async function resendTo(
  decisionId: string,
  employeeId: string,
  chatId: number,
): Promise<boolean> {
  const [d, r] = await Promise.all([
    getDecision(decisionId),
    recipientOf(decisionId, employeeId),
  ]);
  if (!d || d.status !== "issued" || !r) return false;
  await markOpened(decisionId, employeeId);
  const sent = await staffSendPhoto(
    chatId,
    await decisionPng(d),
    caption(d),
    r.acknowledged_at ? [] : [ACK(d.id)],
    slotOf(d),
  );
  return sent.ok;
}

// ---------- the minute job ----------

/**
 * Every fifth minute: a decision of the last week not yet in someone's bot (they joined since, or the issue ran out of
 * time) goes now; once a day from the settings' hour, whoever has not pressed «استلمت» is reminded in the bot and the bell.
 */
export async function decisionsTick(
  nowMs = Date.now(),
): Promise<{ delivered: number; reminded: number } | null> {
  if (Math.floor(nowMs / 60_000) % 5 !== 3) return null;
  const s = await loadSettings();
  const since = new Date(
    nowMs - Math.max(7, s.remindDays) * 86_400_000,
  ).toISOString();
  const { data, error } = await db()
    .from("admin_decisions")
    .select(COLS)
    .eq("status", "issued")
    .gte("issued_at", since);
  // 42P01: the tables are not there yet — nothing to do
  if (error || !data?.length) return null;
  let delivered = 0;
  let reminded = 0;
  for (const raw of data as DecisionRow[]) {
    const d = { ...raw, audience: parseAudience(raw.audience) };
    const rows = await recipientsOf(d.id);
    if (rows.some((r) => !r.delivered_at && !r.acknowledged_at))
      delivered += (await deliverPending(d, 20_000)).delivered;
    const due = dueReminders(
      d.issued_at!,
      rows.map((r) => ({
        employeeId: r.employee_id,
        chatId: r.chat_id,
        deliveredAt: r.delivered_at,
        acknowledgedAt: r.acknowledged_at,
        remindedAt: r.reminded_at,
        reminders: r.reminders,
      })),
      nowMs,
      s,
    );
    for (const r of due) {
      const row = rows.find((x) => x.employee_id === r.employeeId)!;
      // claimed first: two ticks never remind twice the same day
      const { data: claimed } = await db()
        .from("admin_decision_recipients")
        .update({
          reminded_at: new Date(nowMs).toISOString(),
          reminders: row.reminders + 1,
        })
        .eq("decision_id", d.id)
        .eq("employee_id", r.employeeId)
        .eq("reminders", row.reminders)
        .is("acknowledged_at", null)
        .select("employee_id");
      if (!claimed?.length) continue;
      const day = new Date(nowMs + 3 * 3600_000).toISOString().slice(0, 10);
      await bell(d, r.employeeId, `decision:${d.id}:remind:${day}`, true);
      if (r.chatId)
        await staffSend(
          r.chatId,
          `⏰ <b>تذكير: القرار الإداري ${escapeHtml(d.serial ?? "")}</b>\n${escapeHtml(d.title)}\n\nلم تضغط «✅ استلمت» بعد. اقرأه واضغط «استلمت» ليُحفظ إقرارك.`,
          [
            [
              { text: "📄 اعرض القرار", callback_data: `zs:${d.id}` },
              ...ACK(d.id),
            ],
          ],
          {},
          `remind:${d.id}`,
        );
      reminded += 1;
    }
  }
  return delivered || reminded ? { delivered, reminded } : null;
}

// ---------- the archive ----------

export type DecisionSummary = DecisionRow & { recipients: RecipientRow[] };

/** every issued decision with its recipients, newest first — the administration's */
export async function issuedDecisions(limit = 300): Promise<DecisionSummary[]> {
  const { data } = await db()
    .from("admin_decisions")
    .select(COLS)
    .eq("status", "issued")
    .order("issued_at", { ascending: false })
    .limit(limit);
  const list = ((data ?? []) as DecisionRow[]).map((d) => ({
    ...d,
    audience: parseAudience(d.audience),
  }));
  if (!list.length) return [];
  const { data: rs } = await db()
    .from("admin_decision_recipients")
    .select(R_COLS)
    .in(
      "decision_id",
      list.map((d) => d.id),
    );
  const rows = (rs ?? []) as RecipientRow[];
  return list.map((d) => ({
    ...d,
    recipients: rows
      .filter((r) => r.decision_id === d.id)
      .sort((a, b) => a.name.localeCompare(b.name, "ar")),
  }));
}

/** the archive's lines: each decision's copy to each employee, and the sales letters — `employeeId` narrows the read to one */
export async function archiveEntries(
  employeeId?: string,
): Promise<ArchiveEntry[]> {
  let rq = db()
    .from("admin_decision_recipients")
    .select(
      `${R_COLS}, admin_decisions!inner(serial, kind, title, issued_at, issued_by_name)`,
    );
  let lq = db()
    .from("staff_letters")
    .select(
      "id, employee_id, number, warned, issued_at, delivered, signed_at, employees(arabic_name)",
    );
  if (employeeId) {
    rq = rq.eq("employee_id", employeeId);
    lq = lq.eq("employee_id", employeeId);
  }
  const [{ data: rs }, { data: ls }] = await Promise.all([rq, lq]);
  type Joined = RecipientRow & {
    admin_decisions: {
      serial: string;
      kind: string;
      title: string;
      issued_at: string;
      issued_by_name: string | null;
    };
  };
  const decisions = ((rs ?? []) as unknown as Joined[]).map(
    (r): ArchiveEntry => ({
      ref: r.decision_id,
      source: "decision",
      serial: r.admin_decisions.serial,
      kind: r.admin_decisions.kind,
      title: r.admin_decisions.title,
      issuedAt: r.admin_decisions.issued_at,
      issuer: r.admin_decisions.issued_by_name ?? "الإدارة",
      employeeId: r.employee_id,
      name: r.name,
      deliveredAt: r.delivered_at,
      openedAt: r.opened_at,
      acknowledgedAt: r.acknowledged_at,
    }),
  );
  type LetterJoined = Parameters<typeof letterEntry>[0] & {
    employees: { arabic_name: string } | null;
  };
  const letters = ((ls ?? []) as unknown as LetterJoined[]).map((l) =>
    letterEntry(l, l.employees?.arabic_name?.trim() ?? "—"),
  );
  return [...decisions, ...letters];
}

/**
 * «قرار الإدارة» for the office screens (session D's ticker): the newest decision addressed to everyone in the last two
 * weeks, never a warning — its serial, kind, title and the first lines of its text. Null when there is none.
 */
export async function latestOfficeDecision(
  nowMs = Date.now(),
): Promise<{
  serial: string;
  kind: string;
  title: string;
  text: string;
  issuedAt: string;
} | null> {
  const since = new Date(nowMs - 14 * 86_400_000).toISOString();
  const { data, error } = await db()
    .from("admin_decisions")
    .select(COLS)
    .eq("status", "issued")
    .gte("issued_at", since)
    .order("issued_at", { ascending: false })
    .limit(20);
  if (error || !data) return null;
  const pick = officeDecision(
    (data as DecisionRow[]).map((d) => ({
      ...d,
      audience: parseAudience(d.audience),
      issuedAt: d.issued_at!,
    })),
    nowMs,
  );
  return pick
    ? {
        serial: pick.serial!,
        kind: pick.kind,
        title: pick.title,
        text: pick.final_text.slice(0, 280),
        issuedAt: pick.issuedAt,
      }
    : null;
}
