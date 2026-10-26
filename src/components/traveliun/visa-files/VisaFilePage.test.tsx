import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VISA_STATUSES, type VisaEvent, type VisaPayment, type VisaStatus } from "@/lib/visa-files/types";
import { visaDoc, visaFile } from "@/lib/visa-files/test-helpers";
import { NEXT_STATUS } from "@/lib/visa-files/ui";
import { isDirty, reconcile } from "./useDraft";

let held: string[] = ["visas.work"];
vi.mock("@/lib/roles/RoleContext", () => ({ useRole: () => ({ can: (p: string) => held.includes(p) }) }));
// every action throws, as the unwritten bodies do — the page must open and speak anyway
vi.mock("@/lib/data/visa-files", () => {
  const stub = async () => {
    throw new Error("not implemented yet");
  };
  return {
    getVisaFile: stub, updateVisaFile: stub, setVisaStatus: stub, assignVisaFile: stub, setVisaServices: stub, addVisaPayment: stub, addVisaNote: stub,
    setVisaDocument: stub, uploadVisaDocument: stub, visaDocumentUrl: stub, removeVisaDocument: stub, pullFromTeletel: stub, importTeletelAttachment: stub, readVisaPassport: stub,
  };
});

const { VisaFilePage } = await import("./VisaFilePage");
const { StatusBar, VisaFileHeader } = await import("./VisaFileHeader");
const { VisaDocuments } = await import("./VisaDocuments");
const { MoneySection } = await import("./VisaFileSections");
const { VisaTravelers } = await import("./VisaTravelers");
const { PaymentChip, StatusChip } = await import("./visa-ui");

const people = [{ id: "emp-1", name: "ريم" }, { id: "emp-2", name: "خالد" }];
const payments: VisaPayment[] = [{ id: "p1", fileId: "f1", amount: 120, method: "transfer", note: "دفعة أولى", paidAt: "2026-10-24", by: "emp-1" }];
const events: VisaEvent[] = [
  { id: "e1", fileId: "f1", at: "2026-10-20T10:00:00Z", by: "emp-1", kind: "created", text: "فُتح الملف" },
  { id: "e2", fileId: "f1", at: "2026-10-25T10:00:00Z", by: "emp-2", kind: "contact", text: "اتصلت بالعميل واتفقنا على كشف الحساب" },
];
const NO_MESSAGE = null;

const page = (over: Partial<Parameters<typeof VisaFilePage>[0]> = {}) =>
  renderToStaticMarkup(<VisaFilePage id="f1" initial={{ ok: true, file: visaFile(), payments, events }} people={people} teletelUrl="https://chat.example/app/accounts/1/conversations/4821" {...over} />);

describe("the status bar", () => {
  const bar = (status: VisaStatus, over: Partial<Parameters<typeof StatusBar>[0]> = {}) =>
    renderToStaticMarkup(<StatusBar status={status} confirming={null} note="" busy={false} message={NO_MESSAGE} onPick={() => {}} onConfirm={() => {}} onCancel={() => {}} onNote={() => {}} {...over} />);

  it("hands an unpaid file over only after a red question that names what is owed — never a block", () => {
    const html = bar("approved", { confirming: "delivered", owing: "500 SAR" });
    expect(html).toContain("لم يسدد العميل كامل الرسوم");
    expect(html).toContain("500 SAR");
    expect(html).toContain("نعم، أكّد"); // the question can still be answered yes
    expect(bar("approved", { confirming: "delivered", owing: null })).not.toContain("لم يسدد العميل");
  });

  it("offers exactly the steps the status allows, the first one as the main button", () => {
    const html = bar("ready");
    expect(html).toContain("تم التقديم للسفارة");
    expect(html).toContain("رجوع إلى «جمع المستندات»");
    expect(html).toContain("إلغاء الملف");
    expect(html).not.toContain("صدرت التأشيرة");
    expect(html.match(/bg-\[#185045\]/g)?.length).toBe(1);
    for (const status of VISA_STATUSES) expect(bar(status).match(/<button/g)?.length ?? 0).toBe(NEXT_STATUS[status].length);
  });

  it("after the submission offers the embassy's two answers", () => {
    const html = bar("submitted");
    expect(html).toContain("صدرت التأشيرة");
    expect(html).toContain("رُفضت التأشيرة");
  });

  it("says a finished file has no next step", () => {
    const html = bar("delivered");
    expect(html).toContain("انتهى العمل في هذا الملف");
    expect(html).not.toContain("<button");
  });

  it("asks «هل أنت متأكد؟» before an answer — and while it asks, no other step can be pressed", () => {
    const html = bar("submitted", { confirming: "approved" });
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain("هل أنت متأكد من «صدرت التأشيرة»؟");
    expect(html).toContain("نعم، أكّد");
    expect(html).toContain("تراجع");
    expect(html).toMatch(/<button type="button" disabled="" class="[^"]*">صدرت التأشيرة<\/button>/);
    expect(bar("submitted")).not.toContain("alertdialog");
  });

  it("shows the result of a step in words", () => {
    expect(bar("new", { message: { tone: "error", text: "لم يُحفظ شيء. ليس لديك صلاحية" } })).toContain('role="alert"');
    expect(bar("new", { message: { tone: "ok", text: "انتقل الملف." } })).toContain('role="status"');
  });
});

describe("chips", () => {
  it("names each payment state", () => {
    expect(renderToStaticMarkup(<PaymentChip state="unpaid" />)).toContain("لم يسدد");
    expect(renderToStaticMarkup(<PaymentChip state="partial" />)).toContain("سدد جزءاً");
    expect(renderToStaticMarkup(<PaymentChip state="paid" />)).toContain("مسدّد");
    expect(renderToStaticMarkup(<PaymentChip state="free" />)).toContain("بلا رسوم");
  });

  it("keeps the unpaid red, the partial amber and the paid green", () => {
    expect(renderToStaticMarkup(<PaymentChip state="unpaid" />)).toContain("text-[#c22850]");
    expect(renderToStaticMarkup(<PaymentChip state="partial" />)).toContain("text-[#a86a10]");
    expect(renderToStaticMarkup(<PaymentChip state="paid" />)).toContain("text-[#0f7a52]");
  });

  it("gives every status its label", () => {
    for (const s of VISA_STATUSES) expect(renderToStaticMarkup(<StatusChip status={s} />).length).toBeGreaterThan(50);
    expect(renderToStaticMarkup(<StatusChip status="submitted" />)).toContain("قُدِّم — بانتظار الرد");
  });
});

describe("the documents", () => {
  const docs = (list = visaFile().documents, over: Partial<Parameters<typeof VisaDocuments>[0]> = {}) =>
    renderToStaticMarkup(<VisaDocuments fileId="f1" documents={list} travelers={visaFile().travelers} conversationId={4821} onChanged={async () => {}} onApplyRead={() => {}} {...over} />);

  it("counts what is missing of what is required", () => {
    expect(docs()).toContain("ناقص 2 من 3");
    const all = visaFile().documents.map((d) => ({ ...d, receivedAt: "2026-10-25T10:00:00Z" }));
    expect(docs(all)).toContain("اكتملت المستندات (3)");
    expect(docs([])).toContain("لا مستندات مطلوبة بعد");
  });

  it("lists the missing first, then the optional, then the received", () => {
    const html = docs();
    const at = (text: string) => html.indexOf(text);
    expect(at("صورة شخصية")).toBeLessThan(at("تأمين سفر"));
    expect(at("كشف حساب بنكي")).toBeLessThan(at("تأمين سفر"));
    expect(at("تأمين سفر")).toBeLessThan(at(">جواز السفر<"));
  });

  it("marks each document received, missing or optional", () => {
    const html = docs();
    expect(html.match(/ناقص<\/span>/g)).toHaveLength(2);
    expect(html).toContain("اختياري</span>");
    expect(html).toContain("مستلم");
    expect(html).toContain("passport.jpg");
  });

  it("offers «اقرأ الجواز» and «فتح» only for a passport that has its file", () => {
    expect(docs()).toContain("اقرأ الجواز");
    const noFile = [visaDoc({ id: "d1", kind: "passport" })];
    const html = docs(noFile);
    expect(html).not.toContain("اقرأ الجواز");
    expect(html).not.toContain(">فتح<");
    expect(html).toContain("رفع الملف");
  });

  it("offers «قُدِّم للسفارة» only for what has been received, and shows what already went", () => {
    const list = [visaDoc({ id: "a", kind: "photo", label: "صورة شخصية", receivedAt: "2026-10-24T10:00:00Z", path: "x", fileName: "p.jpg", submittedAt: "2026-10-25T10:00:00Z" }), visaDoc({ id: "b", kind: "hotel", label: "حجز فندق" })];
    const html = docs(list);
    expect(html).toContain("إلغاء «قُدِّم للسفارة»");
    expect(html.match(/>قُدِّم للسفارة</g)).toHaveLength(1);
  });

  it("imports from the conversation only when the file has one", () => {
    expect(docs()).toContain("استيراد من محادثة تليتيل");
    expect(docs(visaFile().documents, { conversationId: null })).not.toContain("استيراد من محادثة تليتيل");
  });

  it("lets the employee add an expected document, for the file or for a traveller", () => {
    const html = docs();
    expect(html).toContain("أضف مستنداً مطلوباً");
    expect(html).toContain("للملف كله");
    expect(html).toContain("أحمد العتيبي");
  });
});

describe("the money", () => {
  const money = (file = visaFile(), list = payments) =>
    renderToStaticMarkup(
      <MoneySection
        file={file} draft={{ feeService: "300", feeEmbassy: "200", currency: "SAR" }} set={() => {}} dirty={false} busy={false} message={NO_MESSAGE} onSave={() => {}}
        payments={list} people={people} pay={{ amount: "", method: "", note: "", paidAt: "2026-10-26" }} onPay={() => {}} payBusy={false} payMessage={NO_MESSAGE} onAddPayment={() => {}}
      />,
    );

  it("adds the fees, shows what is paid and what is owed, with the state", () => {
    const html = money();
    expect(html).toContain("500 SAR");
    expect(html).toContain("120 SAR");
    expect(html).toContain("380 SAR");
    expect(html).toContain("سدد جزءاً");
    expect(html).toContain("تسجيل الدفعة");
  });

  it("shows no debt on a paid file and the free state on one without fees", () => {
    expect(money(visaFile({ paid: 500 }))).toContain("مسدّد");
    expect(money(visaFile({ paid: 0, feeService: 0, feeEmbassy: 0 }))).toContain("بلا رسوم");
    expect(money(visaFile({ paid: 0 }))).toContain("لم يسدد");
  });

  it("lists the payments with how they came and who took them", () => {
    const html = money();
    expect(html).toContain("تحويل بنكي");
    expect(html).toContain("دفعة أولى");
    expect(html).toContain("ريم");
    expect(money(visaFile(), [])).toContain("لا دفعات مسجلة");
  });
});

describe("the travellers", () => {
  const travelers = (list = visaFile().travelers, applicants = 2) =>
    renderToStaticMarkup(<VisaTravelers value={list} onChange={() => {}} applicants={applicants} dirty={false} busy={false} message={NO_MESSAGE} onSave={() => {}} />);

  it("keeps the passport number masked as the server gave it, and says how many are still to enter", () => {
    const html = travelers();
    expect(html).toContain('value="•••• 4567"');
    expect(html).toContain("المسافرون (1 من 2)");
    expect(html).toContain("بقي 1 من المتقدمين لم تُدخل بياناتهم.");
  });

  it("says nothing when the count is right and warns when there are too many", () => {
    expect(travelers(visaFile().travelers, 1)).not.toContain("لم تُدخل بياناتهم");
    expect(travelers(visaFile().travelers, 0)).toContain("المدخلون أكثر من عدد المتقدمين");
  });
});

describe("the header", () => {
  const head = (manager: boolean, over: Partial<Parameters<typeof VisaFileHeader>[0]> = {}) =>
    renderToStaticMarkup(<VisaFileHeader file={visaFile()} teletelUrl="https://chat.example/c/4821" manager={manager} people={people} assignee="emp-1" assigning={false} assignMessage={NO_MESSAGE} onAssignee={() => {}} onAssign={() => {}} onRefresh={() => {}} refreshing={false} {...over} />);

  it("shows the serial, the status, the client, a call link and a link into Teletel", () => {
    const html = head(false);
    for (const text of ["VF-26-0001", "جمع المستندات", "أحمد العتيبي", "فتح في تليتيل", 'href="tel:0501112233"', 'href="https://chat.example/c/4821"']) expect(html).toContain(text);
  });

  it("lets the management move the file; a visa employee just sees who holds it", () => {
    const manager = head(true);
    expect(manager).toContain("المسؤول عن الملف");
    expect(manager).toContain(">خالد<");
    expect(head(false)).not.toContain("المسؤول عن الملف");
    expect(head(false)).toContain("المسؤول: ريم");
    // «نقل الملف» appears once the picker was changed
    expect(manager).not.toContain("نقل الملف");
    expect(head(true, { assignee: "emp-2" })).toContain("نقل الملف");
  });

  it("has no Teletel link for a file without a conversation", () => {
    expect(head(false, { file: visaFile({ conversationId: null }) })).not.toContain("فتح في تليتيل");
  });
});

describe("the file's page", () => {
  it("holds every part the owner listed on one page: travellers, documents, services, fees, dates, follow-up", () => {
    held = ["visas.work"];
    const html = page();
    for (const part of ["المسافرون", "المستندات", "الخدمات", "الرسوم والمدفوعات", "المواعيد", "المتابعة", "سجل الملف", "الخطوة التالية", "تسجيل دفعة"]) expect(html).toContain(part);
    for (const anchor of ['id="travelers"', 'id="documents"', 'id="services"', 'id="money"', 'id="dates"', 'id="followup"']) expect(html).toContain(anchor);
    expect(html).not.toMatch(/المرحلة \d|الخطوة \d/);
  });

  it("shows the timeline newest first, with who did it", () => {
    const html = page();
    expect(html.indexOf("اتصلت بالعميل")).toBeLessThan(html.indexOf("فُتح الملف"));
    expect(html).toContain("اتصال بالعميل: ");
    expect(html).toContain("خالد");
  });

  it("shows the dates, with a late reply called late", () => {
    const html = page({ initial: { ok: true, file: visaFile({ status: "submitted", expectedReplyAt: "2026-10-01" }), payments, events } });
    expect(html).toContain('value="2026-10-20"');
    expect(html).toContain('value="2026-10-30T10:30"');
    expect(html).toContain("تأخر");
  });

  it("starts with every save button asleep — nothing is edited yet", () => {
    const html = page();
    expect(html).not.toContain("تعديلات لم تُحفظ");
    expect(html).toMatch(/<button type="button" class="[^"]*" disabled="">\s*حفظ<\/button>/);
  });

  it("gives the management the assignee picker and a visa employee none", () => {
    held = ["dashboard.admin"];
    expect(page()).toContain("المسؤول عن الملف");
    held = ["visas.work"];
    expect(page()).not.toContain("المسؤول عن الملف");
  });

  it("opens as a message with a retry when the file cannot be read — whatever the failure was", () => {
    held = ["visas.work"];
    const html = page({ initial: { ok: false, error: "not implemented yet" } });
    expect(html).toContain("تعذّر فتح ملف التأشيرة");
    expect(html).toContain("هذه الخدمة لم تُفعَّل على الخادم بعد.");
    expect(html).toContain("إعادة المحاولة");
    expect(html).toContain('href="/visa-files"');
    expect(html).not.toContain("الرسوم والمدفوعات");
  });

  it("explains a refusal in Arabic as the server worded it", () => {
    const html = page({ initial: { ok: false, error: "ليس لديك صلاحية لهذا الملف" } });
    expect(html).toContain("ليس لديك صلاحية لهذا الملف");
  });
});

describe("a section's draft", () => {
  const server = { name: "أحمد", phone: "050" };
  const draft = (value: typeof server, adopt = false) => ({ base: JSON.stringify(server), value, adopt });

  it("follows the server while clean", () => {
    const state = draft(server);
    const next = reconcile(state, { name: "أحمد", phone: "055" });
    expect(next.value).toEqual({ name: "أحمد", phone: "055" });
    expect(isDirty(next)).toBe(false);
  });

  it("keeps what was typed when the server moved for another reason, and stays dirty", () => {
    const state = draft({ name: "أحمد علي", phone: "050" });
    const next = reconcile(state, { name: "أحمد", phone: "055" });
    expect(next.value).toEqual({ name: "أحمد علي", phone: "050" });
    expect(isDirty(next)).toBe(true);
  });

  it("becomes clean once the server holds what was typed (the save went through)", () => {
    const typed = { name: "أحمد علي", phone: "050" };
    const state = draft(typed);
    expect(isDirty(reconcile(state, typed))).toBe(false);
  });

  it("a section just saved takes the server's word, even when it trimmed what was typed", () => {
    const state = draft({ name: "أحمد  ", phone: "050" }, true);
    // the server holds the trimmed name: same as before, so nothing moved — and the draft still lets go of its spaces
    const next = reconcile(state, server);
    expect(next.value).toEqual(server);
    expect(isDirty(next)).toBe(false);
    expect(next.adopt).toBe(false);
    // and once it adopted, a later edit is a normal edit
    expect(isDirty({ ...next, value: { ...server, phone: "1" } })).toBe(true);
  });

  it("is untouched while the server's copy is the same", () => {
    const state = draft(server);
    expect(reconcile(state, { ...server })).toBe(state);
  });
});
