import "server-only";

/**
 * The voice of «عين الإدارة».
 *
 * Two calls, kept apart on purpose:
 *   speak()   — text → audio. The text is ALWAYS built by script.ts from computed
 *               numbers, so nothing spoken here was written by a model.
 *   discuss() — the only place a model writes anything. It answers management's
 *               own question, and it is handed the computed report as its ONLY
 *               source with an explicit instruction to refuse rather than guess.
 *
 * SERVER-ONLY: the key must never reach a browser. Read at RUNTIME so the VPS
 * picks it up without a rebuild.
 *   OPENAI_API_KEY   required — without it the briefing is sent as text and says so
 *   OPENAI_TTS_MODEL / OPENAI_TTS_VOICE   optional overrides
 */

const DEFAULT_TTS_MODEL = "gpt-4o-mini-tts";
/**
 * `ash`, not `onyx`.
 *
 * onyx is one of the original fixed voices: it renders the words and ignores the
 * delivery you ask for, which in Arabic comes out as the flat, announcer-ish
 * reading that made the first briefing sound like a machine. ash is one of the
 * steerable voices — it actually follows `instructions`, which is the only lever
 * that turns text into a dialect rather than a pronunciation.
 */
const DEFAULT_VOICE = "ash";
/** Slightly under conversational pace. A report is listened to, not skimmed. */
const DEFAULT_SPEED = 0.95;
const DEFAULT_CHAT_MODEL = "gpt-4o-mini";

/**
 * The delivery, described the way you would describe it to a person.
 *
 * This is the part that does the work. A TTS engine cannot be trained here, but
 * it can be directed, and the direction has to be specific: naming the dialect,
 * the room, and the relationship. "Speak Arabic" gets you a newsreader; this
 * gets you a colleague who called at the end of the day.
 */
const DELIVERY = [
  "تحدّث بالعربية بلهجة سعودية عامية (نجدية) طبيعية تماماً، مثل موظف سعودي يكلّم مديره في نهاية الدوام.",
  "النبرة: هادئة، واثقة، ودودة، فيها شيء من الابتسامة — لا نبرة نشرة أخبار، ولا إلقاء رسمي، ولا حماس إعلاني.",
  "الإيقاع: متوسط إلى بطيء قليلاً، مع أنفاس طبيعية ووقفة واضحة عند نهاية كل سطر، ووقفة أطول قبل الملاحظات.",
  "نوّع التنغيم بين الجمل ولا تقرأها بنبرة واحدة؛ اخفض الصوت قليلاً في الجمل التوضيحية بين الشرطتين.",
  "انطق الأرقام والأسماء العربية بوضوح وعلى سجيّتها، ولا تتقن الإعراب — الكلام محكيّ لا مقروء.",
].join(" ");

function readEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

export function isVoiceConfigured(): boolean {
  return Boolean(readEnv("OPENAI_API_KEY"));
}

/**
 * Arabic text → an OGG/opus voice note.
 *
 * opus because that is what Telegram's `sendVoice` wants: any other container
 * arrives as a file attachment rather than a playable waveform, which is a
 * different, worse thing to receive.
 *
 * The instructions field is where the Saudi delivery lives — the words are
 * already Saudi (script.ts); this asks for the pace and warmth to match.
 */
export async function speak(text: string): Promise<Buffer | null> {
  const key = readEnv("OPENAI_API_KEY");
  if (!key) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model: readEnv("OPENAI_TTS_MODEL") ?? DEFAULT_TTS_MODEL,
        voice: readEnv("OPENAI_TTS_VOICE") ?? DEFAULT_VOICE,
        input: text,
        response_format: "opus",
        speed: Number(readEnv("OPENAI_TTS_SPEED") ?? DEFAULT_SPEED),
        instructions: DELIVERY,
      }),
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Answer a question about the day — the ONE place a model speaks for the eye.
 *
 * The report is the entire world: the prompt forbids arithmetic beyond it and
 * forbids inventing a name or a number. Asked something the report cannot
 * answer, it must say so — a watcher that guesses is worse than one that shrugs,
 * because management would act on the guess.
 */
export async function discuss(question: string, reportJson: string): Promise<string | null> {
  const key = readEnv("OPENAI_API_KEY");
  if (!key) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        model: readEnv("OPENAI_MODEL") ?? DEFAULT_CHAT_MODEL,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: [
              "أنت «عين الإدارة»، موظف مراقبة في شركة ترافليون للسفر والسياحة.",
              "تتحدث بالعربية بلهجة سعودية عامية مهذّبة ومختصرة (٣ جمل كحد أقصى).",
              "مصدرك الوحيد هو تقرير اليوم بصيغة JSON المرفق. لا تحسب شيئاً غير موجود فيه،",
              "ولا تخترع اسماً ولا رقماً ولا تاريخاً. إذا كان السؤال لا يُجاب من التقرير،",
              "قل بصراحة: «هذا ما عندي عنه بيانات» واقترح من أين يُعرف.",
              "لا تذكر أرقام جوازات ولا بيانات هوية إطلاقاً.",
            ].join(" "),
          },
          { role: "user", content: `تقرير اليوم:\n${reportJson}\n\nالسؤال: ${question}` },
        ],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return json.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}
