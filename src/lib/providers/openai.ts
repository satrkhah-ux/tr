import "server-only";

/**
 * OpenAI-backed itinerary drafting — writes the «البرنامج اليومي» text.
 *
 * SCOPE, deliberately narrow: the AI writes MARKETING PROSE ONLY (a day title
 * and a few activity lines). It never invents a fact the system can verify —
 * no dates, no cities, no hotels, no prices, no flight times. Those are passed
 * IN as context and re-imposed on the output, so a hallucination cannot reach
 * the client document. Every generated day is flagged `ai_generated` and the
 * agent reviews it before publishing.
 *
 * SERVER-ONLY: the key must never reach the browser. Read at RUNTIME via
 * bracket access so Netlify/VPS pick it up without a rebuild.
 *   OPENAI_API_KEY   required — the feature is simply unavailable without it
 *   OPENAI_MODEL     optional override (defaults below)
 */

const DEFAULT_MODEL = "gpt-4o-mini";

function readEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}

export function isOpenAIConfigured(): boolean {
  return Boolean(readEnv("OPENAI_API_KEY"));
}

/** What the model is told about the trip. All of it is fact from the draft. */
export type ItineraryPromptDay = {
  day_number: number;
  date: string | null;
  city_name: string;
  /** e.g. "وصول" / "مغادرة" — hints the shape of the day without dictating text. */
  marker: "arrival" | "departure" | "full" | null;
};

export type ItineraryRequest = {
  destination: string;
  days: ItineraryPromptDay[];
  /** distinct cities in visit order — keeps the model from inventing new ones. */
  cities: string[];
  adults: number;
  children: number;
};

export type GeneratedDay = {
  day_number: number;
  title: string;
  activities: string[];
};

export type ItineraryResult =
  | { ok: true; days: GeneratedDay[] }
  | { ok: false; error: "not_configured" | "request_failed" | "bad_response"; detail?: string };

const SYSTEM_PROMPT = [
  "أنت كاتب برامج سياحية محترف في وكالة سفر سعودية.",
  "تكتب بالعربية الفصحى المبسّطة، بأسلوب تسويقي راقٍ ومختصر.",
  "",
  "قواعد صارمة:",
  "- اكتب لكل يوم عنوانًا قصيرًا (٣-٦ كلمات) و٢-٤ أنشطة، كل نشاط سطر واحد قصير.",
  "- التزم بالمدينة المعطاة لكل يوم ولا تذكر مدينة أخرى.",
  "- لا تذكر تواريخ ولا أسعار ولا أسماء فنادق ولا أرقام رحلات ولا مواعيد طيران إطلاقًا.",
  "- لا تعِد بما لا يمكن ضمانه (طقس، توفّر، أوقات دقيقة).",
  "- الأماكن التي تذكرها يجب أن تكون معالم مشهورة وحقيقية في تلك المدينة.",
  "- اكتب اسم المعلم كما هو تمامًا، ولا تدمج اسمين في اسم واحد.",
  "  خطأ: «برج خليفة بتروناس» — الصواب: «برجا بتروناس التوأمان».",
  "  إن لم تكن واثقًا من الاسم الدقيق فاكتب وصفًا عامًا بدل اختراع اسم.",
  "- يوم الوصول يكون خفيفًا، ويوم المغادرة يقتصر على الاستعداد والمغادرة.",
].join("\n");

function userPrompt(req: ItineraryRequest): string {
  const lines = [
    `الوجهة: ${req.destination}`,
    `المدن بالترتيب: ${req.cities.join(" ← ")}`,
    `المسافرون: ${req.adults} بالغ${req.children > 0 ? ` و${req.children} طفل` : ""}`,
    "",
    "الأيام:",
    ...req.days.map((d) => {
      const marker = d.marker === "arrival" ? " (يوم الوصول)" : d.marker === "departure" ? " (يوم المغادرة)" : "";
      return `- اليوم ${d.day_number}: ${d.city_name || req.destination}${marker}`;
    }),
  ];
  return lines.join("\n");
}

/** JSON Schema forced on the model — no free-form parsing, no markdown fences. */
const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["days"],
  properties: {
    days: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["day_number", "title", "activities"],
        properties: {
          day_number: { type: "integer" },
          title: { type: "string" },
          activities: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

type ChatResponse = { choices?: { message?: { content?: string } }[] };

/**
 * Keep only days the caller actually asked for, in the caller's order, and
 * trim the text. A model that returns extra days, renumbers them, or pads the
 * activity list cannot corrupt the draft.
 */
export function reconcileDays(requested: ItineraryPromptDay[], generated: GeneratedDay[]): GeneratedDay[] {
  const byNumber = new Map(generated.map((d) => [d.day_number, d]));
  const out: GeneratedDay[] = [];
  for (const day of requested) {
    const hit = byNumber.get(day.day_number);
    if (!hit) continue;
    const title = typeof hit.title === "string" ? hit.title.trim() : "";
    const activities = Array.isArray(hit.activities)
      ? hit.activities.map((a) => (typeof a === "string" ? a.trim() : "")).filter(Boolean).slice(0, 6)
      : [];
    if (!title && activities.length === 0) continue;
    out.push({ day_number: day.day_number, title, activities });
  }
  return out;
}

/** Draft the itinerary text. Never throws — the caller shows the error inline. */
export async function generateItineraryText(req: ItineraryRequest): Promise<ItineraryResult> {
  const key = readEnv("OPENAI_API_KEY");
  if (!key) return { ok: false, error: "not_configured" };
  if (req.days.length === 0) return { ok: true, days: [] };

  let raw: string | undefined;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({
        model: readEnv("OPENAI_MODEL") ?? DEFAULT_MODEL,
        temperature: 0.7,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt(req) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "itinerary", strict: true, schema: RESPONSE_SCHEMA },
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: "request_failed", detail: `${res.status} ${body.slice(0, 200)}` };
    }
    const data = (await res.json()) as ChatResponse;
    raw = data.choices?.[0]?.message?.content ?? undefined;
  } catch (error) {
    return { ok: false, error: "request_failed", detail: error instanceof Error ? error.message : String(error) };
  }

  if (!raw) return { ok: false, error: "bad_response" };
  try {
    const parsed = JSON.parse(raw) as { days?: GeneratedDay[] };
    if (!Array.isArray(parsed.days)) return { ok: false, error: "bad_response" };
    return { ok: true, days: reconcileDays(req.days, parsed.days) };
  } catch {
    return { ok: false, error: "bad_response" };
  }
}
