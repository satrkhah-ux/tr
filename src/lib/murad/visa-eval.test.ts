/**
 * «مُراد» on visas measured on real client openings (the owner, 2026-10-23:
 * «اريد ان يصل القسم إلى 95%») — the model reads each case, then the flow
 * decides. Calls OpenAI and reads the live list, so it runs only on demand:
 *   VISA_EVAL=1 npx vitest run src/lib/murad/visa-eval.test.ts
 * Lines starting «م:» are Murad's own earlier message; `asked` = the one
 * question was already asked in this visit.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { loadPlaces } from "@/lib/leads/teletel-pull";
import { readRequest } from "./reception";
import { readVisa } from "./visa-read";
import { VISA_FREE_ASK, visaFacts, visaStep, type VisaCountry, type VisaFacts, type VisaRow } from "./visa";

type Want = "ask" | "advice" | "answer" | "handoff" | "free" | "trip";
type Case = { t: string[]; want: Want | Want[]; country?: string; asked?: boolean; before?: Partial<VisaFacts> };

const FORM = (c: string, n = "_", nat = "_") => `أهلًا، ممكن تفيدوني بتفاصيل أكثر عن تأشيرة (${c})؟ 🌍 - عدد المتقدمين: ${n} - الجنسية: ${nat} - أي طلبات أو تفاصيل إضافية:`;
const CASES: Case[] = [
  // the real openings, 120 visa conversations of Oct 2026 (Teletel)
  { t: [FORM("تأشيرة تركيا السياحية للمقيمين")], want: "ask", country: "تركيا" },
  { t: ["السلام عليكم", "ممكن اسال عن تأشيرات سائق خاص كم رسوم", "وكم تستغرق مدة ختى تصدر التاشيرة"], want: "ask" },
  { t: ["السلام عليكم", "انا يمني مقيم في السعودية ابغا تأشيرة للبحرين تطلعون ؟"], want: ["ask", "handoff"], country: "البحرين" },
  { t: ["مرحبا بكم في ترافليون ✈️| احجز بكجات سفر مع ترافليون انا مهتم بـ تأشيرة أمريكا السياحية للسعوديين والمقيمين | ترافليون"], want: "ask", country: "الولايات المتحدة" },
  { t: [FORM("تأشيرة البحرين السياحية"), "عدد المتقدمين 1 الجنسية اليمنية"], want: "handoff", country: "البحرين" },
  { t: ["تاشيره للبحرين", "سياحه", "مقيمين في السعوديه"], want: "ask", country: "البحرين" },
  { t: ["اهلا وسهلا بحضرتك", "أن مقيم مصري الجنسيه مقيم بالسعوديه محتاج تفاصيل عن تاشيره الي تركيا"], want: ["ask", "handoff"], country: "تركيا" },
  { t: ["Assalamu alaikum. I'm a Filipino working in Madinah, Saudi Arabia. I want to visit Dubai for 3 days for tourism. Can you arrange a UAE 30-day single-entry tourist visa for me? Please confirm the total visa fee and requirements"], want: ["answer", "ask"], country: "الإمارات العربية المتحدة" },
  { t: ["السلام عليكوم", "حضرتكوم بتعملو تاشيرة سياحة للسعودية عاوز اعمل تاشيرة سياحة لزوجتي لان اقامتي منتهيه"], want: "handoff" },
  { t: [FORM("تأشيرة البحرين السياحية"), "واحد 1 هندي عبور فقط", "بغرض السفر من البحرين إلى الهند"], want: "handoff" },
  { t: ["اريد تاشيرات سياحية سويسرا"], want: "ask", country: "سويسرا" },
  { t: ["تاشيرة البحرين للمقيم في السعودية"], want: "ask", country: "البحرين" },
  { t: ["مرحبا بكم في ترافليون ✈️| احجز بكجات سفر مع ترافليون انا مهتم بـ تأشيرة تايلاند السياحية الإلكترونية للمقيمين | ترافليون"], want: "ask", country: "تايلاند" },
  { t: ["السلام عليكم", "بحتاج تأشيرة سياحة للدنمارك"], want: "ask", country: "الدنمارك" },
  { t: ["السلام عليكم", "بدي اسالكم، جواز السفر حقي مغربي ومقيم في السعودية، بدي اقدم فيزا لقركزستان", "كم بتاخد وقت ؟"], want: ["ask", "handoff"], country: "قيرغيزستان" },
  { t: ["Test", "السلام عليكم اريد تأشيرة إلى بريطانيا الجنسية سعودي"], want: ["ask", "answer"], country: "المملكة المتحدة" },
  { t: ["انا يمني مقيم اريدتاشيره لماليزيا"], want: ["ask", "handoff"], country: "ماليزيا" },
  { t: ["يمني مقيم في السعوديه العمر اقل من ١٨ بشهرين ارغب تأشيرة سياحة الى مصر"], want: ["ask", "answer"], country: "مصر" },
  { t: ["تقدمو فيزا الشغن؟"], want: "ask" },
  { t: ["انا سوداني اقامتي ستنتهي في 14 ديسمبر القادم .. كم تكلفة التصريح الأمنية والتأشيرة لمصر .. وكم يوم تستغرق ههذ الإجراءات؟"], want: ["ask", "answer"], country: "مصر" },
  { t: ["السلام عليكم ورحمه الله وبركاته هلا يسمح للمقيم اليمني بفيزه لبريطانيا"], want: ["ask", "answer"], country: "المملكة المتحدة" },
  { t: ["عندي فيزا شنغن", "وابي اجددها", "كيف الطريقه", "تقدمون هالخدمه"], want: "ask" },
  { t: ["بسال طريقه تقديم تاشيره عمل لبريطانيا", "او منحه دراسيه"], want: "ask", country: "المملكة المتحدة" },
  { t: ["هل لديكم فيزا على تركيا"], want: "ask", country: "تركيا" },
  { t: ["تأشيرة روسيا مقيم في السعودية يمني الجنسيه"], want: ["ask", "answer"], country: "روسيا" },
  { t: [FORM("تأشيرة الصين السياحية", "1", "أردني") + "لدي خطاب دعوة من احد المصانع بالصين"], want: "answer", country: "الصين" },
  { t: ["ولكن محتاج اعمل تأشيرة أمريكا سياحة", "ومحتاج اعرف اي المطلوب"], want: "ask", country: "الولايات المتحدة" },
  { t: ["سلام عليكم", "اريد تعشيرة تركيا", "من اليمن مقيم في السعودية"], want: ["ask", "handoff"], country: "تركيا" },
  { t: ["تاشيرة الإمارات سياحة عندكم اصدار"], want: "ask", country: "الإمارات العربية المتحدة" },
  { t: ["ابغى تأشيره تركيا انا مصرى مقيم فى السعوديه"], want: ["ask", "handoff"], country: "تركيا" },
  { t: ["السلام عليكم اريد فيزه عمل في الامارات"], want: "ask", country: "الإمارات العربية المتحدة" },
  { t: ["اهلا صباح الخير عندي استفسار هو صح سار في تاشيرة لاسبانيا للسعوديين ولا تكفي الفيزا"], want: ["ask", "answer"], country: "إسبانيا" },
  { t: ["السلام عليكم بكم تسوون تأشيرة لليابان ؟"], want: "ask", country: "اليابان" },
  { t: ["أريد الاستفسار عن تأشيرة شنغن، هل يمكن التقديم على هذه الدول: اليونان - بلغاريا - رومانيا - إيطاليا - إسبانيا أيها أسهل وأسرع موعد؟ وكم نسبة القبول عندكم؟"], want: ["ask", "advice"] },
  { t: ["السلام عليكم", "كم سعر فيزا أستراليا"], want: "ask", country: "أستراليا" },
  { t: ["السلام عليكم", "محتاج تاشيرة زيارة تركيا"], want: "ask", country: "تركيا" },
  { t: ["السلام عليكم ورحمه الله وبركاته انا يمني مقيم في السعوديه واحتاج الى تاشيره سفر الى تركيا هل في ولا لا"], want: ["ask", "handoff"], country: "تركيا" },
  { t: ["تطلعون تاشيرات تركيا"], want: "ask", country: "تركيا" },
  { t: ["مرحبا بكم في ترافليون ✈️| احجز بكجات سفر مع ترافليون انا مهتم بـ تأشيرة أستراليا السياحية - ترافليون للسفر و السياحة"], want: "ask", country: "أستراليا" },
  { t: ["محتاج تاشيره الي اوربا الي ايطاليا او اي مكان مش شرط المكان اهم شي اني اخد تاشيره الي اوربا", "المهنه ساق خاص"], want: ["ask", "advice"] },
  { t: ["السلام عليكم", "عندي عامل احتاج له تأشيرة دخول البحرين", "علشان يسافر من البحرين الى دكا"], want: ["ask", "handoff"] },
  // «أسهل تأشيرة» — the owner's example, 2026-10-23
  { t: ["السلام عليكم", "ابي اسهل تأشيرة"], want: "advice" },
  { t: ["وش اسهل تأشيرة لأي دولة؟", "انا سعودي"], want: "advice" },
  { t: ["ابغى تأشيرة شروطها قليلة", "يمني مقيم"], want: "advice" },
  { t: ["وين ارخص تأشيرة عندكم"], want: "advice" },
  { t: ["عندي استفسار عن التأشيرات", "طب فين دولة نسبة القبول فيها اعلى", "سوداني"], want: "advice" },
  { t: ["أي تأشيرة ما تحتاج كشف حساب؟"], want: "advice" },
  // a Saudi passport and the catalogue's visa-free countries
  { t: ["ابي تأشيرة الامارات", "سعودي", "شخصين"], want: "free", country: "الإمارات العربية المتحدة" },
  { t: ["تأشيرة تايلاند للسعوديين", "انا وزوجتي سعوديين"], want: "free", country: "تايلاند" },
  { t: ["ابي تاشيرة جورجيا", "سعودي", "2"], want: "free", country: "جورجيا" },
  { t: ["تأشيرة فرنسا", "سعودي", "3 اشخاص"], want: "answer", country: "فرنسا" },
  { t: ["كم يوم تطلع تأشيرة بريطانيا", "سعودي", "واحد"], want: "answer", country: "المملكة المتحدة" },
  { t: ["تأشيرة الهند لشخصين", "مصريين"], want: "answer", country: "الهند" },
  { t: ["تأشيرة مصر", "سوداني مقيم", "انا وزوجتي"], want: "answer", country: "مصر" },
  // a request already with the team
  { t: ["السلام عليكم", "وين وصلت تأشيرتي؟ قدمت عندكم الاسبوع الماضي"], want: "handoff" },
  // a trip with it — sales
  { t: ["يعطيكم العافية رحلة نوفمبر فيتنام بكم للفرد وايش يشمل السعر شامل التأشيرة؟"], want: ["trip", "ask"] },
  // after the one question
  { t: ["ابي اسهل تأشيرة", "م: الأقل متطلبات عندنا: الهند، اندونيسيا، تايلاند، روسيا. أي دولة تفضّل؟ وتكرماً الجنسية، وعدد المتقدمين؟", "روسيا، يمني، شخصين"], want: "answer", country: "روسيا", asked: true },
  { t: ["تاشيره عمل لبريطانيا", "م: حياك الله، عشان أجهز لك تفاصيل تأشيرة المملكة المتحدة: تكرماً الجنسية، وعدد المتقدمين؟", "يمني واحد"], want: "handoff", asked: true, before: { country: "المملكة المتحدة", kind: "work" } },
  { t: ["تأشيرة الإمارات", "م: حياك الله، عشان أجهز لك تفاصيل تأشيرة الإمارات العربية المتحدة: تكرماً الجنسية، وعدد المتقدمين؟", "يمني مقيم، واحد"], want: "answer", country: "الإمارات العربية المتحدة", asked: true, before: { country: "الإمارات العربية المتحدة" } },
  // held out — written after the tuning above and run once as they are (2026-10-23)
  { t: ["السلام عليكم", "ابي فيزا لبريطانيا انا وزوجتي", "سعوديين"], want: "answer", country: "المملكة المتحدة" },
  { t: ["كم سعر تأشيرة امريكا للمقيم المصري"], want: ["ask", "answer"], country: "الولايات المتحدة" },
  { t: ["تأشيرة اندونيسيا", "سعودي", "3"], want: "free", country: "اندونيسيا" },
  { t: ["تطلعون لي تأشيرة روسيا؟ انا هندي مقيم"], want: ["ask", "answer"], country: "روسيا" },
  { t: ["ابغى اسهل فيزا اوروبية"], want: ["ask", "advice"] },
  { t: ["هلا", "ابي اسأل عن تاشيرة فرنسا كم تاخذ وقت؟"], want: "ask", country: "فرنسا" },
  { t: ["فيزا تايلند للمقيمين اليمنيين بكم", "شخصين"], want: "answer", country: "تايلاند" },
  { t: ["عندكم تأشيرة سياحية للصين؟", "اردني", "انا وولدي"], want: "answer", country: "الصين" },
  { t: ["ابي تأشيرة عمل في كندا"], want: "ask", country: "كندا" },
  { t: ["ابي اطلع لابوي تأشيرة زيارة للسعودية من مصر"], want: "handoff" },
  { t: ["كم يوم تاخذ تأشيرة الهند؟", "سعودي", "واحد"], want: "answer", country: "الهند" },
  { t: ["وين وصل طلب الفيزا حقي؟"], want: "handoff" },
  { t: ["تأشيرة المغرب", "سعودي"], want: "free", country: "المغرب" },
  { t: ["ابغى تأشيرة شنغن", "سوري", "2"], want: "ask" },
  { t: ["فيزا دبي", "فلبيني", "1"], want: "answer", country: "الإمارات العربية المتحدة" },
  { t: ["أي دولة اقدر اسافر لها بدون فيزا؟", "سعودي"], want: "advice" },
  { t: ["ارخص فيزا اوروبا كم؟"], want: ["ask", "advice"] },
  { t: ["ابغى فيزا ماليزيا", "سوداني", "انا وزوجتي وولدين"], want: "handoff", country: "ماليزيا" },
  { t: ["السلام عليكم ورحمة الله", "حاب استفسر عن فيزا اليابان للسعوديين"], want: ["ask", "handoff"], country: "اليابان" },
  { t: ["ابي رحلة لبريطانيا مع التأشيرة والفندق لشخصين"], want: "trip" },
];

function env() {
  for (const l of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = l.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, "");
  }
}

describe.skipIf(!process.env["VISA_EVAL"])("Murad visa — real openings", () => {
  it("≥ 95% handled right", { timeout: 600_000 }, async () => {
    env();
    const db = createClient(process.env["NEXT_PUBLIC_SUPABASE_URL"]!, process.env["SUPABASE_SERVICE_ROLE_KEY"]!);
    const [{ data: c }, { data: v }, places] = await Promise.all([
      db.from("countries").select("id, arabic_name, iso2, visa_required"),
      db.from("visas").select("country, country_id, visa_type, sell_price, sell_currency, arabic_requirements, status").eq("status", "Active"),
      loadPlaces(db),
    ]);
    const countries = (c ?? []) as VisaCountry[];
    const rows = ((v ?? []) as (VisaRow & { country_id: string | null })[]).map((r) => ({ ...r, sell_price: r.sell_price == null ? null : Number(r.sell_price) }));
    const results = await Promise.all(
      CASES.map(async (k) => {
        const client = k.t.filter((l) => !l.startsWith("م:"));
        const text = client.join("\n");
        const entered = client.some((l) => VISA_FREE_ASK.test(l) || readRequest(l, places).kind === "تأشيرات");
        const a = await readVisa(k.t.map((l) => (l.startsWith("م:") ? `مُراد: ${l.slice(2).trim()}` : `العميل: ${l}`)).join("\n"), text, countries.map((x) => x.arabic_name));
        const before = k.before ? ({ country: null, nationality: null, applicants: null, travelDate: null, ...k.before } as VisaFacts) : null;
        const facts = visaFacts({ a, clientText: text, said: readRequest(text, places).country, before, countries });
        const step = a?.wants_trip ? ({ do: "trip" } as const) : visaStep({ a, facts, asked: Boolean(k.asked), countries, rows, includePrice: true, clientText: text });
        const got: Want = step.do === "trip" ? "trip" : step.do === "free" ? "free" : step.do === "answer" ? (step.row ? "answer" : "handoff") : /أي دولة تفضّل/.test(step.text) ? "advice" : "ask";
        const wants = ([] as Want[]).concat(k.want);
        const countryOk = !k.country || (got === "advice" || got === "trip" ? true : facts.country === k.country);
        const ok = (entered || got === "trip") && wants.includes(got) && countryOk;
        const said = step.do === "ask" ? step.text : step.do === "free" ? `(معفاة) ${step.country}` : step.do === "answer" ? (step.row ? `(قائمة) ${step.row.country}` : "(تحويل)") : "(مبيعات)";
        return { ok, line: `${ok ? "✓" : "✗"} ${client.at(-1)!.slice(0, 60)} → ${got}${entered ? "" : " [لم يدخل مسار التأشيرات]"} · ${facts.country ?? "—"} | ${said.replace(/\n/g, " ⏎ ").slice(0, 220)}` };
      }),
    );
    for (const r of results) console.log(r.line);
    const score = results.filter((r) => r.ok).length / results.length;
    console.log(`\nالنتيجة: ${results.filter((r) => r.ok).length}/${results.length} = ${(score * 100).toFixed(1)}%`);
    expect(score).toBeGreaterThanOrEqual(0.95);
  });
});
