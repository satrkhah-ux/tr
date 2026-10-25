import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { TeletelCandidate, TeletelPull } from "@/lib/visa-files/types";
import { applyCatalogRow, applyPull, buildNewFile, emptyNewFile, toggleService, type NewFileForm } from "@/lib/visa-files/ui";

let held: string[] = ["visas.work"];
vi.mock("@/lib/roles/RoleContext", () => ({ useRole: () => ({ can: (p: string) => held.includes(p) }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
// every action throws, as the unwritten bodies do — the screen must open and speak anyway
vi.mock("@/lib/data/visa-files", () => {
  const stub = async () => {
    throw new Error("not implemented yet");
  };
  return { createVisaFile: stub, pullFromTeletel: stub, searchTeletelForVisa: stub, visaCatalogFor: stub };
});

const { VisaNewFile, VisaNewFileView } = await import("./VisaNewFile");
type ViewProps = Parameters<typeof VisaNewFileView>[0];

const pull: TeletelPull = {
  conversationId: 4821, contactId: 90, clientName: "سارة العتيبي", clientPhone: "+966501112233", leadId: "lead-1",
  intake: { country: "جورجيا", nationality: "سعودي", applicants: 3 },
  attachments: [
    { messageId: 11, attachmentId: 5, fileName: "passport-sara.jpg", fileType: "image/jpeg", at: "2026-10-25T10:00:00Z", fromClient: true },
    { messageId: 12, attachmentId: 6, fileName: "bank.pdf", fileType: "application/pdf", at: "2026-10-25T11:00:00Z", fromClient: true },
    { messageId: 13, attachmentId: 7, fileName: "form.docx", fileType: "application/msword", at: "2026-10-25T12:00:00Z", fromClient: false },
  ],
};
const candidate: TeletelCandidate = { conversationId: 4821, contactName: "سارة العتيبي", phone: "+966501112233", lastActivityAt: 1_792_000_000, team: "التأشيرات", assignee: "ريم" };

const view = (over: Partial<ViewProps> = {}) =>
  renderToStaticMarkup(
    <VisaNewFileView
      form={emptyNewFile()}
      set={() => {}}
      countries={[{ id: "c2", name: "جورجيا" }]}
      people={[{ id: "emp-2", name: "خالد" }]}
      manager={false}
      tele={{ q: "", phase: "idle", candidates: [], message: "", pulling: null, pull: null }}
      onSearch={() => {}}
      onPull={() => {}}
      onUnlink={() => {}}
      catalog={{ kind: "idle" }}
      onCatalog={() => {}}
      onCountry={() => {}}
      submit={{ busy: false, error: "", errors: {}, created: null }}
      onSubmit={() => {}}
      {...over}
    />,
  );
const pulled = (form: NewFileForm = emptyNewFile()) => ({ form: applyPull(form, pull), tele: { q: "", phase: "idle" as const, candidates: [], message: "", pulling: null, pull } });

describe("the new file's page", () => {
  it("has every part the owner asked for on one page, with no stages", () => {
    const html = view();
    for (const part of ["اسحب من تليتيل", "اسم العميل", "الدولة", "عدد المتقدمين", "تاريخ التقديم", "الخدمات المقدمة", "رسوم الخدمة", "رسوم السفارة", "العملة", "ملاحظة", "إنشاء الملف"]) expect(html).toContain(part);
    expect(html).toContain('type="date"');
    expect(html).not.toMatch(/المرحلة|الخطوة \d/);
    // the standard services are all offered
    for (const service of ["حجز موعد", "تعبئة الاستمارة", "ترجمة", "التقديم للسفارة", "تسليم التأشيرة"]) expect(html).toContain(service);
  });

  it("gives a visa employee no assignee picker, and the management every colleague", () => {
    expect(view()).toContain("سيُسند الملف إليك");
    expect(view()).not.toContain("الموظف المسؤول");
    const manager = view({ manager: true });
    expect(manager).toContain("الموظف المسؤول");
    expect(manager).toContain(">خالد<");
    expect(manager).not.toContain("سيُسند الملف إليك");
  });

  it("lists the conversations found by name or number, with their phone and who holds them", () => {
    const html = view({ tele: { q: "سارة", phase: "done", candidates: [candidate], message: "", pulling: null, pull: null } });
    expect(html).toContain("سارة العتيبي");
    expect(html).toContain("+966501112233");
    expect(html).toContain("ريم");
    expect(html).toContain("اسحب");
  });

  it("says when no conversation matches, and when the search itself failed", () => {
    expect(view({ tele: { q: "zz", phase: "done", candidates: [], message: "", pulling: null, pull: null } })).toContain("لا توجد محادثة بهذا الاسم أو الرقم");
    const failed = view({ tele: { q: "zz", phase: "error", candidates: [], message: "هذه الخدمة لم تُفعَّل على الخادم بعد.", pulling: null, pull: null } });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("هذه الخدمة لم تُفعَّل على الخادم بعد.");
  });
});

describe("after «اسحب» from Teletel", () => {
  it("prefills the client, the country, the nationality and the number of applicants", () => {
    const { form, tele } = pulled();
    const html = view({ form, tele });
    expect(html).toContain('value="سارة العتيبي"');
    expect(html).toContain('value="+966501112233"');
    expect(html).toContain('value="سعودي"');
    expect(html).toContain('value="جورجيا"');
    expect(html).toContain('value="3"');
  });

  it("says which conversation the file is tied to, what Murad learned, and offers to unlink", () => {
    const { form, tele } = pulled();
    const html = view({ form, tele });
    expect(html).toContain("سُحبت بيانات محادثة");
    expect(html).toContain("#4821");
    expect(html).toContain("ما عرفه مُراد: الدولة جورجيا · الجنسية سعودي · 3 متقدمين");
    expect(html).toContain("فك الربط");
    // the search box is gone while a conversation is pulled
    expect(html).not.toContain("ابحث بالاسم أو الرقم");
  });

  it("shows the conversation's attachments as chips, who sent each, to be filed as documents after the file exists", () => {
    const { form, tele } = pulled();
    const html = view({ form, tele });
    expect(html).toContain("مرفقات المحادثة (3)");
    expect(html).toContain("passport-sara.jpg");
    expect(html).toContain("bank.pdf");
    expect(html).toContain("form.docx");
    expect(html.match(/من العميل/g)).toHaveLength(2);
    expect(html).toContain("منا");
    expect(html).toContain("بعد إنشاء الملف");
  });

  it("says so when the conversation has no attachment or no intake", () => {
    const none: TeletelPull = { ...pull, intake: null, attachments: [] };
    const html = view({ form: applyPull(emptyNewFile(), none), tele: { q: "", phase: "idle", candidates: [], message: "", pulling: null, pull: none } });
    expect(html).toContain("لا مرفقات في هذه المحادثة");
    expect(html).not.toContain("ما عرفه مُراد");
    expect(html).toContain('value="1"');
  });

  it("creates the file tied to the conversation, with the nationality kept in the note", () => {
    const { form } = pulled();
    const built = buildNewFile({ ...form, appliedAt: "2026-10-28", services: toggleService([], "submission") });
    expect(built.ok && built.input).toMatchObject({ conversationId: 4821, contactId: 90, leadId: "lead-1", country: "جورجيا", applicants: 3, clientName: "سارة العتيبي", note: "الجنسية: سعودي" });
  });
});

describe("the catalogue under the country", () => {
  const rows = [
    { id: "v1", visaType: "سياحية — 30 يوماً", sellPrice: 350, sellCurrency: "USD", requirements: ["جواز ساري", "صورة شخصية", "كشف حساب لثلاثة أشهر"] },
    { id: "v2", visaType: "تجارية", sellPrice: null, sellCurrency: null, requirements: [] },
  ];

  it("offers the visa types with their price, and the requirements of the one picked as the expected documents", () => {
    const picked = applyCatalogRow({ ...emptyNewFile(), country: "جورجيا" }, rows[0]);
    const html = view({ form: picked, catalog: { kind: "ready", rows } });
    expect(html).toContain("سياحية — 30 يوماً");
    expect(html).toContain("350 USD");
    expect(html).toContain("تجارية");
    // the picked row is the checked radio
    expect(html).toMatch(/<input type="radio"[^>]*checked=""[/]><span[^>]*>سياحية — 30 يوماً/);
    expect(html).not.toMatch(/<input type="radio"[^>]*checked=""[/]><span[^>]*>تجارية/);
    for (const req of ["جواز ساري", "صورة شخصية", "كشف حساب لثلاثة أشهر"]) expect(html).toContain(req);
    expect(html).toContain("ستُضاف إلى الملف عند إنشائه");
    // and the price became the service fee to start from
    expect(html).toContain('value="350"');
  });

  it("does not list requirements before a type is picked", () => {
    const html = view({ form: { ...emptyNewFile(), country: "جورجيا" }, catalog: { kind: "ready", rows } });
    expect(html).not.toContain("ستُضاف إلى الملف عند إنشائه");
  });

  it("says the country is not in the list, or the list could not be read — and leaves the fields to fill by hand", () => {
    expect(view({ catalog: { kind: "none" } })).toContain("لا توجد هذه الدولة في قائمة التأشيرات");
    const failed = view({ catalog: { kind: "error", message: "هذه الخدمة لم تُفعَّل على الخادم بعد." } });
    expect(failed).toContain("تعذّر قراءة قائمة التأشيرات");
    expect(failed).toContain("رسوم الخدمة");
    expect(view({ catalog: { kind: "loading" } })).toContain("جارٍ البحث في قائمة التأشيرات");
  });
});

describe("saving", () => {
  it("shows what is wrong and does not hide the form", () => {
    const html = view({ submit: { busy: false, error: "", errors: { clientName: "اكتب اسم العميل.", country: "اختر الدولة." }, created: null } });
    expect(html).toContain("اكتب اسم العميل.");
    expect(html).toContain("اختر الدولة.");
    expect(html).toContain("راجع الحقول المظللة أعلاه.");
    expect(html).toContain('aria-invalid="true"');
  });

  it("locks the button while it saves and after it saved — a second press must not make a second file", () => {
    const busy = view({ submit: { busy: true, error: "", errors: {}, created: null } });
    expect(busy).toMatch(/<button type="submit"[^>]*disabled=""/);
    const done = view({ submit: { busy: false, error: "", errors: {}, created: { id: "f9", serial: "VF-26-0009" } } });
    expect(done).toMatch(/<button type="submit"[^>]*disabled=""/);
    expect(done).toContain("أُنشئ الملف VF-26-0009");
  });

  it("shows the server's refusal as a line, in Arabic", () => {
    const html = view({ submit: { busy: false, error: "لم يُنشأ الملف. هذه الخدمة لم تُفعَّل على الخادم بعد.", errors: {}, created: null } });
    expect(html).toContain('role="alert"');
    expect(html).toContain("لم يُنشأ الملف.");
  });
});

describe("the page's container", () => {
  it("opens with every action unwritten, empty and ready to type", () => {
    held = ["visas.work"];
    const html = renderToStaticMarkup(<VisaNewFile countries={[]} people={[]} />);
    expect(html).toContain("ملف تأشيرة جديد");
    expect(html).toContain("اسحب من تليتيل");
    expect(html).not.toContain('role="alert"');
  });

  it("gives the management the assignee picker", () => {
    held = ["dashboard.admin"];
    expect(renderToStaticMarkup(<VisaNewFile countries={[]} people={[{ id: "e1", name: "ريم" }]} />)).toContain("الموظف المسؤول");
  });
});
