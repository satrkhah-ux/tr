import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { VisaBoard as Board } from "@/lib/visa-files/types";
import { defaultBoardFilter, pickFocus, pickStatus } from "@/lib/visa-files/ui";
import { NOW, visaBoard, visaRow } from "@/lib/visa-files/test-helpers";

let held: string[] = ["visas.work"];
vi.mock("@/lib/roles/RoleContext", () => ({ useRole: () => ({ can: (p: string) => held.includes(p) }) }));
// the data layer is not written yet in this branch, and a screen must not need it to render
vi.mock("@/lib/data/visa-files", () => ({
  getVisaBoard: async () => {
    throw new Error("not implemented yet");
  },
}));

const { VisaBoardView } = await import("./VisaBoardView");
const { VisaBoard } = await import("./VisaBoard");

const view = (phase: Parameters<typeof VisaBoardView>[0]["phase"], over: Partial<Parameters<typeof VisaBoardView>[0]> = {}) =>
  renderToStaticMarkup(<VisaBoardView phase={phase} filter={defaultBoardFilter()} countries={["تركيا", "جورجيا"]} manager={false} now={NOW} refreshing={false} onFilter={() => {}} onRefresh={() => {}} {...over} />);
const ready = (board: Board = visaBoard(), error?: string) => ({ kind: "ready" as const, board, error });

describe("the board's counters", () => {
  it("shows the seven steps of the work with their counts, and the open ones together", () => {
    const html = view(ready());
    for (const label of ["المفتوحة", "جديد", "جمع المستندات", "جاهز للتقديم", "قُدِّم — بانتظار الرد", "صدرت التأشيرة", "رُفضت", "سُلِّمت للعميل"]) expect(html).toContain(label);
    // new 1 + collecting 3 + ready 2 + submitted 4
    expect(html).toMatch(/tv-tnum text-xl[^>]*>10<\/span><span[^>]*>المفتوحة/);
    expect(html).toMatch(/>3<\/span><span[^>]*>جمع المستندات/);
  });

  it("shows what needs attention, and what is owed in each currency", () => {
    const html = view(ready());
    for (const label of ["ناقصة مستندات", "تأخر الرد", "متابعة مستحقة اليوم", "صدرت ولم تُسلَّم", "لم يسدد العميل"]) expect(html).toContain(label);
    expect(html).toContain("2,400 SAR · 300 USD");
    // the unpaid counter counts files, not money
    expect(html).toMatch(/>5<\/span><span[^>]*>لم يسدد العميل/);
  });

  it("marks the pressed counter, and the open files are pressed by default", () => {
    expect(view(ready())).toMatch(/aria-pressed="true"[^>]*>(?:(?!<button).)*المفتوحة/);
    const approved = view(ready(), { filter: pickStatus(defaultBoardFilter(), "approved") });
    expect(approved).toMatch(/aria-pressed="true"[^>]*>(?:(?!<button).)*صدرت التأشيرة/);
    const focused = view(ready(), { filter: pickFocus(defaultBoardFilter(), "unpaid") });
    expect(focused).toMatch(/aria-pressed="true"[^>]*>(?:(?!<button).)*لم يسدد العميل/);
    // and the list says which files it shows
    expect(focused).toContain('text-[#a86a10]">لم يسدد العميل</span>');
  });

  it("does not light the attention counters that count nothing", () => {
    const quiet = visaBoard();
    quiet.counts = { ...quiet.counts, missingDocs: 0, replyOverdue: 0, actionDue: 0, toDeliver: 0, unpaid: { files: 0, due: {} } };
    const html = view(ready(quiet));
    expect(html).not.toContain("bg-[#fdecef] text-[#c22850] hover:bg-[#fbdde4]");
    expect(view(ready())).toContain("bg-[#fdecef] text-[#c22850] hover:bg-[#fbdde4]");
  });
});

describe("the list of files", () => {
  it("is a card per file on a phone and a table from md up, each file a link to its page", () => {
    const html = view(ready());
    expect(html).toContain("md:hidden");
    expect(html).toContain("<table");
    expect(html.match(/href="\/visa-files\/f1"/g)?.length).toBeGreaterThanOrEqual(3);
    for (const text of ["VF-26-0001", "أحمد العتيبي", "جورجيا · سياحية", "طلب كشف الحساب", "ريم"]) expect(html).toContain(text);
  });

  it("states the payment, the amount due, a late reply in red and a due action", () => {
    const html = view(ready());
    // f1: 500 owed, nothing paid; f2: 500 owed, 500 paid
    expect(html).toContain("لم يسدد");
    expect(html).toContain("500 SAR");
    expect(html).toContain("مسدّد");
    // f2 was due on the 22nd and is still waiting on the 26th
    expect(html).toContain("font-extrabold text-[#c22850]");
    expect(html).toContain("تأخر 4 أيام");
    // f1's action is today's
    expect(html).toContain("font-extrabold text-[#a86a10]");
    expect(html).toMatch(/ناقص <span[^>]*>2<\/span> مستند/);
  });

  it("names the assignee, or says the file has none", () => {
    const board = visaBoard({ rows: [visaRow({ assignedTo: null })] });
    expect(view(ready(board))).toContain("بلا مسؤول");
  });

  it("offers more when the page came back full", () => {
    const filter = { ...defaultBoardFilter(), limit: 2 };
    expect(view(ready(), { filter })).toContain("عرض المزيد");
    expect(view(ready(), { filter: { ...filter, limit: 100 } })).not.toContain("عرض المزيد");
  });
});

describe("the employee filter", () => {
  it("is the management's: a picker «عرض كموظف» and each person's open load", () => {
    const html = view(ready(), { manager: true });
    expect(html).toContain("عرض كموظف");
    expect(html).toContain("بلا مسؤول");
    expect(html).toContain("ريم (4)");
    expect(html).toContain("الملفات المفتوحة عند كل موظف");
  });

  it("is not shown to a visa employee, who sees only what the server gave him", () => {
    const html = view(ready(), { manager: false });
    expect(html).not.toContain("عرض كموظف");
    expect(html).not.toContain("الملفات المفتوحة عند كل موظف");
  });

  it("lights the person being looked at", () => {
    const html = view(ready(), { manager: true, filter: { ...defaultBoardFilter(), assignedTo: "emp-2" } });
    expect(html).toMatch(/<option value="emp-2" selected="">خالد \(1\)<\/option>/);
    expect(html).toContain("مسح التصفية");
  });
});

describe("empty, loading and error", () => {
  it("says there is nothing open and offers a new file", () => {
    const html = view(ready(visaBoard({ rows: [] })));
    expect(html).toContain("لا توجد ملفات تأشيرة مفتوحة");
    expect(html).toContain('href="/visa-files/new"');
  });

  it("says nothing matches a filter, and offers to clear it", () => {
    const html = view(ready(visaBoard({ rows: [] })), { filter: { ...defaultBoardFilter(), search: "zzz" } });
    expect(html).toContain("لا توجد ملفات مطابقة");
    expect(html).toContain("مسح التصفية");
  });

  it("shows a skeleton while the first board is on its way", () => {
    const html = view({ kind: "loading" });
    expect(html).toContain("جارٍ تحميل اللوحة");
    expect(html).not.toContain("<table");
  });

  it("shows the failure as a line with a retry, not a crashed page", () => {
    const html = view({ kind: "error", message: "هذه الخدمة لم تُفعَّل على الخادم بعد." });
    expect(html).toContain('role="alert"');
    expect(html).toContain("هذه الخدمة لم تُفعَّل على الخادم بعد.");
    expect(html).toContain("إعادة المحاولة");
  });

  it("keeps the last good board under a failed refresh", () => {
    const html = view(ready(visaBoard(), "تعذّر الاتصال."));
    expect(html).toContain("تعذّر التحديث، والأرقام آخر نسخة ناجحة. تعذّر الاتصال.");
    expect(html).toContain("VF-26-0001");
  });

  it("has «تحديث» and a way to a new file at the top", () => {
    const html = view(ready());
    expect(html).toContain("تحديث");
    expect(html).toContain("ملف تأشيرة جديد");
  });
});

describe("the board page's container", () => {
  it("renders the server's first board", () => {
    held = ["visas.work"];
    const html = renderToStaticMarkup(<VisaBoard initial={{ ok: true, board: visaBoard() }} />);
    expect(html).toContain("VF-26-0001");
    expect(html).not.toContain("عرض كموظف");
  });

  it("gives the management the picker, on each of its keys", () => {
    for (const key of ["visas.manage", "dashboard.admin", "developer.access"]) {
      held = [key];
      expect(renderToStaticMarkup(<VisaBoard initial={{ ok: true, board: visaBoard() }} />)).toContain("عرض كموظف");
    }
  });

  it("opens on a failed first read as an inline error, whatever the failure was", () => {
    held = ["visas.work"];
    const html = renderToStaticMarkup(<VisaBoard initial={{ ok: false, error: "not implemented yet" }} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("هذه الخدمة لم تُفعَّل على الخادم بعد.");
    expect(html).toContain("إعادة المحاولة");
  });
});
