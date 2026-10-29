import { describe, expect, it } from "vitest";
import { ADMIN_KEYS, adminRows, dayText, moneyText, opsVisaText, parseFace, systemText, teamText, type PanelFacts, type VisaFacts } from "./staff-admin-core";
import { welcomeText } from "./staff-handler";
import { waitText } from "./staff-numbers";

const tile = (value: string, reason = "", status: "green" | "amber" | "red" = "green", label = "") => ({ label, value, reason, status });
const panels: PanelFacts = {
  conversations: {
    status: "red",
    tiles: { today: tile("33"), open: tile("28"), closed: tile("5"), waiting: tile("5", "", "red"), unassigned: tile("0"), first_reply: tile("3 دقائق") },
  },
  sales: { status: "green", tiles: { files: tile("5"), issued: tile("0"), sent: tile("0"), confirmed: tile("0") } },
  operations: { status: "green", tiles: { live: tile("3"), travel: tile("0"), payment: tile("0"), deadline: tile("1") } },
  team: { status: "amber", tiles: { teletel: tile("5 من 31"), team_reply: tile("3 دقائق") } },
  ads: { status: "green", tiles: { spend: tile("$34.52"), cost_per_conversation: tile("$1.05") } },
  system: {
    status: "amber",
    tiles: {
      integrations: tile("36 من 37 سليم", "بوابة الدفع لا ترد", "amber", "الربط الخارجي"),
      backup: tile("2026-10-26", "2.8 MB · قبل 15 ساعة", "green", "النسخة الاحتياطية"),
      ads_feed: tile("قبل 14 دقيقة"),
    },
  },
};
const visas: VisaFacts = {
  open: 9,
  byStatus: { new: 2, collecting: 3, ready: 1, submitted: 3, approved: 4 },
  replyOverdue: 1,
  actionDue: 2,
  missingDocs: 3,
  toDeliver: 2,
  unpaid: { files: 2, due: { SAR: 1200, USD: 0 } },
};
const ops = {
  liveCases: 3,
  needsAction: 2,
  critical: 1,
  travelSoon: 4,
  travelIncomplete: 1,
  unpaid: 2,
  urgent: [{ serial: "TR-1001", customer: "عميل <تجربة>", worst: "قسط متأخر" }],
};

describe("«🏢 لوحة الإدارة» keyboard", () => {
  it("is the administration's own, «المال» only for who holds it, and a way to the employee's", () => {
    expect(adminRows(true)).toEqual([
      ["🏢 لوحة اليوم", "⏳ المحادثات المنتظرة"],
      ["🚨 يحتاج تدخلك", "📋 قرارات الإدارة"],
      ["👥 الفريق", "📈 الأداء والأهداف"],
      ["💰 المال والتحصيل", "🔔 نبّه موظفاً"],
      ["📢 إعلان عام", "📜 إصدار قرار", "🏖️ منح إجازة"],
      ["🧭 العمليات والتأشيرات", "🔌 النظام"],
      ["👤 واجهة الموظف"],
    ]);
    expect(adminRows(false).flat()).not.toContain(ADMIN_KEYS.money);
  });

  it("opens on the administration's face unless the manager chose the employee's", () => {
    expect([parseFace(null), parseFace("admin"), parseFace("staff"), parseFace("x")]).toEqual(["admin", "admin", "staff", "admin"]);
  });
});

describe("«🏢 لوحة اليوم»", () => {
  it("is figures by section, under the administration's title, with the oldest wait in words", () => {
    const text = dayText({ overall: "red", panels, longestWaitMin: 600, urgent: 1, watch: 3, ops, visas, nowMs: Date.parse("2026-10-26T11:05:00Z"), waitText });
    expect(text.split("\n")[0]).toBe("🏢 <b>لوحة الإدارة — ترافليون ون</b>");
    expect(text).toContain("26/10 · 14:05 · الحالة: 🔴 تحتاج تدخلاً");
    expect(text).toContain("33 اليوم · 28 مفتوحة · 5 مغلقة");
    expect(text).toContain("5 بانتظار الرد · أقدمها 10 س · 0 بلا موظف");
    expect(text).toContain("3 ملف جارٍ · 2 يحتاج إجراء");
    expect(text).toContain("9 مفتوح · 2 جديد · 3 بانتظار الرد · 3 متأخر · 2 غير مسدد");
    expect(text).toContain("🚨 <b>1</b> أمر يحتاج تدخلك · 3 تحت المتابعة");
  });

  it("says plainly when a board could not be read, instead of a zero", () => {
    const text = dayText({ overall: "green", panels, longestWaitMin: null, urgent: 0, watch: 0, ops: null, visas: null, nowMs: 0, waitText });
    expect(text).toContain("تعذّرت قراءة ملفات التأشيرات الآن.");
    expect(text).toContain("لا شيء يحتاج تدخلك الآن");
  });
});

describe("the administration's other screens", () => {
  it("lists the team busiest first in one line each", () => {
    const text = teamText(
      [
        { id: "a", name: "سامي", presence: "online", open: 12, waiting: 3, oldestMin: 45, firstReplyMin: 2.4, resolved: 4 },
        { id: "b", name: "فارس", presence: "offline", open: 2, waiting: 0, oldestMin: null, firstReplyMin: null, resolved: 1 },
        { id: "c", name: "نادر", presence: "online", open: 1, waiting: 1, oldestMin: 3, firstReplyMin: 0.2, resolved: 0 },
      ],
      waitText,
      4,
    );
    expect(text).toContain("👥 <b>الفريق الآن</b> — 2 متصل");
    expect(text).toContain("15 مفتوحة · 4 منتظرة · 5 أُغلقت اليوم");
    expect(text).toContain("🟢 <b>سامي</b> — 12 مفتوحة · 3 منتظرة (أقدمها 45 د) · أول رد اليوم 2 د");
    expect(text).toContain("⚪ <b>فارس</b> — 2 مفتوحة · 0 منتظرة\n");
    expect(text).toContain("أول رد اليوم أقل من دقيقة");
    expect(text).toContain("و4 غير متصلين ولا محادثات مفتوحة معهم.");
  });

  it("money is selling-side figures only, and the visa amounts owed", () => {
    const text = moneyText(panels, ops, visas);
    expect(text).toContain("2 ملف مؤكد لم يُسدَّد بالكامل");
    expect(text).toContain("التأشيرات: 2 ملف غير مسدد — المستحق 1,200 SAR");
    expect(text).not.toMatch(/تكلفة الشراء|سعر الشراء/);
  });

  it("operations and visas escape what a client typed", () => {
    const text = opsVisaText(ops, visas, (s) => s.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
    expect(text).toContain("• <code>TR-1001</code> عميل &lt;تجربة&gt; — قسط متأخر");
    expect(text).toContain("1 تأخر ردّه · 2 إجراء مستحق · 3 مستندات ناقصة");
  });

  it("the system screen names what is wrong in words", () => {
    const text = systemText(panels);
    expect(text).toContain("الربط الخارجي: 36 من 37 سليم — بوابة الدفع لا ترد");
    expect(text).toContain("🟡 الربط الخارجي: 36 من 37 سليم — بوابة الدفع لا ترد");
  });
});

describe("the welcome says «ترافليون ون»", () => {
  it("and tells a manager on the employee's face how to go back", () => {
    expect(welcomeText("سامي", true, false)).toContain("حسابك مربوط بترافليون ون ✅");
    expect(welcomeText("سامي", true, false)).not.toContain("نظام ترافليون");
    expect(welcomeText("سامي", true, true)).toContain("«🏢 واجهة الإدارة»");
  });
});
