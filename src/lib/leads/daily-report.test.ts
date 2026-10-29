import { describe, expect, it } from "vitest";
import {
  allRequestsText,
  applyEdits,
  bucketOf,
  buildReport,
  dayLabel,
  departmentsText,
  employeesText,
  exportRows,
  movePeriod,
  periodOf,
  readQueue,
  reportText,
  requestsFrom,
  visitDays,
  visitKey,
  type LeadFacts,
  type ReportRequest,
} from "./daily-report";

const req = (over: Partial<ReportRequest> & Pick<ReportRequest, "bucket">): ReportRequest => ({
  id: Math.random().toString(36).slice(2),
  day: "2026-10-26",
  kind: null,
  country: null,
  city: null,
  place: null,
  employee: null,
  assignee: null,
  note: null,
  ...over,
});

describe("the kinds the report names", () => {
  it("uses the system's own classification — nothing new", () => {
    expect(["بكج", "طيران", "تأشيرات", "فنادق", "مواصلات", "رخص دولية", "طلب غير واضح", "", null].map(bucketOf)).toEqual(["package", "flight", "visa", "hotel", "transport", "other", "incomplete", "incomplete", "incomplete"]);
    // a kind the report does not know is incomplete, never a new department
    expect(bucketOf("شي غريب")).toBe("incomplete");
  });
});

describe("the queue of reasons to read", () => {
  it("goes on to the next ones, and keeps what Teletel could not answer for after them", () => {
    const ids = Array.from({ length: 22 }, (_, i) => `c${i}`);
    const failed = ids.slice(0, 20);
    // the first twenty have no Teletel thread: the two readable ones come first, not the twenty again
    expect(readQueue(ids, [], failed).slice(0, 2)).toEqual(["c20", "c21"]);
    expect(readQueue(ids, [], failed)).toHaveLength(22);
    // what was read is not offered again; nothing left → empty
    expect(readQueue(ids, ["c20", "c21"], failed)).toEqual(failed);
    expect(readQueue(["a", "a", "b"], ["a", "b"], [])).toEqual([]);
  });
});

describe("the days and the periods", () => {
  it("writes the day as the staff do", () => {
    expect(dayLabel("2026-10-26")).toBe("الاثنين / 26 اكتوبر 2026");
  });
  it("takes the week from Sunday and the month from its first day, both ending today when still running", () => {
    expect(periodOf("week", "2026-10-28", "2026-10-29")).toEqual({ kind: "week", from: "2026-10-25", to: "2026-10-29" });
    expect(periodOf("week", "2026-10-21", "2026-10-29")).toEqual({ kind: "week", from: "2026-10-18", to: "2026-10-24" });
    expect(periodOf("month", "2026-10-05", "2026-10-29")).toEqual({ kind: "month", from: "2026-10-01", to: "2026-10-29" });
    expect(periodOf("month", "2026-09-05", "2026-10-29")).toEqual({ kind: "month", from: "2026-09-01", to: "2026-09-30" });
  });
  it("never reaches a day that has not come", () => {
    expect(periodOf("day", "2026-11-05", "2026-10-29")).toEqual({ kind: "day", from: "2026-10-29", to: "2026-10-29" });
    expect(periodOf("week", "2026-11-05", "2026-10-29")).toEqual({ kind: "week", from: "2026-10-25", to: "2026-10-29" });
  });
  it("moves by a day, a week, a month", () => {
    expect(movePeriod(periodOf("day", "2026-10-26", "2026-10-29"), -1, "2026-10-29").from).toBe("2026-10-25");
    expect(movePeriod(periodOf("week", "2026-10-28", "2026-10-29"), -1, "2026-10-29").from).toBe("2026-10-18");
    expect(movePeriod(periodOf("month", "2026-10-05", "2026-10-29"), -1, "2026-10-29")).toEqual({ kind: "month", from: "2026-09-01", to: "2026-09-30" });
  });
  it("counts a conversation on the day it opened and the day the client came back, in Riyadh time", () => {
    // 22:30 UTC is already the next day in Riyadh
    expect(visitDays({ created_at: "2026-10-25T22:30:00Z", last_visit_at: "2026-10-27T08:00:00Z" })).toEqual(["2026-10-26", "2026-10-27"]);
    expect(visitDays({ created_at: "2026-10-26T08:00:00Z", last_visit_at: "2026-10-26T15:00:00Z" })).toEqual(["2026-10-26"]);
  });
});

describe("requests from the conversations", () => {
  const lead = (over: Partial<LeadFacts>): LeadFacts => ({ id: "L", created_at: "2026-10-26T08:00:00Z", last_visit_at: null, inquiry: "بكج", destination: null, file: null, received_by: null, received_by_name: null, ...over });
  const places = [{ name: "تركيا", country: null }, { name: "اسطنبول", country: "تركيا" }] as never;
  it("takes the destination as «العملاء» resolves it, the receiver by name, Murad when it answered first", () => {
    const names = new Map([["e1", "احمد القدسي"]]);
    const rows = requestsFrom(
      [
        lead({ id: "a", destination: "اسطنبول", received_by: "e1" }),
        lead({ id: "b", destination: "تركيا", murad_receipt: { firstResponder: true } }),
        lead({ id: "c", received_by_name: "محمد صالح" }),
      ],
      names,
      places,
    );
    expect(rows.map((r) => [r.id, r.country, r.city, r.employee])).toEqual([
      ["a", "تركيا", "اسطنبول", "احمد القدسي"],
      ["b", "تركيا", null, "مُراد"],
      ["c", null, null, "محمد صالح"],
    ]);
  });

  it("keeps the place a client wrote when it is no destination, and whom the conversation is with now", () => {
    const names = new Map([["e1", "احمد القدسي"], ["e2", "رشا"]]);
    const rows = requestsFrom(
      [
        lead({ id: "h", inquiry: "فنادق", destination: "مكة", received_by: "e1", assigned_to: "e2" }),
        lead({ id: "t", inquiry: "مواصلات", destination: "من المطار الى الفندق", assigned_to_name: "منى" }),
      ],
      names,
      places,
    );
    expect(rows.map((r) => [r.id, r.kind, r.country, r.city, r.place, r.employee, r.assignee])).toEqual([
      ["h", "فنادق", null, null, "مكة", "احمد القدسي", "رشا"],
      ["t", "مواصلات", null, null, "من المطار الى الفندق", null, "منى"],
    ]);
  });

  it("does not take the system's own «nothing said» for a place", () => {
    const rows = requestsFrom([lead({ id: "a", inquiry: "فنادق", destination: "لم يحدد طلب" }), lead({ id: "b", inquiry: "فنادق", destination: "-" }), lead({ id: "c", inquiry: "فنادق", destination: "غير محدد" })], new Map(), places);
    expect(rows.map((r) => r.place)).toEqual([null, null, null]);
    const text = reportText(buildReport(rows, periodOf("day", "2026-10-26", "2026-10-29")));
    expect(text).toContain("🏨 طلبات الفنادق : 3\n_ فندق : غير مسند");
    expect(text).not.toContain("لم يحدد");
  });
});

describe("the report, as the staff write it", () => {
  const day = (over: Partial<ReportRequest> & Pick<ReportRequest, "bucket">) => req({ ...over });
  const requests: ReportRequest[] = [
    day({ bucket: "package", employee: "محمد صالح", country: "المغرب" }),
    day({ bucket: "package", employee: "محمد صالح", country: "اذربيجان" }),
    day({ bucket: "package", employee: "احمد القدسي", country: "تركيا" }),
    day({ bucket: "package", employee: "احمد القدسي", country: "تركيا" }),
    day({ bucket: "flight", employee: "رشا" }),
    day({ bucket: "visa", employee: "رشا" }),
    day({ bucket: "visa", employee: "رشا" }),
    day({ bucket: "transport", employee: "احمد القدسي", country: "تركيا", city: "اسطنبول" }),
    day({ bucket: "other", employee: "رشا", country: null }),
    day({ bucket: "incomplete", employee: "رشا", note: "ارسل صور فقط" }),
    // another day: not in this one
    day({ bucket: "package", day: "2026-10-25", country: "مصر" }),
  ];
  const report = buildReport(requests, periodOf("day", "2026-10-26", "2026-10-29"));

  it("counts the day's requests and each department; the total is the sum of them all", () => {
    expect(report.total).toBe(10);
    expect(report.counts).toMatchObject({ package: 4, flight: 1, visa: 2, inquiry: 0, hotel: 0, transport: 1, other: 1, incomplete: 1 });
    expect(Object.values(report.counts).reduce((a, b) => a + b, 0)).toBe(report.total);
  });

  it("writes the daily text in the owner's shape", () => {
    expect(reportText(report)).toBe(
      [
        "📊 تقرير الطلبات اليومي",
        "🗓️ الاثنين / 26 اكتوبر 2026",
        "═════════════════",
        "🔹ملخص الطلبات",
        "🔹إجمالي الطلبات : 10",
        "🌍 البكجات السياحية : 4",
        "✈️ حجوزات الطيران : 1",
        "🛂 التأشيرات : 2",
        "📞 الاستفسارات : 0",
        "══════════════════",
        "👨🏻‍💼 البكجات المستلمة حسب الموظف",
        "🔹 احمد القدسي : العدد 2 _ تركيا _ تركيا",
        "🔹 محمد صالح : العدد 2 _ المغرب _ اذربيجان",
        "═══════════════════",
        "📈 توزيع البكجات حسب الوجهة",
        "تركيا : 2",
        "اذربيجان : 1",
        "المغرب : 1",
        "══════════════════",
        "🏨 طلبات الفنادق : 0",
        "🚘 مواصلات : 1",
        "اسطنبول : احمد القدسي",
        "══════════════════",
        "🔸 طلبات اخرى : 1",
        "_ رخص دولية : رشا",
        "══════════════════",
        "🟣 الطلبات غير المكتملة : 1",
        "_ طلب غير واضح : ارسل صور فقط",
        "══════════════════",
      ].join("\n"),
    );
  });

  it("gives a package with no destination its own line, and a request with no receiver «غير مسند»", () => {
    const r = buildReport([req({ bucket: "package" }), req({ bucket: "flight" })], periodOf("day", "2026-10-26", "2026-10-29"));
    const text = reportText(r);
    expect(text).toContain("🔹 غير مسند : العدد 1 _ غير محددة");
    expect(text).toContain("غير محددة : 1");
  });

  it("takes a hand-made correction: another department, another note", () => {
    const first = requests[9];
    const fixed = applyEdits(requests, { [first.id]: { bucket: "inquiry", note: "سؤال عن الاسعار" } });
    const r = buildReport(fixed, periodOf("day", "2026-10-26", "2026-10-29"));
    expect(r.counts.inquiry).toBe(1);
    expect(r.counts.incomplete).toBe(0);
    expect(r.total).toBe(10);
    expect(reportText(r)).toContain("📞 الاستفسارات : 1");
  });

  it("keeps a correction of one visit to that visit — a client back on another day is another request", () => {
    const first = req({ id: "same", day: "2026-10-26", bucket: "incomplete", employee: "رشا" });
    const back = req({ id: "same", day: "2026-10-27", bucket: "incomplete", employee: "رشا" });
    const fixed = applyEdits([first, back], { [visitKey(first)]: { bucket: "flight", note: "حجز طيران" } });
    expect(fixed.map((r) => [r.day, r.bucket, r.note])).toEqual([
      ["2026-10-26", "flight", "حجز طيران"],
      ["2026-10-27", "incomplete", null],
    ]);
    // who received it is the conversation's: it moves on both days, and is whom the lines name too
    const moved = applyEdits([first, back], { same: { employee: "منى" } });
    expect(moved.map((r) => [r.employee, r.assignee])).toEqual([["منى", "منى"], ["منى", "منى"]]);
  });

  it("says where a hotel or transport request is, and whom it is with — the package and the unclear one by their receiver", () => {
    const rs = [
      req({ bucket: "hotel", place: "مكة", employee: "احمد القدسي", assignee: "رشا" }),
      req({ bucket: "transport", place: "جدة", employee: "احمد القدسي" }),
      req({ bucket: "transport", country: "تركيا", city: "اسطنبول", place: "جدة", employee: "احمد القدسي", assignee: "منى" }),
      req({ bucket: "other", kind: "رخص دولية", place: "الرياض", employee: "احمد القدسي", assignee: "رشا" }),
      req({ bucket: "package", place: "مكة", employee: "احمد القدسي", assignee: "رشا" }),
      req({ bucket: "incomplete", employee: "احمد القدسي", assignee: "رشا" }),
    ];
    const text = reportText(buildReport(rs, periodOf("day", "2026-10-26", "2026-10-29")));
    expect(text).toContain("🏨 طلبات الفنادق : 1\n_ مكة : رشا");
    expect(text).toContain("🚘 مواصلات : 2\nجدة : احمد القدسي\nاسطنبول : منى");
    expect(text).toContain("🔸 طلبات اخرى : 1\n_ رخص دولية الرياض : رشا");
    // a Saudi place is no destination of a package, whom it is with changes nothing for the package
    expect(text).toContain("🔹 احمد القدسي : العدد 1 _ غير محددة");
    expect(text).toContain("🟣 الطلبات غير المكتملة : 1\n_ طلب غير واضح\n");
  });

  it("adds the follow-up figures with the window they cover and whose they are", () => {
    const quiet = buildReport([], periodOf("day", "2026-10-26", "2026-10-29"));
    const lines = [{ name: "رشا", due: 5, done: 4, overdue: 1, compliance: 80 }];
    expect(reportText(quiet, { lines, days: 1, all: true })).toContain("📋 متابعة الموظفين — آخر 24 ساعة\n🔹 رشا : المستحق 5 _ المنجز 4 _ المتأخر 1 _ الالتزام 80%");
    expect(reportText(quiet, { lines, days: 7, all: true })).toContain("📋 متابعة الموظفين — آخر 7 أيام\n");
    expect(reportText(quiet, { lines: [], days: 3, all: false })).toContain("📋 متابعة الموظفين — آخر 3 أيام (حسب نطاق صلاحيتك)\nلا حالات ظاهرة لك");
    expect(reportText(quiet)).not.toContain("متابعة الموظفين");
  });

  it("adds its days and the departments and employees that received most, for a week", () => {
    const week = buildReport([...requests, req({ bucket: "visa", day: "2026-10-27", employee: "رشا" })], periodOf("week", "2026-10-28", "2026-10-29"));
    const text = reportText(week);
    expect(text.startsWith("📊 تقرير الطلبات الأسبوعي\n🗓️ من الاحد 25 اكتوبر 2026 الى الخميس 29 اكتوبر 2026")).toBe(true);
    expect(text).toContain("📅 الطلبات حسب اليوم\nالاحد 25 اكتوبر 2026 : 1\nالاثنين 26 اكتوبر 2026 : 10\nالثلاثاء 27 اكتوبر 2026 : 1");
    expect(text).toContain("🏆 أكثر الأقسام طلباً\n🌍 البكجات السياحية : 5\n🛂 التأشيرات : 3");
    expect(text).toContain("🏆 أكثر الموظفين استلاماً\n🔹 رشا : 6");
  });

  it("writes the same requests by employee, by department, and one by one — and as a spreadsheet", () => {
    expect(employeesText(report)).toContain("👨🏻‍💼 رشا : 5\n✈️ حجوزات الطيران : 1 _ —\n🛂 التأشيرات : 2 _ — _ —\n");
    // the other requests say what they are — «رخص دولية» — when nothing else was said about them
    expect(employeesText(report)).toContain("🔸 طلبات اخرى : 1 _ رخص دولية");
    expect(departmentsText(report)).toContain("🌍 البكجات السياحية : 4\n🔹 المغرب : محمد صالح");
    expect(allRequestsText(report).split("\n").filter((l) => l.startsWith("🌍")).length).toBe(4);
    expect(exportRows(report)[0]).toEqual(["اليوم", "القسم", "الوجهة", "المدينة", "المكان", "الموظف المستلم", "لمن أُسند", "ملاحظة"]);
    expect(exportRows(report)).toHaveLength(11);
    // a hotel in Makkah has no destination, and its place and whom it is with are in the spreadsheet as in the text
    const hotel = buildReport([req({ bucket: "hotel", place: "مكة", employee: "احمد القدسي", assignee: "رشا" })], periodOf("day", "2026-10-26", "2026-10-29"));
    expect(exportRows(hotel)[1]).toEqual(["2026-10-26", "طلبات الفنادق", "", "", "مكة", "احمد القدسي", "رشا", ""]);
  });

  it("is a quiet day, said plainly", () => {
    const empty = reportText(buildReport([], periodOf("day", "2026-10-26", "2026-10-29")));
    expect(empty).toContain("🔹إجمالي الطلبات : 0");
    expect(empty).toContain("لا بكجات");
  });
});
