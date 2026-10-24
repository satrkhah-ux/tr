import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listTeletelTeams, teletelGet } from "@/lib/providers/teletel";
import { responsesJson } from "@/lib/providers/openai";
import type { MuradControl } from "./control";
import { readControl, readScope, storeControl } from "./control-store";
import { applyActions, describe, isRefusal, isUndo, READING_SCHEMA, readingPrompt, toActions, type Named, type Reading, type Scope } from "./instructions";
import { trainOn } from "./lessons";

/** «preview»: the management asks to see the answer now — the reception answers `question` (null: the trial's last one) as a client's */
export type Instructed = { kind: "decision" | "lesson" | "train" | "undo" | "reset" | "unclear" | "preview"; reply: string; ok: boolean; question?: string | null };
type Source = { text: string; source: "page" | "whatsapp"; phone?: string | null; authorId?: string | null };
type State = { control: MuradControl; scope: Scope };

/**
 * One management instruction (instructions.ts says what it may do): read, applied, recorded in murad_instructions,
 * and answered with what changed. Null: a message from a management number written as a client's — a trial, which
 * the reception answers as it would any client (reception-run.ts).
 */
export async function instruct(service: SupabaseClient, input: Source): Promise<Instructed | null> {
  const text = input.text.trim();
  const [control, scope] = await Promise.all([readControl(service), readScope(service)]);
  const before: State = { control, scope };
  const record = (row: Record<string, unknown>) =>
    service.from("murad_instructions").insert({ source: input.source, phone: input.phone ?? null, author_id: input.authorId ?? null, text: text.slice(0, 4000), ...row }).select("id").maybeSingle();

  // «11223344»: a new trial — the reception reads the visit from here (its own murad_log reason). On its own line among
  // others («لا» then the code, read as one, 2026-10-24): the rest is done first, then the trial starts
  const isCode = (t: string) => Boolean(control.resetCode) && t.replace(/\D/g, "") === control.resetCode && /^[\d\s]+$/.test(t);
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (input.source === "whatsapp" && lines.some(isCode)) {
    const rest = lines.filter((l) => !isCode(l)).join("\n");
    const first = rest ? await instruct(service, { ...input, text: rest }) : null;
    const reply = [first?.kind === "preview" ? null : first?.reply, "بدأنا تجربة جديدة ✅ اكتب لي الآن كأنك عميل."].filter(Boolean).join("\n\n");
    await record({ kind: "reset", reply });
    return { kind: "reset", reply, ok: true };
  }

  // «لا» right after a lesson is that lesson refused (the owner's test, 2026-10-24: a question was saved as a lesson)
  const { data: lastRow } = await service.from("murad_instructions").select("kind, status, created_at").eq("phone", input.phone ?? "").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const prev = lastRow as { kind: string; status: string | null; created_at: string } | null;
  const refusesLesson = prev?.kind === "lesson" && prev.status === "applied" && Date.now() - Date.parse(prev.created_at) < 30 * 60_000 && isRefusal(text);
  if (isUndo(text) || refusesLesson) {
    // the last applied decision or lesson, whichever is newer
    const { data } = await service.from("murad_instructions").select("id, kind, before, reply").in("kind", ["decision", "lesson"]).eq("status", "applied").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const last = data as { id: string; kind: string; before: State | null; reply: string | null } | null;
    if (last?.kind === "lesson") {
      const { error } = await service.from("murad_lessons").update({ active: false }).eq("instruction_id", last.id);
      const reply = error ? "تعذّر حذف الدرس الآن — أعد المحاولة بعد قليل." : `حذفت آخر درس ✅ ولن أستعمله.${last.reply ? `\n${last.reply.split("\n").filter((l) => /^(إذا|أرد):/u.test(l)).join("\n")}` : ""}`;
      if (!error) await service.from("murad_instructions").update({ status: "undone", undone_at: new Date().toISOString() }).eq("id", last.id);
      await record({ kind: "undo", status: error ? "failed" : undefined, reply });
      return { kind: "undo", reply, ok: !error };
    }
    if (!last?.before) {
      const reply = "لا يوجد قرار إداري أتراجع عنه.";
      await record({ kind: "undo", status: "not_understood", reply });
      return { kind: "undo", reply, ok: false };
    }
    if (!(await storeControl(service, last.before, before, `murad_instruction_undo:${last.id}`))) {
      const reply = "تعذّر التراجع الآن — أعد المحاولة بعد قليل.";
      await record({ kind: "undo", status: "failed", reply });
      return { kind: "undo", reply, ok: false };
    }
    await service.from("murad_instructions").update({ status: "undone", undone_at: new Date().toISOString() }).eq("id", last.id);
    const reply = `تراجعت عن آخر قرار ✅${last.reply ? `\n${last.reply.split("\n").filter((l) => l.startsWith("•")).join("\n")}` : ""}`;
    await record({ kind: "undo", before, after: last.before, reply });
    return { kind: "undo", reply, ok: true };
  }

  const [teams, agentsRaw] = await Promise.all([listTeletelTeams(), teletelGet<Named[]>("/agents")]);
  const ctx = { teams: teams.map((t) => ({ id: t.id, name: t.name })), agents: Array.isArray(agentsRaw) ? agentsRaw.map((a) => ({ id: a.id, name: a.name })) : [] };
  let reading: Reading;
  try {
    reading = (await responsesJson("murad_instruction", READING_SCHEMA, [{ type: "input_text", text: readingPrompt(text, ctx) }], process.env["OPENAI_FOLLOWUP_MODEL"] || "gpt-5.5")) as Reading;
  } catch {
    const reply = "تعذّر عليّ قراءة الأمر الآن — أعد إرساله بعد دقيقة.";
    await record({ kind: "unclear", status: "failed", reply });
    return { kind: "unclear", reply, ok: false };
  }

  if (reading.type === "client") {
    if (input.source === "whatsapp") return null;
    const reply = "هذه تبدو رسالة عميل، لا قراراً إدارياً. جرّبها من رقم الإدارة على واتساب.";
    await record({ kind: "unclear", status: "not_understood", reply });
    return { kind: "unclear", reply, ok: false };
  }

  if (reading.type === "preview" && input.source === "whatsapp") {
    await record({ kind: "preview", reply: null });
    return { kind: "preview", reply: "", ok: true, question: reading.lesson_question?.trim() || null };
  }

  if (reading.type === "lesson" && reading.lesson_answer?.trim()) {
    const { data: row } = await record({ kind: "lesson", reply: null });
    const { error } = await service.from("murad_lessons").insert({ source: "teaching", kind: reading.lesson_kind, question: reading.lesson_question?.trim() || null, answer: reading.lesson_answer.trim(), instruction_id: (row as { id: string } | null)?.id ?? null });
    const reply = error ? "تعذّر حفظ الدرس — أعد إرساله." : `تعلّمت ✅${reading.lesson_question ? `\nإذا: ${reading.lesson_question.trim()}` : ""}\nأرد: ${reading.lesson_answer.trim()}`;
    if (row) await service.from("murad_instructions").update({ reply, status: error ? "failed" : "applied" }).eq("id", (row as { id: string }).id);
    return { kind: "lesson", reply, ok: !error };
  }

  if (reading.type === "train" && reading.conversation_id) {
    const { data: row } = await record({ kind: "train", reply: null });
    const n = await trainOn(service, reading.conversation_id, (row as { id: string } | null)?.id ?? null).catch(() => null);
    const reply = n === null ? `تعذّر عليّ قراءة المحادثة ${reading.conversation_id}.` : n === 0 ? `قرأت المحادثة ${reading.conversation_id} ولم أجد فيها ما يُتعلّم.` : `تدرّبت على المحادثة ${reading.conversation_id} ✅ — ${n} ${n > 2 && n < 11 ? "دروس" : "درس"}.`;
    if (row) await service.from("murad_instructions").update({ reply, status: n ? "applied" : "failed" }).eq("id", (row as { id: string }).id);
    return { kind: "train", reply, ok: Boolean(n) };
  }

  const actions = reading.type === "decision" ? toActions(reading, ctx) : [];
  const next = actions.length ? applyActions(control, scope, actions) : null;
  if (!next) {
    const reply = reading.ask_back?.trim() || "لم أفهم المطلوب بثقة — وضّح لي: ماذا أغيّر، ولأي قسم أو موظف؟";
    await record({ kind: "unclear", status: "not_understood", reply });
    return { kind: "unclear", reply, ok: false };
  }
  if (!(await storeControl(service, next, before, `murad_instruction:${input.source}`))) {
    const reply = "فهمت القرار وتعذّر حفظه — أعد المحاولة بعد قليل.";
    await record({ kind: "decision", status: "failed", actions, reply });
    return { kind: "decision", reply, ok: false };
  }
  const reply = ["تم ✅ قرار إداري:", ...actions.map((a) => `• ${describe(a, ctx)}`), "للتراجع اكتب: تراجع"].join("\n");
  await record({ kind: "decision", actions, before, after: next, reply });
  return { kind: "decision", reply, ok: true };
}
