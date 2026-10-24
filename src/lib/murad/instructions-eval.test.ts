import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { READING_SCHEMA, readingPrompt, toActions, type Reading } from "./instructions";

/** INSTR_EVAL=1 npx vitest run src/lib/murad/instructions-eval.test.ts — the model on the owner's own kinds of order. */
const on = process.env["INSTR_EVAL"] === "1";
const key = on ? (process.env["OPENAI_API_KEY"] ?? readFileSync(".env.local", "utf8").match(/^OPENAI_API_KEY=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, "")) : undefined;
const ctx = { agents: [{ id: 7, name: "ريموندا" }, { id: 9, name: "رشا" }, { id: 12, name: "محمد اسكندر" }, { id: 15, name: "اكرم الحريبي" }], teams: [{ id: 1, name: "فيزا" }, { id: 38, name: "المبيعات" }, { id: 28, name: "متابعة المبيعات" }] };
async function read(text: string): Promise<Reading> {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: process.env["OPENAI_FOLLOWUP_MODEL"] || "gpt-5.5", input: [{ role: "user", content: [{ type: "input_text", text: readingPrompt(text, ctx) }] }], text: { format: { type: "json_schema", name: "murad_instruction", schema: READING_SCHEMA, strict: true } }, reasoning: { effort: "low" } }),
  });
  const data = (await res.json()) as { output?: { content?: { type: string; text?: string }[] }[] };
  return JSON.parse(data.output?.flatMap((o) => o.content ?? []).find((c) => c.type === "output_text")?.text ?? "{}");
}
it.skipIf(!on)("reads the owner's orders", { timeout: 300_000 }, async () => {
  const cases: [string, (r: Reading) => boolean][] = [
    ["لا تستلم اي طلب يخص التأشيرات", (r) => r.type === "decision" && toActions(r, ctx).some((a) => a.do === "kind_mode" && a.kind === "تأشيرات" && a.mode === "off")],
    ["عليك التوقف عن الارسال الى رشا", (r) => toActions(r, ctx).some((a) => a.do === "pause" && a.agentId === 9)],
    ["ارسل الرسائل المتاخرة الى ريموندا اذا ما رد احد خلال 10 دقائق", (r) => toActions(r, ctx).some((a) => a.do === "late" && a.agentId === 7 && a.minutes === 10)],
    ["اذا سألك العميل عن التقسيط قل له متاح عبر تابي وتمارا", (r) => r.type === "lesson" && Boolean(r.lesson_answer?.includes("تابي"))],
    ["تدرب على المحادثة 40317", (r) => r.type === "train" && r.conversation_id === 40317],
    ["السلام عليكم ابي بكج تركيا لشخصين", (r) => r.type === "client"],
    ["حول طلبات الطيران لاكرم", (r) => toActions(r, ctx).some((a) => a.do === "route" && a.kind === "طيران" && a.agentId === 15)],
  ];
  const fails: string[] = [];
  for (const [text, ok] of cases) {
    const r = await read(text);
    if (!ok(r)) fails.push(`${text} → ${JSON.stringify(r)}`);
  }
  expect(fails).toEqual([]);
});
