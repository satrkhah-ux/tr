import { describe, expect, it } from "vitest";
import {
  checkUpload, stampSubmitted, cleanFields, cleanFileName, cleanServices, defaultServices, describeChange, diffFields, docPath, expectedDocs, expectedReplyFor, formatSerial, guessDocKind, isSerial,
  MAX_DOC_BYTES, nextSerial, nextStatuses, parseInstant, parseProcessingDays, planStatus, processingDays, requirementLines, sniffMime, TRANSITIONS,
} from "./rules";
import { replyOverdue, actionDue, VISA_STATUSES, type VisaDoc, type VisaStatus } from "./types";

describe("the serial", () => {
  it("is VF-YY-NNNN and counts on within the year", () => {
    expect(formatSerial(26, 1)).toBe("VF-26-0001");
    expect(formatSerial(2026, 12)).toBe("VF-26-0012");
    expect(isSerial("VF-26-0001")).toBe(true);
    expect(isSerial("VF-26-1")).toBe(false);
    expect(isSerial("AD-26-0001")).toBe(false);
    expect(nextSerial(26, null)).toBe("VF-26-0001");
    expect(nextSerial(26, "VF-26-0041")).toBe("VF-26-0042");
  });

  it("starts again at 0001 in a new year", () => {
    expect(nextSerial(27, "VF-26-0310")).toBe("VF-27-0001");
  });
});

describe("dates are stored as a moment in Riyadh's day", () => {
  it("a bare day anchors at start, noon or end; a timestamp is kept", () => {
    expect(parseInstant("2026-11-01", "start")).toBe("2026-10-31T21:00:00.000Z");
    expect(parseInstant("2026-11-01", "noon")).toBe("2026-11-01T09:00:00.000Z");
    expect(parseInstant("2026-11-01", "end")).toBe("2026-11-01T20:59:59.000Z");
    expect(parseInstant("2026-11-01T10:30:00+03:00", "end")).toBe("2026-11-01T07:30:00.000Z");
  });

  it("refuses what is not a date, or a typo of a year", () => {
    expect(parseInstant("2026-02-30", "noon")).toBeNull();
    expect(parseInstant("غداً", "noon")).toBeNull();
    expect(parseInstant("0202-11-01", "noon")).toBeNull();
  });

  it("a reply expected on a day is overdue only after that day, an action due from its first hour", () => {
    const expectedReplyAt = parseInstant("2026-11-01", "end");
    const submitted = { status: "submitted" as const, repliedAt: null, expectedReplyAt };
    expect(replyOverdue(submitted, Date.parse("2026-11-01T18:00:00Z"))).toBe(false);
    expect(replyOverdue(submitted, Date.parse("2026-11-01T21:30:00Z"))).toBe(true);
    const nextActionAt = parseInstant("2026-11-01", "start");
    expect(actionDue({ status: "collecting", nextActionAt }, Date.parse("2026-10-31T20:00:00Z"))).toBe(false);
    expect(actionDue({ status: "collecting", nextActionAt }, Date.parse("2026-10-31T21:30:00Z"))).toBe(true);
  });
});

describe("processing days", () => {
  it("defaults to 15 and reads the per-country setting, spelling folded", () => {
    const map = parseProcessingDays('{"جورجيا": 7, "أمريكا": 60, "bad": "x", "zero": 0}');
    expect(processingDays(map, "جورجيا")).toBe(7);
    expect(processingDays(map, "امريكا")).toBe(60);
    expect(processingDays(map, "تركيا")).toBe(15);
    expect(parseProcessingDays("not json")).toEqual({});
    expect(parseProcessingDays(null)).toEqual({});
  });

  it("the expected reply is the application day + days, to the end of that day", () => {
    expect(expectedReplyFor("2026-10-26T09:00:00.000Z", 15)).toBe("2026-11-10T20:59:59.000Z");
  });
});

const NOW = new Date("2026-10-26T09:00:00Z");
const base = { status: "new" as VisaStatus, country: "جورجيا", appliedAt: null, expectedReplyAt: null, repliedAt: null };

describe("status transitions", () => {
  it("every status has a table row, and a status never moves to itself", () => {
    for (const s of VISA_STATUSES) {
      expect(TRANSITIONS[s]).toBeDefined();
      expect(TRANSITIONS[s]).not.toContain(s);
    }
  });

  it("delivered is only reachable from approved", () => {
    const reach = VISA_STATUSES.filter((s) => nextStatuses(s).includes("delivered"));
    expect(reach).toEqual(["approved"]);
    expect(planStatus({ ...base, status: "submitted" }, "delivered", { now: NOW }).ok).toBe(false);
    expect(planStatus({ ...base, status: "approved" }, "delivered", { now: NOW }).ok).toBe(true);
  });

  it("answers only come from submitted; delivered is final", () => {
    expect(VISA_STATUSES.filter((s) => nextStatuses(s).includes("approved"))).toEqual(["submitted"]);
    expect(VISA_STATUSES.filter((s) => nextStatuses(s).includes("rejected"))).toEqual(["submitted"]);
    expect(nextStatuses("delivered")).toEqual([]);
  });

  it("submitting takes today as the application day and the country's days for the reply", () => {
    const plan = planStatus({ ...base, status: "ready" }, "submitted", { now: NOW, processingDays: { [`جورجيا`]: 7 } });
    expect(plan).toEqual({ ok: true, patch: { appliedAt: "2026-10-26T09:00:00.000Z", expectedReplyAt: "2026-11-02T20:59:59.000Z" } });
    // folded keys, as parseProcessingDays writes them
    const folded = planStatus({ ...base, status: "ready" }, "submitted", { now: NOW, processingDays: parseProcessingDays('{"جورجيا": 7}') });
    expect(folded.ok && folded.patch.expectedReplyAt).toBe("2026-11-02T20:59:59.000Z");
  });

  it("submitting keeps an application day and a reply date already given", () => {
    const given = { appliedAt: "2026-10-20T09:00:00.000Z", expectedReplyAt: "2026-11-30T20:59:59.000Z" };
    const plan = planStatus({ ...base, status: "ready", ...given }, "submitted", { now: NOW });
    expect(plan).toEqual({ ok: true, patch: given });
  });

  it("an answer stamps the reply day; going back from it clears it", () => {
    const a = planStatus({ ...base, status: "submitted", appliedAt: "x" }, "approved", { now: NOW });
    expect(a).toEqual({ ok: true, patch: { repliedAt: NOW.toISOString() } });
    const back = planStatus({ ...base, status: "approved", repliedAt: NOW.toISOString(), appliedAt: "2026-10-20T09:00:00.000Z", expectedReplyAt: "2026-11-30T20:59:59.000Z" }, "submitted", { now: NOW });
    expect(back.ok && back.patch.repliedAt).toBeNull();
  });

  it("a rejected file reopens clean: a new application starts from today", () => {
    const reopened = planStatus({ ...base, status: "rejected", appliedAt: "2026-10-01T09:00:00.000Z", expectedReplyAt: "2026-10-16T20:59:59.000Z", repliedAt: "2026-10-15T09:00:00.000Z" }, "collecting", { now: NOW });
    expect(reopened).toEqual({ ok: true, patch: { appliedAt: null, expectedReplyAt: null, repliedAt: null } });
  });

  it("refuses a move the table does not allow, naming both statuses in Arabic", () => {
    const r = planStatus({ ...base, status: "new" }, "approved", { now: NOW });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("جديد");
    expect(!r.ok && r.error).toContain("صدرت التأشيرة");
    expect(planStatus({ ...base, status: "new" }, "new", { now: NOW }).ok).toBe(false);
  });
});

describe("requirement lines → the expected documents", () => {
  const TEXT = "1- صورة الجواز ساري 6 اشهر 2- صورة شخصية بخلفية بيضاء 3- كشف حساب بنكي لآخر 3 أشهر 4- حجز فندق 5- رسوم السفارة 200 ريال";

  it("splits a run-on numbered list and drops its numbers and headings", () => {
    expect(requirementLines(TEXT)).toEqual(["صورة الجواز ساري 6 اشهر", "صورة شخصية بخلفية بيضاء", "كشف حساب بنكي لآخر 3 أشهر", "حجز فندق", "رسوم السفارة 200 ريال"]);
    expect(requirementLines("المتطلبات:\n- جواز السفر\n• حجز طيران")).toEqual(["جواز السفر", "حجز طيران"]);
    expect(requirementLines(null)).toEqual([]);
  });

  it("guesses a sensible kind for each line", () => {
    const kinds = (s: string) => guessDocKind(s);
    expect(kinds("صورة الجواز ساري 6 اشهر")).toBe("passport");
    expect(kinds("صورة شخصية بخلفية بيضاء")).toBe("photo");
    expect(kinds("كشف حساب بنكي لآخر 3 أشهر")).toBe("bank_statement");
    expect(kinds("حجز فندق مؤكد")).toBe("hotel");
    expect(kinds("حجز طيران ذهاب وعودة")).toBe("flight");
    expect(kinds("تأمين طبي")).toBe("insurance");
    expect(kinds("خطاب من جهة العمل")).toBe("employment_letter");
    expect(kinds("صورة من الإقامة")).toBe("residence");
    expect(kinds("خطاب دعوة")).toBe("invitation");
    expect(kinds("استمارة التأشيرة معبأة")).toBe("form");
    expect(kinds("إيصال سداد الرسوم")).toBe("receipt");
    expect(kinds("حضور شخصي للبصمة")).toBe("other");
  });

  const ids = ["t1", "t2"];
  let n = 0;
  const newId = () => `d${++n}`;

  it("makes one document per line, the personal ones once per traveller, fee lines left out", () => {
    n = 0;
    const docs = expectedDocs(requirementLines(TEXT), ids, newId);
    // passport ×2, photo ×2, bank statement, hotel — the fee line is not a document
    expect(docs.map((d) => `${d.kind}:${d.travelerId ?? "-"}`)).toEqual(["passport:t1", "passport:t2", "photo:t1", "photo:t2", "bank_statement:-", "hotel:-"]);
    expect(docs.every((d) => d.required && d.path === null && d.receivedAt === null)).toBe(true);
    expect(docs[0].label).toBe("صورة الجواز ساري 6 اشهر — مسافر 1");
  });

  it("a single traveller's labels carry no suffix", () => {
    n = 0;
    const docs = expectedDocs(["جواز السفر", "حجز طيران"], ["t1"], newId);
    expect(docs.map((d) => d.label)).toEqual(["جواز السفر", "حجز طيران"]);
    expect(docs[0].travelerId).toBe("t1");
    expect(docs[1].travelerId).toBeNull();
  });

  it("a catalogue with no list still asks for the passport and the photo; a list without a passport gets one", () => {
    n = 0;
    expect(expectedDocs([], ["t1"], newId).map((d) => d.kind)).toEqual(["passport", "photo"]);
    n = 0;
    expect(expectedDocs(["حجز فندق", "حجز طيران"], ["t1"], newId).map((d) => d.kind)).toEqual(["passport", "hotel", "flight"]);
  });

  it("repeats collapse", () => {
    n = 0;
    expect(expectedDocs(["حجز فندق", "حجز  فندق"], [], newId).filter((d) => d.kind === "hotel")).toHaveLength(1);
  });

  it("default services are a known, unpriced, undone starting list", () => {
    const s = defaultServices();
    expect(s.length).toBeGreaterThan(0);
    expect(s.every((x) => x.price === null && !x.done && x.label)).toBe(true);
  });
});

describe("the upload gate — what may enter a visa file", () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
  const pdf = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0, 0, 0, 0, 0, 0, 0, 0]);
  const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0]);
  const heic = Uint8Array.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);
  const exe = Uint8Array.from([0x4d, 0x5a, 0x90, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>");

  it("recognises the files by their bytes", () => {
    expect(sniffMime(jpeg)).toBe("image/jpeg");
    expect(sniffMime(png)).toBe("image/png");
    expect(sniffMime(pdf)).toBe("application/pdf");
    expect(sniffMime(webp)).toBe("image/webp");
    expect(sniffMime(heic)).toBe("image/heic");
    expect(sniffMime(exe)).toBeNull();
    expect(sniffMime(svg)).toBeNull();
  });

  it("accepts images and PDF within the cap, using the real type", () => {
    expect(checkUpload({ size: 1000, declaredType: "image/jpeg", head: jpeg })).toEqual({ ok: true, mime: "image/jpeg" });
    expect(checkUpload({ size: 1000, declaredType: "application/pdf", head: pdf })).toEqual({ ok: true, mime: "application/pdf" });
    // a browser that does not know the type: the bytes decide
    expect(checkUpload({ size: 1000, declaredType: "", head: png })).toEqual({ ok: true, mime: "image/png" });
    expect(checkUpload({ size: MAX_DOC_BYTES, declaredType: "image/png", head: png }).ok).toBe(true);
  });

  it("refuses empty, oversize, a wrong declared type, or bytes that are something else", () => {
    expect(checkUpload({ size: 0, declaredType: "image/png", head: png })).toEqual({ ok: false, problem: "empty" });
    expect(checkUpload({ size: MAX_DOC_BYTES + 1, declaredType: "image/png", head: png })).toEqual({ ok: false, problem: "too_large" });
    expect(checkUpload({ size: 10, declaredType: "image/svg+xml", head: svg })).toEqual({ ok: false, problem: "type" });
    expect(checkUpload({ size: 10, declaredType: "text/html", head: jpeg })).toEqual({ ok: false, problem: "type" });
    // an executable renamed to .jpg and sent as an image
    expect(checkUpload({ size: 10, declaredType: "image/jpeg", head: exe })).toEqual({ ok: false, problem: "type" });
  });

  it("the stored path has a random leaf and no name; the shown name is cleaned", () => {
    expect(docPath("F", "D", "image/jpeg", "leaf")).toBe("visa-files/F/D/leaf.jpg");
    expect(docPath("F", "D", "application/pdf", "leaf")).toBe("visa-files/F/D/leaf.pdf");
    expect(cleanFileName("C:\\Users\\x\\جواز.jpg")).toBe("جواز.jpg");
    expect(cleanFileName("a\u0000b/c.pdf")).toBe("c.pdf");
    expect(cleanFileName("   ")).toBe("مستند");
    expect(cleanFileName("x".repeat(300)).length).toBe(120);
  });
});

describe("cleaning what a person typed", () => {
  it("accepts a file's fields and returns only what was given, in stored form", () => {
    const r = cleanFields({ country: " جورجيا ", applicants: 3, clientName: "عميل تجريبي", clientPhone: "0500000000", feeService: 400.456, currency: "sar", appliedAt: "2026-11-01", expectedReplyAt: "2026-11-16", nextActionAt: "2026-11-02", note: "" });
    expect(r).toEqual({
      ok: true,
      set: { country: "جورجيا", applicants: 3, clientName: "عميل تجريبي", clientPhone: "0500000000", feeService: 400.46, currency: "SAR", appliedAt: "2026-11-01T09:00:00.000Z", expectedReplyAt: "2026-11-16T20:59:59.000Z", nextActionAt: "2026-11-01T21:00:00.000Z", note: null },
    });
    expect(cleanFields({})).toEqual({ ok: true, set: {} });
  });

  it("refuses the first bad field by name", () => {
    expect(cleanFields({ applicants: 0 })).toEqual({ ok: false, error: "عدد المتقدمين غير صالح." });
    expect(cleanFields({ applicants: 51 }).ok).toBe(false);
    expect(cleanFields({ applicants: 2.5 }).ok).toBe(false);
    expect(cleanFields({ country: "   " })).toEqual({ ok: false, error: "الدولة غير صالح." });
    expect(cleanFields({ clientName: "x".repeat(121) }).ok).toBe(false);
    expect(cleanFields({ feeService: -1 })).toEqual({ ok: false, error: "رسوم الخدمة غير صالح." });
    expect(cleanFields({ feeEmbassy: Number.NaN }).ok).toBe(false);
    expect(cleanFields({ currency: "ريال" }).ok).toBe(false);
    expect(cleanFields({ appliedAt: "2026-13-01" })).toEqual({ ok: false, error: "تاريخ التقديم غير صالح." });
    expect(cleanFields({ clientPhone: "abc" })).toEqual({ ok: false, error: "رقم الجوال غير صالح." });
    expect(cleanFields({ assignedTo: "not-a-uuid" }).ok).toBe(false);
  });

  it("null clears an optional field; a required one refuses to be cleared", () => {
    expect(cleanFields({ appointmentAt: null, nextAction: null, clientPhone: null })).toEqual({ ok: true, set: { appointmentAt: null, nextAction: null, clientPhone: null } });
    expect(cleanFields({ clientName: null }).ok).toBe(false);
  });

  it("services: label, key and price are checked", () => {
    expect(cleanServices([{ key: "tracking", label: "متابعة الطلب", price: 50.5, done: false }, { key: "x", label: "خدمة", price: null, done: true }])).toEqual({
      ok: true,
      services: [{ key: "tracking", label: "متابعة الطلب", price: 50.5, done: false }, { key: "x", label: "خدمة", price: null, done: true }],
    });
    expect(cleanServices([{ key: "a", label: "", price: null, done: false }]).ok).toBe(false);
    expect(cleanServices([{ key: "a", label: "b", price: -5, done: false }]).ok).toBe(false);
    expect(cleanServices([{ key: "a", label: "b", price: null, done: "yes" as unknown as boolean }]).ok).toBe(false);
    expect(cleanServices("nope").ok).toBe(false);
  });

  it("an edit's timeline line names what changed, dates by their day, and ignores what did not", () => {
    const before = { country: "جورجيا", applicants: 2, appliedAt: "2026-11-01T09:00:00+00:00", note: "x" };
    const changed = diffFields(before, { country: "جورجيا", applicants: 3, appliedAt: "2026-11-01T09:00:00.000Z", expectedReplyAt: "2026-11-16T20:59:59.000Z", note: "y" });
    expect(Object.keys(changed).sort()).toEqual(["applicants", "expectedReplyAt", "note"]);
    expect(describeChange(changed)).toBe("عدد المتقدمين: 3 · موعد الرد المتوقع: 2026-11-16 · الملاحظة");
    expect(describeChange({})).toBeNull();
  });
});

describe("submitting attaches what is in hand", () => {
  const doc = (id: string, receivedAt: string | null, submittedAt: string | null): VisaDoc => ({ id, kind: "other", label: id, travelerId: null, path: null, fileName: null, required: true, receivedAt, submittedAt, fromMessageId: null });

  it("stamps the received papers not yet attached, leaves the rest as they are", () => {
    const docs = [doc("a", "2026-10-01T00:00:00Z", null), doc("b", null, null), doc("c", "2026-10-02T00:00:00Z", "2026-10-03T00:00:00Z")];
    const out = stampSubmitted(docs, "2026-10-26T09:00:00Z");
    expect(out?.map((d) => d.submittedAt)).toEqual(["2026-10-26T09:00:00Z", null, "2026-10-03T00:00:00Z"]);
    expect(docs[0].submittedAt).toBeNull();
  });

  it("nothing to stamp, nothing written", () => {
    expect(stampSubmitted([doc("b", null, null), doc("c", "x", "y")], "now")).toBeNull();
    expect(stampSubmitted([], "now")).toBeNull();
  });
});

describe("the expected documents of China's real list (2026-10-26)", () => {
  it("drops the heading and the price note, and reads the introduction letter as a letter", () => {
    const docs = expectedDocs(
      ["الصين", "الجواز الأصلي ويوجد به اكثر من 6 اشهر صلاحيه و3 صفحات فارغيين", "صورتين شخصيه بخلفيه بيضاء مكشوفه الراس", "خطاب تعريف موجه الي سفاره الصين الشعبيه ويذكر فيه الاسم الجنسيه رقم الجواز الوظيفه الراتب", "صورة من هويه المقيم", "السعر يختلف حسب الجنسيه"],
      ["t1"],
      () => "id",
    );
    expect(docs.map((d) => d.kind)).toEqual(["passport", "photo", "employment_letter", "residence"]);
    expect(docs.some((d) => /^الصين$|السعر/.test(d.label))).toBe(false);
  });
});
