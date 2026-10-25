import { describe, expect, it } from "vitest";
import { VISA_DOC_LABEL, VISA_STATUSES, type TeletelPull, type VisaDoc, type VisaRow, type VisaTraveler } from "./types";
import {
  CONFIRM_STATUS,
  NEXT_STATUS,
  addCustomService,
  applyCatalogRow,
  applyPull,
  blankTraveler,
  buildNewFile,
  defaultBoardFilter,
  docState,
  docTotals,
  dueText,
  emptyNewFile,
  friendlyError,
  fromLocalInput,
  importTargets,
  isDefaultFilter,
  isVisaManager,
  mergeRead,
  pickFocus,
  pickStatus,
  relativeDay,
  resolveCountry,
  rowFlags,
  settle,
  sortedDocs,
  stepLabel,
  toDateInput,
  toLocalInput,
  toVisaFilter,
  toggleService,
  unlinkPull,
} from "./ui";

const NOW = Date.parse("2026-10-26T09:00:00+03:00");

const doc = (over: Partial<VisaDoc>): VisaDoc => ({ id: "d", kind: "passport", label: "جواز السفر", travelerId: null, path: null, fileName: null, required: true, receivedAt: null, submittedAt: null, fromMessageId: null, ...over });
const row = (over: Partial<VisaRow> = {}): VisaRow => ({
  id: "f1", serial: "VF-26-0001", status: "submitted", country: "جورجيا", visaType: "سياحية", applicants: 2, clientName: "أحمد", clientPhone: "0500000000", assignedTo: null,
  appliedAt: "2026-10-20", expectedReplyAt: "2026-10-24", feeService: 300, feeEmbassy: 200, currency: "SAR", paid: 0, nextAction: null, nextActionAt: null,
  updatedAt: "2026-10-25T10:00:00Z", createdAt: "2026-10-20T10:00:00Z", missingDocs: 0, ...over,
});

describe("the board's filter", () => {
  it("starts on the open files and sends only what is set", () => {
    expect(toVisaFilter(defaultBoardFilter())).toEqual({ status: "open", limit: 100 });
    expect(toVisaFilter({ ...defaultBoardFilter(), country: "جورجيا", assignedTo: "none", search: "  VF-26 ", focus: "unpaid" })).toEqual({
      status: "open", limit: 100, country: "جورجيا", assignedTo: "none", search: "VF-26", focus: "unpaid",
    });
    expect(isDefaultFilter(defaultBoardFilter())).toBe(true);
    expect(isDefaultFilter(pickStatus(defaultBoardFilter(), "approved"))).toBe(false);
  });

  it("a status counter drops the attention filter, an attention counter goes back to the open files — except «صدرت ولم تُسلَّم»", () => {
    const focused = pickFocus(defaultBoardFilter(), "missingDocs");
    expect(toVisaFilter(focused)).toMatchObject({ status: "open", focus: "missingDocs" });
    expect(pickStatus(focused, "rejected")).toMatchObject({ status: "rejected", focus: null });
    // an approved file is not open: its counter must look at all of them
    expect(toVisaFilter(pickFocus(defaultBoardFilter(), "toDeliver"))).toMatchObject({ status: "all", focus: "toDeliver" });
    // pressing the same counter again lets go of it
    expect(pickFocus(focused, "missingDocs").focus).toBeNull();
  });

  it("keeps the person and the country across counters", () => {
    const s = { ...defaultBoardFilter(), assignedTo: "emp-7", country: "تركيا" };
    expect(pickStatus(s, "ready")).toMatchObject({ assignedTo: "emp-7", country: "تركيا", status: "ready" });
  });
});

describe("a board row", () => {
  it("flags a late reply, a due action, the payment and what is owed", () => {
    expect(rowFlags(row(), NOW)).toEqual({ replyLate: true, actionDue: false, payment: "unpaid", due: 500 });
    expect(rowFlags(row({ expectedReplyAt: "2026-10-30" }), NOW).replyLate).toBe(false);
    expect(rowFlags(row({ status: "approved" }), NOW).replyLate).toBe(false);
    expect(rowFlags(row({ nextActionAt: "2026-10-26" }), NOW).actionDue).toBe(true);
    expect(rowFlags(row({ status: "delivered", nextActionAt: "2026-10-01" }), NOW).actionDue).toBe(false);
    expect(rowFlags(row({ paid: 120 }), NOW)).toMatchObject({ payment: "partial", due: 380 });
    expect(rowFlags(row({ paid: 500 }), NOW)).toMatchObject({ payment: "paid", due: 0 });
    expect(rowFlags(row({ feeService: 0, feeEmbassy: 0 }), NOW)).toMatchObject({ payment: "free", due: 0 });
  });

  it("says what is owed per currency", () => {
    expect(dueText({ SAR: 1200, USD: 300.5 })).toBe("1,200 SAR · 300.5 USD");
    expect(dueText({ SAR: 0 })).toBe("—");
    expect(dueText({})).toBe("—");
  });

  it("counts days by Riyadh's calendar", () => {
    expect(relativeDay("2026-10-26", NOW)).toBe("اليوم");
    expect(relativeDay("2026-10-27", NOW)).toBe("غداً");
    expect(relativeDay("2026-10-29", NOW)).toBe("بعد 3 أيام");
    expect(relativeDay("2026-10-25", NOW)).toBe("تأخر يوم");
    expect(relativeDay("2026-10-24", NOW)).toBe("تأخر يومان");
    // a moment just after midnight in Riyadh is already the next day there
    expect(relativeDay("2026-10-26T21:30:00Z", NOW)).toBe("غداً");
    expect(relativeDay(null, NOW)).toBe("");
  });
});

describe("the status steps", () => {
  it("offers every status a way on, and finished files none", () => {
    for (const s of VISA_STATUSES) for (const next of NEXT_STATUS[s]) expect(VISA_STATUSES).toContain(next);
    expect(NEXT_STATUS.submitted).toEqual(expect.arrayContaining(["approved", "rejected"]));
    expect(NEXT_STATUS.approved).toEqual(["delivered"]);
    expect(NEXT_STATUS.delivered).toEqual([]);
    // nobody jumps from «جديد» to «صدرت»
    expect(NEXT_STATUS.new).not.toContain("approved");
  });

  it("asks before telling the client an answer, or cancelling", () => {
    expect(CONFIRM_STATUS).toEqual(expect.arrayContaining(["approved", "rejected", "cancelled"]));
    expect(CONFIRM_STATUS).not.toContain("collecting");
  });

  it("words a step forward as what happened and a step back as a return", () => {
    expect(stepLabel("ready", "submitted")).toBe("تم التقديم للسفارة");
    expect(stepLabel("submitted", "approved")).toBe("صدرت التأشيرة");
    expect(stepLabel("submitted", "ready")).toBe("رجوع إلى «جاهز للتقديم»");
    expect(stepLabel("collecting", "cancelled")).toBe("إلغاء الملف");
  });
});

describe("errors and thrown actions", () => {
  it("shows an Arabic answer as it is and a stub or a code as a sentence", () => {
    expect(friendlyError("ليس لديك صلاحية")).toBe("ليس لديك صلاحية");
    expect(friendlyError("not implemented yet")).toBe("هذه الخدمة لم تُفعَّل على الخادم بعد.");
    expect(friendlyError("forbidden")).toBe("تعذّر تنفيذ العملية (forbidden).");
    expect(friendlyError("")).toBe("تعذّر تنفيذ العملية. حاول مرة أخرى.");
  });

  it("settle turns a throw into {ok:false} and keeps a good answer", async () => {
    expect(await settle(async () => ({ ok: true as const, id: "x" }))).toEqual({ ok: true, id: "x" });
    expect(await settle(async () => { throw new Error("not implemented yet"); })).toEqual({ ok: false, error: "هذه الخدمة لم تُفعَّل على الخادم بعد." });
    expect(await settle(async () => ({ ok: false as const, error: "forbidden" }))).toEqual({ ok: false, error: "تعذّر تنفيذ العملية (forbidden)." });
  });

  it("the management is whoever holds the manage key, the admin dashboard or the developer key", () => {
    expect(isVisaManager((p) => p === "visas.manage")).toBe(true);
    expect(isVisaManager((p) => p === "dashboard.admin")).toBe(true);
    expect(isVisaManager((p) => p === "developer.access")).toBe(true);
    expect(isVisaManager(() => false)).toBe(false);
  });
});

describe("dates in the inputs", () => {
  it("a plain date stays itself, a moment becomes Riyadh's day and clock", () => {
    expect(toDateInput("2026-10-30")).toBe("2026-10-30");
    expect(toDateInput("2026-10-30T22:00:00Z")).toBe("2026-10-31");
    expect(toDateInput(null)).toBe("");
    expect(toLocalInput("2026-10-30T07:30:00Z")).toBe("2026-10-30T10:30");
    expect(fromLocalInput("2026-10-30T10:30")).toBe("2026-10-30T10:30:00+03:00");
    expect(Date.parse(fromLocalInput("2026-10-30T10:30")!)).toBe(Date.parse("2026-10-30T07:30:00Z"));
    expect(fromLocalInput("")).toBeNull();
  });
});

describe("services", () => {
  it("ticks and unticks the standard ones and adds the employee's own line", () => {
    let list = toggleService([], "appointment");
    list = toggleService(list, "translation");
    expect(list.map((s) => s.label)).toEqual(["حجز موعد", "ترجمة"]);
    list = toggleService(list, "appointment");
    expect(list.map((s) => s.key)).toEqual(["translation"]);
    list = addCustomService(list, "  توصيل المستندات  ");
    list = addCustomService(list, "توصيل المستندات");
    list = addCustomService(list, "   ");
    expect(list.map((s) => s.key)).toEqual(["translation", "custom-2", "custom-3"]);
    expect(list[1].label).toBe("توصيل المستندات");
  });
});

describe("the new file", () => {
  const pull = (over: Partial<TeletelPull> = {}): TeletelPull => ({
    conversationId: 4821, contactId: 90, clientName: "سارة العتيبي", clientPhone: "+966501112233", leadId: "lead-1",
    intake: { country: "جورجيا", nationality: "سعودي", applicants: 3 }, attachments: [], ...over,
  });

  it("a Teletel pull fills the client, the conversation and what Murad's intake learned", () => {
    const f = applyPull(emptyNewFile(), pull());
    expect(f).toMatchObject({ clientName: "سارة العتيبي", clientPhone: "+966501112233", conversationId: 4821, contactId: 90, leadId: "lead-1", country: "جورجيا", nationality: "سعودي", applicants: "3" });
  });

  it("never writes over what the employee typed, and survives an empty intake", () => {
    const typed = { ...emptyNewFile(), country: "تركيا", nationality: "مصري", applicants: "5" };
    expect(applyPull(typed, pull())).toMatchObject({ country: "تركيا", nationality: "مصري", applicants: "5", clientName: "سارة العتيبي" });
    const none = applyPull(emptyNewFile(), pull({ intake: null, clientPhone: null }));
    expect(none).toMatchObject({ country: "", nationality: "", applicants: "1", clientPhone: "", conversationId: 4821 });
  });

  it("lets go of the link and keeps the typed fields", () => {
    const f = unlinkPull(applyPull(emptyNewFile(), pull()));
    expect(f).toMatchObject({ conversationId: null, contactId: null, leadId: null, clientName: "سارة العتيبي", country: "جورجيا" });
  });

  it("takes the catalogue row's type, price and currency as a starting point", () => {
    const f = applyCatalogRow(emptyNewFile(), { id: "v1", visaType: "سياحية — 30 يوماً", sellPrice: 350, sellCurrency: "USD" });
    expect(f).toMatchObject({ visaCatalogId: "v1", visaType: "سياحية — 30 يوماً", feeService: "350", currency: "USD" });
    // a row without a price leaves the fees alone
    expect(applyCatalogRow({ ...emptyNewFile(), feeService: "100" }, { id: "v2", visaType: null, sellPrice: null, sellCurrency: null })).toMatchObject({ visaCatalogId: "v2", feeService: "100", currency: "SAR" });
    expect(applyCatalogRow({ ...emptyNewFile(), visaCatalogId: "v1" }, null).visaCatalogId).toBeNull();
  });

  it("finds the country as the table spells it", () => {
    const countries = [{ id: "c1", name: "إندونيسيا" }, { id: "c2", name: "جورجيا" }];
    expect(resolveCountry(countries, "اندونيسيا")).toEqual({ id: "c1", name: "إندونيسيا" });
    expect(resolveCountry(countries, "أرمينيا")).toEqual({ id: null, name: "أرمينيا" });
    expect(resolveCountry(countries, "  ")).toEqual({ id: null, name: "  " });
  });

  it("refuses a file without client, country or a whole number of applicants, and says why", () => {
    const r = buildNewFile({ ...emptyNewFile(), applicants: "0", feeService: "-5" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["applicants", "clientName", "country", "fees"]);
    const frac = buildNewFile({ ...emptyNewFile(), clientName: "أ", country: "جورجيا", applicants: "1.5" });
    expect(frac.ok).toBe(false);
  });

  it("builds the contract's input — the pull's ids, the services, the fees, the nationality in the note", () => {
    let f = applyPull(emptyNewFile(), pull());
    f = { ...f, country: "جورجيا", countryId: "c2", appliedAt: "2026-10-28", feeService: "300", feeEmbassy: "150.5", assignedTo: "emp-3", note: "مستعجل", services: toggleService([], "submission") };
    f = { ...f, services: f.services.map((s) => ({ ...s, price: "100" })) };
    const r = buildNewFile(f);
    expect(r).toEqual({
      ok: true,
      input: {
        country: "جورجيا", countryId: "c2", visaCatalogId: null, visaType: null, applicants: 3, clientName: "سارة العتيبي", clientPhone: "+966501112233",
        conversationId: 4821, contactId: 90, leadId: "lead-1", assignedTo: "emp-3", appliedAt: "2026-10-28",
        services: [{ key: "submission", label: "التقديم للسفارة", price: 100, done: false }],
        feeService: 300, feeEmbassy: 150.5, currency: "SAR", note: "الجنسية: سعودي\nمستعجل",
      },
    });
  });

  it("leaves the assignee empty when none was picked, so the server decides", () => {
    const r = buildNewFile({ ...emptyNewFile(), clientName: "أ", country: "جورجيا" });
    expect(r.ok && r.input.assignedTo).toBeNull();
    expect(r.ok && r.input.note).toBeNull();
  });
});

describe("documents", () => {
  const docs = [
    doc({ id: "a", kind: "photo", label: "صورة شخصية", receivedAt: "2026-10-25T10:00:00Z" }),
    doc({ id: "b", kind: "passport" }),
    doc({ id: "c", kind: "insurance", label: "تأمين سفر", required: false }),
    doc({ id: "d", kind: "bank_statement", label: "كشف حساب بنكي" }),
  ];

  it("tells received from missing from optional", () => {
    expect(docs.map(docState)).toEqual(["received", "missing", "optional", "missing"]);
  });

  it("lists what is missing first, then the optional, then the received — each in file order", () => {
    expect(sortedDocs(docs).map((d) => d.id)).toEqual(["b", "d", "c", "a"]);
  });

  it("counts only the required ones", () => {
    expect(docTotals(docs)).toEqual({ required: 3, received: 1, missing: 2 });
    expect(docTotals([])).toEqual({ required: 0, received: 0, missing: 0 });
  });

  it("offers a Teletel attachment the documents still waiting, then a new document of each kind", () => {
    const targets = importTargets(docs, VISA_DOC_LABEL, ["passport", "photo"]);
    expect(targets.map((t) => t.value)).toEqual(["doc:b", "doc:c", "doc:d", "new:passport", "new:photo"]);
    expect(targets[0].label).toBe("جواز السفر (ينتظر ملفاً)");
    expect(targets[3].label).toBe("مستند جديد: جواز السفر");
  });
});

describe("a passport read", () => {
  const ali: VisaTraveler = { ...blankTraveler("t1"), fullName: "علي", nationality: "سعودي" };

  it("fills the traveller chosen with what the reader found and never blanks a field", () => {
    const list = mergeRead([ali], "t1", { fullName: "ALI SALEH", passportNo: "A1234567", nationality: null, birthDate: "1990-02-03", id: "zzz" }, "n1");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: "t1", fullName: "ALI SALEH", passportNo: "A1234567", nationality: "سعودي", birthDate: "1990-02-03" });
  });

  it("adds a new traveller when the employee says so", () => {
    const list = mergeRead([ali], "new", { fullName: "SARA", passportExpiry: "2030-01-01" }, "n1");
    expect(list.map((t) => t.id)).toEqual(["t1", "n1"]);
    expect(list[1]).toMatchObject({ fullName: "SARA", passportExpiry: "2030-01-01", result: null });
  });
});
