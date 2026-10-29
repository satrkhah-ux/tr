import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { asSystem } from "@/lib/supabase/system-actor";
import { managerSnapshot, type ManagerSnapshot } from "@/lib/manager-screen/snapshot";
import { agentSummaries, listOpenConversations, teletelGet } from "@/lib/providers/teletel";
import { presenceOnlineAgentIds } from "@/lib/routing/presence";
import { getVisaBoard } from "@/lib/data/visa-files";
import { buildOpsDigest } from "./ops-digest";
import { siteUrl, type InlineButton } from "./ops-bot";
import { escapeHtml, type StaffMember } from "./staff-bot";
import { riyadhDayStart, waitText } from "./staff-numbers";
import { colleagues, isBotManager } from "./staff-manager";
import {
  ADMIN_TITLE,
  BACK_ADMIN,
  DAY_BUTTONS,
  dayText,
  minutesWord,
  moneyText,
  opsVisaText,
  parseFace,
  systemText,
  teamText,
  type Face,
  type MemberRow,
  type OpsFacts,
  type PanelFacts,
  type VisaFacts,
} from "./staff-admin-core";

/**
 * «🏢 لوحة الإدارة» — the server side of staff-admin-core: who may see it (the
 * bot's managers, checked again on every press, as in staff-manager.ts), what it
 * reads (the manager screen's own snapshot, the operations digest, the visa
 * board — nothing computed twice), and the face a manager chose last.
 * Reads only; the only write is that choice (app_settings).
 */

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
type View = { text: string; buttons: InlineButton[][] };
const REFUSED: View = { text: "هذا للإدارة فقط.", buttons: [] };
const FACE_KEY = (employeeId: string) => `staffbot_face:${employeeId}`;

export async function faceOf(employeeId: string): Promise<Face> {
  const { data } = await db().from("app_settings").select("value").eq("key", FACE_KEY(employeeId)).maybeSingle();
  return parseFace((data as { value?: string } | null)?.value);
}

export async function setFace(employeeId: string, face: Face): Promise<void> {
  await db()
    .from("app_settings")
    .upsert({ key: FACE_KEY(employeeId), value: face, updated_at: new Date().toISOString() });
}

/** «💰 المال والتحصيل»: the administration's own (dashboard.admin) or the developer's, not every bot manager */
export async function seesMoney(employeeId: string): Promise<boolean> {
  const ask = (key: string) => db().rpc("followup_employee_can", { p_employee: employeeId, p_key: key });
  const [admin, dev] = await Promise.all([ask("dashboard.admin"), ask("developer.access")]);
  return admin.data === true || dev.data === true;
}

// ---------- what the screens read ----------

const snapshot = (): Promise<ManagerSnapshot | null> => asSystem({ name: "تنبيهاتي", can: ["dashboard.admin"] }, () => managerSnapshot()).catch(() => null);

function panelsOf(s: ManagerSnapshot): PanelFacts {
  return Object.fromEntries(
    s.panels.map((p) => [
      p.key,
      { status: p.status, tiles: Object.fromEntries(p.tiles.map((t) => [t.key, { label: t.label, value: t.value, reason: t.reason, status: t.status }])) },
    ]),
  );
}

async function opsFacts(): Promise<OpsFacts | null> {
  try {
    const d = await buildOpsDigest(5, { all: true });
    return {
      liveCases: d.liveCases,
      needsAction: d.needsAction,
      critical: d.critical,
      travelSoon: d.travelSoon,
      travelIncomplete: d.travelIncomplete,
      unpaid: d.unpaid,
      urgent: d.urgent,
    };
  } catch {
    return null;
  }
}

async function visaFacts(): Promise<VisaFacts | null> {
  const r = await asSystem({ name: "تنبيهاتي", can: ["visas.manage"] }, () => getVisaBoard()).catch(() => null);
  if (!r?.ok) return null;
  const c = r.board.counts;
  const s = c.byStatus;
  return {
    open: s.new + s.collecting + s.ready + s.submitted,
    byStatus: { new: s.new, collecting: s.collecting, ready: s.ready, submitted: s.submitted, approved: s.approved },
    replyOverdue: c.replyOverdue,
    actionDue: c.actionDue,
    missingDocs: c.missingDocs,
    toDeliver: c.toDeliver,
    unpaid: c.unpaid,
  };
}

const UNREADABLE: View = { text: "تعذّرت قراءة لوحة الإدارة الآن — جرّب بعد دقيقة.", buttons: [[BACK_ADMIN]] };

// ---------- the screens ----------

export async function dayView(me: StaffMember): Promise<View> {
  if (!(await isBotManager(me.id))) return REFUSED;
  const [s, ops, visas] = await Promise.all([snapshot(), opsFacts(), visaFacts()]);
  if (!s) return UNREADABLE;
  return {
    text: dayText({
      overall: s.overall,
      panels: panelsOf(s),
      longestWaitMin: s.channel.waiting.longest,
      urgent: s.urgent.length,
      watch: s.watch.length,
      ops,
      visas,
      nowMs: Date.now(),
      waitText,
    }),
    buttons: DAY_BUTTONS,
  };
}

export async function adminTeamView(me: StaffMember): Promise<View> {
  if (!(await isBotManager(me.id))) return REFUSED;
  const nowMs = Date.now();
  const nowSec = nowMs / 1000;
  const [list, people, today, agents, inSystem, s] = await Promise.all([
    listOpenConversations(),
    colleagues(),
    agentSummaries(riyadhDayStart(nowMs), Math.floor(nowSec)),
    teletelGet<{ id?: number; name?: string | null; availability_status?: string | null }[]>("/agents"),
    presenceOnlineAgentIds(),
    snapshot(),
  ]);
  if (!list) return { text: "تعذّر الوصول إلى تيلي تيل الآن — جرّب بعد دقيقة.", buttons: [[BACK_ADMIN]] };
  const teletel = new Map((agents ?? []).filter((a) => typeof a.id === "number").map((a) => [a.id as number, a]));
  // the manager screen's own reading of today (rules.ts teamToday): presence, and the first-reply average from the conversation history
  const day = new Map((s?.channel.agents.list ?? []).map((a) => [a.name, a]));
  const all: MemberRow[] = people
    .filter((p) => p.agentId)
    .map((p) => {
      const agent = p.agentId as number;
      const open = list.rows.filter((c) => c.assigneeId === agent);
      const waiting = open.filter((c) => c.waitingSince > 0);
      const t = teletel.get(agent);
      const seen = t?.name ? day.get(t.name) : undefined;
      // «فاتح النظام = متصل» (presence-equals-online): the system open counts as online
      const st = t?.availability_status;
      const presence: MemberRow["presence"] =
        seen?.presence ?? (inSystem.has(agent) || st === "online" ? "online" : st === "busy" ? "busy" : agents ? "offline" : null);
      return {
        id: p.id,
        name: escapeHtml(p.name.trim()),
        presence,
        open: open.length,
        waiting: waiting.length,
        oldestMin: waiting.length ? Math.floor((nowSec - Math.min(...waiting.map((c) => c.waitingSince))) / 60) : null,
        firstReplyMin: seen?.avg ?? null,
        resolved: today?.get(agent)?.resolved ?? 0,
      };
    })
    .sort((a, b) => b.waiting - a.waiting || b.open - a.open);
  // nothing open and not online: nothing to look at
  const rows = all.filter((x) => x.open || x.presence === "online" || x.presence === "busy");
  return {
    text: teamText(rows, waitText, all.length - rows.length),
    buttons: [
      ...rows.map((x) => [{ text: `${x.name.slice(0, 22)} — ${x.waiting} منتظرة`, callback_data: `e:${x.id}` }]),
      [
        { text: "🔄 تحديث", callback_data: "at" },
        { text: "📄 الخطابات", callback_data: "lt" },
        { text: "🕘 الدوام", callback_data: "sh" },
      ],
      // reassigning stays in the system for now (Teletel writes are not the bot's)
      [{ text: "🔀 إعادة التوزيع في «المتابعة»", url: `${siteUrl()}/followups` }],
      [BACK_ADMIN],
    ],
  };
}

export async function performanceView(me: StaffMember): Promise<View> {
  if (!(await isBotManager(me.id))) return REFUSED;
  const nowMs = Date.now();
  const [s, people, today, agents] = await Promise.all([
    snapshot(),
    colleagues(),
    agentSummaries(riyadhDayStart(nowMs), Math.floor(nowMs / 1000)),
    teletelGet<{ id?: number; name?: string | null }[]>("/agents"),
  ]);
  const p = s ? panelsOf(s) : {};
  const nameOf = new Map((agents ?? []).filter((a) => typeof a.id === "number").map((a) => [a.id as number, a.name ?? ""]));
  const day = new Map((s?.channel.agents.list ?? []).map((a) => [a.name, a]));
  const rows = people
    .filter((x) => x.agentId)
    .map((x) => {
      const r = today?.get(x.agentId as number);
      const seen = day.get(nameOf.get(x.agentId as number) ?? "");
      return {
        name: escapeHtml(x.name.trim()),
        conversations: r?.conversations ?? 0,
        resolved: r?.resolved ?? 0,
        replies: seen?.replies ?? 0,
        avg: seen?.avg ?? null,
      };
    })
    .filter((x) => x.conversations || x.replies || x.resolved)
    .sort((a, b) => b.conversations + b.replies - (a.conversations + a.replies));
  return {
    text: [
      "📈 <b>الأداء والأهداف</b>",
      "",
      `أول رد للفريق اليوم: ${p.team?.tiles.team_reply?.value ?? "—"} · ${p.team?.tiles.team_open?.value ?? "—"} مفتوحة مع الفريق`,
      `تأكد اليوم: ${p.sales?.tiles.confirmed?.value ?? "—"} · صدر: ${p.sales?.tiles.issued?.value ?? "—"}`,
      "",
      "<b>اليوم لكل موظف</b>",
      ...(rows.length
        ? rows.map(
            (x) =>
              `${x.name} — ${x.conversations} محادثة · ${x.resolved} أُغلقت${x.replies ? ` · ردّ أولاً على ${x.replies}${x.avg !== null ? ` بمتوسط ${minutesWord(x.avg)}` : ""}` : ""}`,
          )
        : ["لا محادثات عمل عليها أحد اليوم بعد."]),
      "",
      "أهداف الشهر وما تحقق منها في «🎯 أهداف الشهر».",
    ].join("\n"),
    buttons: [
      [
        { text: "🎯 أهداف الشهر", callback_data: "tg" },
        { text: "🔄 تحديث", callback_data: "ap" },
      ],
      [BACK_ADMIN],
    ],
  };
}

export async function moneyView(me: StaffMember): Promise<View> {
  if (!(await isBotManager(me.id)) || !(await seesMoney(me.id))) return { text: "«المال والتحصيل» للإدارة العليا فقط.", buttons: [[BACK_ADMIN]] };
  const [s, ops, visas] = await Promise.all([snapshot(), opsFacts(), visaFacts()]);
  if (!s) return UNREADABLE;
  return {
    text: moneyText(panelsOf(s), ops, visas),
    buttons: [
      [
        { text: "🔄 تحديث", callback_data: "am" },
        { text: "💳 التدفق النقدي", url: `${siteUrl()}/operations/cashflow` },
      ],
      [BACK_ADMIN],
    ],
  };
}

export async function opsVisaView(me: StaffMember): Promise<View> {
  if (!(await isBotManager(me.id))) return REFUSED;
  const [ops, visas] = await Promise.all([opsFacts(), visaFacts()]);
  return {
    text: opsVisaText(ops, visas, escapeHtml),
    buttons: [
      [
        { text: "📂 العمليات", url: `${siteUrl()}/operations` },
        { text: "🛂 التأشيرات", url: `${siteUrl()}/visa-files` },
      ],
      [{ text: "🔄 تحديث", callback_data: "ao" }, BACK_ADMIN],
    ],
  };
}

export async function systemView(me: StaffMember): Promise<View> {
  if (!(await isBotManager(me.id))) return REFUSED;
  const s = await snapshot();
  if (!s) return UNREADABLE;
  return {
    text: systemText(panelsOf(s)),
    buttons: [[{ text: "🔄 تحديث", callback_data: "as" }, BACK_ADMIN]],
  };
}

/** «🔔 نبّه موظفاً»: whom — then the existing write → preview → confirm (staff-manager promptFor) */
export async function alertPickView(me: StaffMember): Promise<View> {
  if (!(await isBotManager(me.id))) return REFUSED;
  const people = (await colleagues()).filter((p) => p.chatId && p.id !== me.id).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  return {
    text: "🔔 <b>نبّه موظفاً</b>\n\nاختر الموظف، ثم اكتب التنبيه. تراه قبل الإرسال وتؤكده.",
    buttons: [
      ...chunk(
        people.map((p) => ({ text: p.name.trim().slice(0, 20), callback_data: `a:${p.id}` })),
        2,
      ),
      [BACK_ADMIN],
    ],
  };
}

const chunk = <T>(xs: T[], n: number): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** what /start says to a manager on the administration's face */
export const ADMIN_WELCOME = (name: string) =>
  [
    ADMIN_TITLE,
    "",
    `أهلاً ${escapeHtml(name)}.`,
    "هذه واجهة الإدارة: أرقام اليوم، والفريق، والقرارات، والعمليات، والنظام.",
    "ابدأ بـ «🏢 لوحة اليوم».",
    "",
    "تعمل على محادثات بنفسك؟ «👤 واجهة الموظف» تفتح شاشتك ومحادثاتك، و«🏢 واجهة الإدارة» تعيدك.",
  ].join("\n");

/** «🕘 الدوام»: who works their own shift (employee_shifts) — everyone else works the office's hours */
export async function shiftsView(me: StaffMember): Promise<View> {
  if (!(await isBotManager(me.id))) return REFUSED;
  const { activeShift } = await import("@/lib/presence/shift");
  const { hoursText, parseHours } = await import("@/lib/murad/reception");
  const { SETTING } = await import("@/lib/murad/core");
  const today = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
  const [{ data: rows }, people, { data: office }] = await Promise.all([
    db().from("employee_shifts").select("employee_id, hours, starts_on, ends_on, note").or(`ends_on.is.null,ends_on.gte.${today}`),
    colleagues(),
    db().from("app_settings").select("value").eq("key", SETTING.receptionHours).maybeSingle(),
  ]);
  const list = (rows ?? []) as { employee_id: string; hours: string; starts_on: string; ends_on: string | null; note: string }[];
  const lines = people
    .map((p) => {
      const mine = list.filter((r) => r.employee_id === p.id);
      const now = activeShift(mine, today);
      const next = now ? null : [...mine].sort((a, b) => a.starts_on.localeCompare(b.starts_on))[0];
      const r = now ?? next;
      return r
        ? `• <b>${escapeHtml(p.name.trim())}</b> — ${escapeHtml(r.hours)}${now ? "" : ` (يبدأ ${r.starts_on})`}${r.ends_on ? ` حتى ${r.ends_on}` : ""}${r.note ? ` · ${escapeHtml(r.note)}` : ""}`
        : null;
    })
    .filter((l): l is string => l !== null);
  return {
    text: [
      "🕘 <b>الدوام</b>",
      "",
      `دوام المكتب: ${escapeHtml(hoursText(parseHours((office as { value?: string } | null)?.value)))}`,
      "",
      lines.length ? "<b>دوام خاص:</b>" : "كل الموظفين على دوام المكتب.",
      ...lines,
      "",
      "يُعدَّل من النظام: «الموظفين ← الحضور والإجازات».",
    ].join("\n"),
    buttons: [[{ text: "↩️ الفريق", callback_data: "at" }, BACK_ADMIN]],
  };
}
