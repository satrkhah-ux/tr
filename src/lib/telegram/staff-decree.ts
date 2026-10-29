import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  acknowledge,
  createDraft,
  dateTimeText,
  decisionPng,
  deleteDraft,
  directory,
  getDecision,
  issueDecision,
  issuedDecisions,
  loadSettings,
  recipientOf,
  recipientsOf,
  resendTo,
  resolveAudience,
  setDraftText,
  updateDraft,
  restoreOriginal,
  wordDraft,
  type DecisionRow,
  type Directory,
} from "@/lib/decisions/decisions";
import { audienceEmpty, tally, toggleAudience } from "@/lib/decisions/core";
import {
  escapeHtml,
  staffCall,
  staffSend,
  staffSendPhoto,
  type StaffMember,
} from "./staff-bot";
import { isBotManager } from "./staff-manager";
import type { InlineButton } from "./ops-bot";

/**
 * «📜 إصدار قرار» in «تنبيهاتي» (the owner, 2026-10-29): the kind → whom (everyone, departments, Teletel teams, people)
 * → the text → «✍️ اكتب صياغة مناسبة» or «اعتمد النص كما هو» → the branded document as a picture → «أصدر». The draft
 * row carries every step (decisions.ts), so the buttons hold only its id. «📜 القرارات» follows each one: delivered,
 * acknowledged, who is left.
 *
 * Every step checks the bot's management first (isBotManager) — a button is not an authorisation; only «✅ استلمت»
 * (zy) and «📄 اعرض القرار» (zs) are the recipient's own, and they touch nothing but their own copy.
 *
 * Callback data: z + a letter, then the draft's id (Telegram's 64 bytes hold a uuid and a short pick).
 */

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
type View = { text: string; buttons: InlineButton[][] };
const REFUSED: View = { text: "هذا للإدارة فقط.", buttons: [] };
const GONE: View = {
  text: "لم أجد هذه المسودة — ربما صدرت أو أُلغيت.",
  buttons: [[{ text: "📜 القرارات", callback_data: "zl" }]],
};
const LIST: InlineButton = { text: "📜 القرارات", callback_data: "zl" };
const cancel = (id: string): InlineButton => ({
  text: "✖️ إلغاء",
  callback_data: `zc:${id}`,
});
const PENDING_KIND = "admin_decision";

/** «📜 إصدار قرار»: what kind */
export async function decreeHome(me: StaffMember): Promise<View> {
  if (!(await isBotManager(me.id))) return REFUSED;
  const { kinds } = await loadSettings();
  return {
    text: [
      "📜 <b>إصدار قرار إداري</b>",
      "",
      "اختر نوع القرار. بعدها: لمن يصدر، ثم نصه، ثم تراه بهوية ترافليون قبل الإصدار.",
    ].join("\n"),
    buttons: [
      ...chunk(
        kinds.map((k, i) => ({ text: k, callback_data: `zk:${i}` })),
        3,
      ),
      [LIST],
    ],
  };
}

function chunk<T>(list: T[], n: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < list.length; i += n) rows.push(list.slice(i, i + n));
  return rows;
}

/** the picks so far and how many employees they are now */
async function audienceView(
  d: DecisionRow,
  dir: Directory,
  list: "h" | "r" | "m" | "e",
): Promise<View> {
  const a = d.audience;
  const who = audienceEmpty(a)
    ? { people: [], label: "" }
    : await resolveAudience(a, dir);
  const mark = (on: boolean | undefined) => (on ? "✅ " : "");
  const head = [
    `📜 <b>${escapeHtml(d.kind)}</b> — لمن يصدر؟`,
    "",
    who
      ? who.people.length
        ? `إلى: ${escapeHtml(who.label)}\nعددهم الآن: <b>${who.people.length}</b>`
        : "لم تختر أحداً بعد."
      : "⚠️ تعذّر قراءة فرق تيلي تيل الآن.",
    "",
    "اختر واحداً أو أكثر، ثم «التالي».",
  ].join("\n");
  const sections: InlineButton[][] = [
    [{ text: `${mark(a.all)}👥 جميع الموظفين`, callback_data: `zg:${d.id}:a` }],
    [
      { text: "🏷️ الأقسام", callback_data: `zt:${d.id}:r` },
      { text: "💬 فرق تيلي تيل", callback_data: `zt:${d.id}:m` },
      { text: "👤 موظفون", callback_data: `zt:${d.id}:e` },
    ],
  ];
  const picks: InlineButton[][] =
    list === "r"
      ? chunk(
          dir.roles.map((r, i) => ({
            text: `${mark(a.roles?.includes(String(r.id)))}${r.name}`,
            callback_data: `zg:${d.id}:r${i}`,
          })),
          2,
        )
      : list === "m"
        ? chunk(
            dir.teams.map((t) => ({
              text: `${mark(a.teams?.includes(Number(t.id)))}${t.name}`,
              callback_data: `zg:${d.id}:m${t.id}`,
            })),
            2,
          )
        : list === "e"
          ? chunk(
              dir.people.map((p, i) => ({
                text: `${mark(a.employees?.includes(p.id))}${p.name}`,
                callback_data: `zg:${d.id}:e${i}`,
              })),
              2,
            )
          : [];
  return {
    text: head,
    buttons: [
      ...(list === "h"
        ? sections
        : [...picks, [{ text: "↩️ رجوع", callback_data: `zt:${d.id}:h` }]]),
      [
        ...(who?.people.length
          ? [
              {
                text: `التالي ➡️ (${who.people.length})`,
                callback_data: `zx:${d.id}`,
              },
            ]
          : []),
        cancel(d.id),
      ],
    ],
  };
}

/** the text as it will print, and what to do with it */
function textView(d: DecisionRow, note?: string): View {
  const body =
    d.final_text.length > 2500
      ? `${d.final_text.slice(0, 2500)}…`
      : d.final_text;
  return {
    text: [
      `📜 <b>${escapeHtml(d.kind)}</b> — ${d.ai_worded ? "الصياغة المقترحة" : "نصك كما كتبته"}`,
      note ? `\n${escapeHtml(note)}` : null,
      "",
      `<b>${escapeHtml(d.title)}</b>`,
      escapeHtml(body),
    ]
      .filter((l) => l !== null)
      .join("\n"),
    buttons: d.ai_worded
      ? [
          [{ text: "✅ اعتمد هذه الصياغة", callback_data: `zp:${d.id}` }],
          [
            { text: "↩️ النص الأصلي", callback_data: `zo:${d.id}` },
            { text: "✏️ اكتب نصاً آخر", callback_data: `zx:${d.id}` },
          ],
          [cancel(d.id)],
        ]
      : [
          [{ text: "✍️ اكتب صياغة مناسبة", callback_data: `zw:${d.id}` }],
          [{ text: "✅ اعتمد النص كما هو", callback_data: `zp:${d.id}` }],
          [
            { text: "✏️ اكتب نصاً آخر", callback_data: `zx:${d.id}` },
            cancel(d.id),
          ],
        ],
  };
}

/** after «التالي»: the manager's next text (within ten minutes) is the decision's text */
async function askText(chatId: number, d: DecisionRow): Promise<void> {
  await db().from("staff_bot_pending").upsert({
    chat_id: chatId,
    kind: PENDING_KIND,
    target_id: null,
    source_key: d.id,
    created_at: new Date().toISOString(),
  });
  await staffSend(
    chatId,
    [
      `✍️ اكتب نص القرار (<b>${escapeHtml(d.kind)}</b>) في رسالة واحدة.`,
      "اجعل السطر الأول عنواناً قصيراً إن أردت، وما بعده نص القرار.",
      "<i>تراه قبل الإصدار، وتختار: صياغة مناسبة أو النص كما هو.</i>",
    ].join("\n"),
    undefined,
    {
      reply_markup: { force_reply: true, input_field_placeholder: "نص القرار" },
    },
  );
}

/** the manager's text arrived (staff-handler, pending «admin_decision») */
export async function decreeText(
  me: StaffMember,
  chatId: number,
  text: string,
  id: string | null,
): Promise<void> {
  if (!(await isBotManager(me.id))) {
    await staffSend(chatId, REFUSED.text);
    return;
  }
  const d = id ? await setDraftText(id, text) : null;
  const v = d ? textView(d) : GONE;
  await staffSend(chatId, v.text, v.buttons);
}

/** the branded picture of the draft, with «أصدر» */
async function preview(
  me: StaffMember,
  chatId: number,
  d: DecisionRow,
): Promise<View | null> {
  const who = await resolveAudience(d.audience);
  if (!who)
    return {
      text: "تعذّر قراءة فرق تيلي تيل الآن — جرّب بعد دقيقة.",
      buttons: [[{ text: "🔄 حاول مجدداً", callback_data: `zp:${d.id}` }]],
    };
  if (!who.people.length) return audienceView(d, await directory(), "h");
  const labelled =
    (await updateDraft(d.id, { audience_label: who.label })) ?? d;
  const png = await decisionPng(labelled, me.name.trim());
  const sent = await staffSendPhoto(
    chatId,
    png,
    `👁️ <b>معاينة — لم يصدر بعد</b>\nيُرقَّم عند الإصدار، ويصل إلى <b>${who.people.length}</b> في «تنبيهاتي» وجرس النظام، كلٌّ مع زر «✅ استلمت».`,
    [
      [{ text: `📜 أصدر (${who.people.length})`, callback_data: `zi:${d.id}` }],
      [{ text: "✏️ عدّل النص", callback_data: `zx:${d.id}` }, cancel(d.id)],
    ],
    "view",
  );
  return sent.ok
    ? null
    : {
        text: "تعذّر إرسال المعاينة — جرّب مرة أخرى.",
        buttons: [[{ text: "🔄 حاول مجدداً", callback_data: `zp:${d.id}` }]],
      };
}

async function issue(
  me: StaffMember,
  chatId: number,
  d: DecisionRow,
  at?: number,
): Promise<View> {
  const r = await issueDecision(d.id, { id: me.id, name: me.name.trim() });
  if (!r.ok) return { text: `⚠️ ${escapeHtml(r.error)}`, buttons: [[LIST]] };
  if (at)
    await staffCall("editMessageCaption", {
      chat_id: chatId,
      message_id: at,
      caption: `✅ صدر القرار ${r.serial}`,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [] },
    });
  return {
    text: [
      `✅ <b>صدر القرار ${escapeHtml(r.serial)}</b>`,
      "",
      `إلى ${r.recipients}: وصل في «تنبيهاتي» إلى ${r.delivered}${r.noTelegram ? `، و${r.noTelegram} بلا تيليجرام (في جرس النظام فقط)` : ""}.`,
      r.recipients - r.delivered - r.noTelegram > 0
        ? "الباقون يصلهم خلال دقائق."
        : null,
      "يُذكَّر من لم يضغط «استلمت» مرة كل يوم.",
    ]
      .filter((l) => l !== null)
      .join("\n"),
    buttons: [
      [{ text: "📋 متابعة القرار", callback_data: `zv:${d.id}` }, LIST],
    ],
  };
}

/** one decision: delivered, acknowledged, and who is left */
async function statusView(id: string): Promise<View> {
  const d = await getDecision(id);
  if (!d || d.status !== "issued") return GONE;
  const rows = await recipientsOf(id);
  const t = tally(
    rows.map((r) => ({
      deliveredAt: r.delivered_at,
      acknowledgedAt: r.acknowledged_at,
    })),
  );
  const left = rows.filter((r) => !r.acknowledged_at);
  return {
    text: [
      `📋 <b>${escapeHtml(d.serial ?? "")} — ${escapeHtml(d.kind)}</b>`,
      escapeHtml(d.title),
      `صدر ${dateTimeText(d.issued_at!)} · ${escapeHtml(d.issued_by_name ?? "")}`,
      "",
      `صدر إلى ${t.issued} · وصل ${t.delivered} · ✅ استلم ${t.acknowledged} · ⏳ بقي ${t.pending}`,
      "",
      ...rows
        .filter((r) => r.acknowledged_at)
        .slice(0, 30)
        .map(
          (r) =>
            `✅ ${escapeHtml(r.name)} — ${dateTimeText(r.acknowledged_at!)}${r.ack_via === "web" ? " (النظام)" : ""}`,
        ),
      ...left
        .slice(0, 30)
        .map(
          (r) =>
            `${r.delivered_at ? "⏳" : "⚠️"} ${escapeHtml(r.name)}${r.delivered_at ? "" : " — لم يصله في تيليجرام"}`,
        ),
    ].join("\n"),
    buttons: [[{ text: "🔄 تحديث", callback_data: `zv:${id}` }, LIST]],
  };
}

async function listView(): Promise<View> {
  const list = (await issuedDecisions(10)).map((d) => ({
    d,
    t: tally(
      d.recipients.map((r) => ({
        deliveredAt: r.delivered_at,
        acknowledgedAt: r.acknowledged_at,
      })),
    ),
  }));
  return {
    text: [
      "📜 <b>القرارات الإدارية</b> — آخر 10",
      "",
      list.length
        ? list
            .map(
              ({ d, t }) =>
                `${d.serial} · ${escapeHtml(d.kind)} · ${escapeHtml(d.title)}\n   ✅ ${t.acknowledged} من ${t.issued}`,
            )
            .join("\n")
        : "لم يصدر قرار بعد.",
      "",
      "الأرشيف الكامل في النظام: «الموظفين» ← «القرارات».",
    ].join("\n"),
    buttons: [
      ...list.map(({ d, t }) => [
        {
          text: `${d.serial} — ✅ ${t.acknowledged}/${t.issued}`,
          callback_data: `zv:${d.id}`,
        },
      ]),
      [{ text: "📜 إصدار قرار", callback_data: "zn" }],
    ],
  };
}

/**
 * Every «z» button. A view comes back to be shown in place (null: this step sent its own message). The recipient's two
 * come first and touch their own copy only; everything else is the management's.
 */
export async function decreeCallback(
  me: StaffMember,
  chatId: number,
  data: string,
  at?: number,
): Promise<View | null> {
  const [op, id = "", pick = ""] = data.split(":");
  if (op === "zy") {
    // a second tap (the picture after the reminder, or the other way round) shows the acknowledgement already stored
    const row =
      (await acknowledge(id, { id: me.id, name: me.name.trim() }, "bot")) ??
      (await recipientOf(id, me.id));
    const d = row?.acknowledged_at ? await getDecision(id) : null;
    if (d && at) {
      const text = `📜 <b>قرار إداري ${escapeHtml(d.serial ?? "")} — ${escapeHtml(d.kind)}</b>\n${escapeHtml(d.title)}\n\n✅ استلمته في ${dateTimeText(row!.acknowledged_at!)} — محفوظ في النظام توقيعاً إلكترونياً منك.`;
      const done = {
        chat_id: chatId,
        message_id: at,
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [] },
      };
      // the picture carries a caption; the reminder is text
      if (
        !(await staffCall("editMessageCaption", { ...done, caption: text })).ok
      )
        await staffCall("editMessageText", { ...done, text });
    }
    return null;
  }
  if (op === "zs") {
    await resendTo(id, me.id, chatId);
    return null;
  }

  if (!(await isBotManager(me.id))) return REFUSED;
  if (op === "zn") return decreeHome(me);
  if (op === "zl") return listView();
  if (op === "zv") return statusView(id);
  if (op === "zk") {
    const kind = (await loadSettings()).kinds[Number(id)];
    const draftId = kind ? await createDraft(me.id, kind) : null;
    const d = draftId ? await getDecision(draftId) : null;
    return d
      ? audienceView(d, await directory(), "h")
      : {
          text: "تعذّر بدء القرار — جرّب مرة أخرى.",
          buttons: [[{ text: "📜 إصدار قرار", callback_data: "zn" }]],
        };
  }

  const d = await getDecision(id);
  if (!d || d.status !== "draft")
    return op === "zi" && d?.status === "issued" ? statusView(id) : GONE;
  if (op === "zc") {
    await deleteDraft(id);
    await db()
      .from("staff_bot_pending")
      .delete()
      .eq("chat_id", chatId)
      .eq("source_key", id);
    return {
      text: "✖️ أُلغيت المسودة — لم يصدر شيء.",
      buttons: [[{ text: "📜 إصدار قرار", callback_data: "zn" }, LIST]],
    };
  }
  if (op === "zt")
    return audienceView(
      d,
      await directory(),
      (["h", "r", "m", "e"] as const).find((x) => x === pick) ?? "h",
    );
  if (op === "zg") {
    const dir = await directory();
    const kind = pick[0];
    const n = Number(pick.slice(1));
    const target =
      kind === "a"
        ? ({ all: true } as const)
        : kind === "r" && dir.roles[n]
          ? { role: String(dir.roles[n].id) }
          : kind === "m" && dir.teams.some((t) => t.id === n)
            ? { team: n }
            : kind === "e" && dir.people[n]
              ? { employee: dir.people[n].id }
              : null;
    const next = target
      ? ((await updateDraft(id, {
          audience: toggleAudience(d.audience, target),
        })) ?? d)
      : d;
    return audienceView(
      next,
      dir,
      kind === "a" ? "h" : (kind as "r" | "m" | "e"),
    );
  }
  if (op === "zx") {
    if (audienceEmpty(d.audience))
      return audienceView(d, await directory(), "h");
    await askText(chatId, d);
    return null;
  }
  if (op === "zw") {
    const r = await wordDraft(id);
    return r.ok ? textView(r.draft) : textView(d, `⚠️ ${r.error}`);
  }
  if (op === "zo") return textView((await restoreOriginal(id)) ?? d);
  if (!d.final_text.trim()) return textView(d, "⚠️ اكتب نص القرار أولاً.");
  if (op === "zp") return preview(me, chatId, d);
  if (op === "zi") return issue(me, chatId, d, at);
  return GONE;
}
