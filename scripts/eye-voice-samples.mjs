// Render the SAME opening line in several voices so the choice is made by ear.
// Usage: node scripts/eye-voice-samples.mjs [outDir]
//
// A TTS engine can't be trained, but it can be chosen and directed. The delivery
// instructions here are the same ones src/lib/eye/voice.ts sends, so a sample
// sounds like the real briefing rather than a demo.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.error("OPENAI_API_KEY is missing from .env.local");
  process.exit(1);
}

const outDir = process.argv[2] ?? join(root, "voice-samples");
mkdirSync(outDir, { recursive: true });

const DELIVERY = [
  "تحدّث بالعربية بلهجة سعودية عامية (نجدية) طبيعية تماماً، مثل موظف سعودي يكلّم مديره في نهاية الدوام.",
  "النبرة: هادئة، واثقة، ودودة، فيها شيء من الابتسامة — لا نبرة نشرة أخبار، ولا إلقاء رسمي، ولا حماس إعلاني.",
  "الإيقاع: متوسط إلى بطيء قليلاً، مع أنفاس طبيعية ووقفة واضحة عند نهاية كل سطر، ووقفة أطول قبل الملاحظات.",
  "نوّع التنغيم بين الجمل ولا تقرأها بنبرة واحدة؛ اخفض الصوت قليلاً في الجمل التوضيحية بين الشرطتين.",
  "انطق الأرقام والأسماء العربية بوضوح وعلى سجيّتها، ولا تتقن الإعراب — الكلام محكيّ لا مقروء.",
].join(" ");

// A real slice of the briefing: greeting, a number, a hedge, and a bad finding.
const SAMPLE = [
  "هلا والله. معك عين الإدارة، وهذا وضع الشركة اليوم.",
  "بالنسبة للحضور، ما أحد فتح النظام اليوم من اثنا عشر موظف — وهذا يقيس فتح النظام بس، يمكن يكونون شغّالين على الجوال.",
  "وخمسة طلبات للحين بدون رد، وأطول تأخير كان ثلاثة وعشرين يوم تقريباً على «استفسار عن الأسعار».",
  "هذا كل شي. لو تبي تفاصيل أي نقطة اسألني.",
].join("\n");

// The steerable voices only — the older fixed ones ignore `instructions`, which
// is the whole reason the first attempt sounded electronic.
const VOICES = ["ash", "ballad", "verse", "sage", "coral"];

for (const voice of VOICES) {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts",
      voice,
      input: SAMPLE,
      response_format: "mp3", // for listening on a laptop; Telegram gets opus
      speed: 0.95,
      instructions: DELIVERY,
    }),
  });
  if (!res.ok) {
    console.log(`${voice}: FAILED ${res.status} ${(await res.text()).slice(0, 120)}`);
    continue;
  }
  const file = join(outDir, `eye-${voice}.mp3`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  console.log(`${voice}: ${file}`);
}

console.log(`\nاختر واحداً، وضع اسمه في OPENAI_TTS_VOICE في .env.local وفي .env على الخادم.`);
