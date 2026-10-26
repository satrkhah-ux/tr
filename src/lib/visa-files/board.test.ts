import { describe, expect, it } from "vitest";
import { buildBoard, owes, type BoardFile } from "./board";
import { dueAmount, feeTotal, paymentState, type VisaDoc } from "./types";

const NOW = Date.parse("2026-10-26T12:00:00Z");
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const day = (d: number) => new Date(NOW + d * 86_400_000).toISOString();

const doc = (required: boolean, received: boolean): VisaDoc => ({ id: "d", kind: "passport", label: "x", travelerId: null, path: null, fileName: null, required, receivedAt: received ? day(-1) : null, submittedAt: null, fromMessageId: null });
let n = 0;
const file = (over: Partial<BoardFile> = {}): BoardFile => ({
  id: `id${++n}`, serial: `VF-26-${String(n).padStart(4, "0")}`, status: "new", country: "جورجيا", visaType: null, applicants: 1, clientName: "عميل تجريبي", clientPhone: "+966500000001", assignedTo: null,
  appliedAt: null, expectedReplyAt: null, repliedAt: null, feeService: 400, feeEmbassy: 0, currency: "SAR", paid: 0, nextAction: null, nextActionAt: null, updatedAt: day(-n), createdAt: day(-n), documents: [], ...over,
});

describe("counters", () => {
  const files = [
    file({ status: "new" }),
    file({ status: "collecting", documents: [doc(true, false), doc(true, true)] }),
    file({ status: "collecting", documents: [doc(false, false)] }),
    file({ status: "ready", paid: 400 }),
    file({ status: "submitted", expectedReplyAt: day(-2), assignedTo: A }),
    file({ status: "submitted", expectedReplyAt: day(5), assignedTo: A }),
    file({ status: "approved", paid: 100, feeService: 300, feeEmbassy: 100, assignedTo: B }),
    file({ status: "rejected", feeService: 0 }),
    file({ status: "delivered", paid: 400 }),
    file({ status: "cancelled" }),
    file({ status: "collecting", nextActionAt: day(-1), assignedTo: B }),
    file({ status: "delivered", nextActionAt: day(-9) }),
  ];
  const board = buildBoard(files, {}, [{ id: A, name: "ألف" }, { id: B, name: "باء" }], NOW);

  it("counts every status", () => {
    expect(board.counts.total).toBe(12);
    expect(board.counts.byStatus).toEqual({ new: 1, collecting: 3, ready: 1, submitted: 2, approved: 1, rejected: 1, delivered: 2, cancelled: 1 });
  });

  it("owed money per currency: not cancelled, not paid in full, not free", () => {
    // owing: new, 3 collecting, 2 submitted, the approved (300 left of 400) and a delivered one that never paid;
    // not owing: ready (paid), delivered (paid), rejected (no fee), cancelled
    expect(board.counts.unpaid.files).toBe(8);
    expect(board.counts.unpaid.due).toEqual({ SAR: 7 * 400 + 300 });
    expect(owes(files[9])).toBe(false);
  });

  it("sums each currency apart", () => {
    const mixed = buildBoard([file({ currency: "USD", feeService: 100.1 }), file({ currency: "USD", feeService: 50.2, paid: 10 }), file({ feeService: 10 })], {}, [], NOW);
    expect(mixed.counts.unpaid.due).toEqual({ USD: 140.3, SAR: 10 });
  });

  it("missing documents: open files with a required document not received", () => {
    expect(board.counts.missingDocs).toBe(1);
  });

  it("late replies: submitted, expected date gone, no answer", () => {
    expect(board.counts.replyOverdue).toBe(1);
  });

  it("actions due: an open file whose next action is now or past; finished files do not nag", () => {
    expect(board.counts.actionDue).toBe(1);
  });

  it("to deliver: approved and not handed over", () => {
    expect(board.counts.toDeliver).toBe(1);
  });

  it("the load per person is the open files they hold, zero for the idle", () => {
    expect(board.people).toEqual([{ id: A, name: "ألف", open: 2 }, { id: B, name: "باء", open: 1 }]);
    const idle = buildBoard([], {}, [{ id: A, name: "ألف" }], NOW);
    expect(idle.people).toEqual([{ id: A, name: "ألف", open: 0 }]);
    expect(idle.counts.byStatus.new).toBe(0);
  });
});

describe("filters", () => {
  const files = [
    file({ serial: "VF-26-0101", status: "new", clientName: "أحمد", clientPhone: "+966500000111", country: "جورجيا" }),
    file({ serial: "VF-26-0102", status: "submitted", clientName: "سارة", clientPhone: "+966500000222", country: "تركيا", assignedTo: A, expectedReplyAt: day(-3) }),
    file({ serial: "VF-26-0103", status: "approved", country: "جورجيا", assignedTo: B, paid: 400 }),
    file({ serial: "VF-26-0104", status: "delivered", country: "تركيا", feeService: 0 }),
    file({ serial: "VF-26-0105", status: "collecting", country: "جورجيا", paid: 100, documents: [doc(true, false)], nextActionAt: day(-1) }),
  ];
  const ids = (f: Parameters<typeof buildBoard>[1]) => buildBoard(files, f, [], NOW).rows.map((r) => r.serial);

  it("status: one, open (the four working ones) or all", () => {
    expect(ids({ status: "approved" })).toEqual(["VF-26-0103"]);
    expect(ids({ status: "open" }).sort()).toEqual(["VF-26-0101", "VF-26-0102", "VF-26-0105"]);
    expect(ids({ status: "all" })).toHaveLength(5);
    expect(ids({})).toHaveLength(5);
  });

  it("country, spelling folded", () => {
    expect(ids({ country: "تركيا" }).sort()).toEqual(["VF-26-0102", "VF-26-0104"]);
    expect(ids({ country: "جورجيا" })).toHaveLength(3);
  });

  it("assignee: a person, or the pool", () => {
    expect(ids({ assignedTo: A })).toEqual(["VF-26-0102"]);
    expect(ids({ assignedTo: "none" }).sort()).toEqual(["VF-26-0101", "VF-26-0104", "VF-26-0105"]);
  });

  it("payment: by state, and 'owing' is unpaid or partial", () => {
    expect(ids({ payment: "paid" })).toEqual(["VF-26-0103"]);
    expect(ids({ payment: "free" })).toEqual(["VF-26-0104"]);
    expect(ids({ payment: "partial" })).toEqual(["VF-26-0105"]);
    expect(ids({ payment: "owing" }).sort()).toEqual(["VF-26-0101", "VF-26-0102", "VF-26-0105"]);
  });

  it("each counter is also a focus", () => {
    expect(ids({ focus: "missingDocs" })).toEqual(["VF-26-0105"]);
    expect(ids({ focus: "replyOverdue" })).toEqual(["VF-26-0102"]);
    expect(ids({ focus: "actionDue" })).toEqual(["VF-26-0105"]);
    expect(ids({ focus: "toDeliver" })).toEqual(["VF-26-0103"]);
    expect(ids({ focus: "unpaid" }).sort()).toEqual(["VF-26-0101", "VF-26-0102", "VF-26-0105"]);
  });

  it("search finds a serial, a name or a phone's digits, however it is spelled", () => {
    expect(ids({ search: "0103" })).toEqual(["VF-26-0103"]);
    expect(ids({ search: "احمد" })).toEqual(["VF-26-0101"]);
    expect(ids({ search: "050 000 0222" })).toEqual(["VF-26-0102"]);
    expect(ids({ search: "تر" })).toHaveLength(2);
    expect(ids({ search: "لا يوجد" })).toEqual([]);
  });

  it("filters combine", () => {
    expect(ids({ country: "جورجيا", status: "open" }).sort()).toEqual(["VF-26-0101", "VF-26-0105"]);
  });

  it("the limit caps the rows but not the counters", () => {
    const b = buildBoard(files, { limit: 2 }, [], NOW);
    expect(b.rows).toHaveLength(2);
    expect(b.counts.total).toBe(5);
  });
});

describe("order — what needs doing first", () => {
  it("action due, then late replies, then the newest", () => {
    const files = [
      file({ serial: "NEWEST", status: "new", createdAt: day(-1) }),
      file({ serial: "OLDER", status: "new", createdAt: day(-8) }),
      file({ serial: "LATE", status: "submitted", expectedReplyAt: day(-4) }),
      file({ serial: "LATER", status: "submitted", expectedReplyAt: day(-9) }),
      file({ serial: "DUE", status: "collecting", nextActionAt: day(-1) }),
      file({ serial: "DUEOLD", status: "ready", nextActionAt: day(-6) }),
    ];
    expect(buildBoard(files, {}, [], NOW).rows.map((r) => r.serial)).toEqual(["DUEOLD", "DUE", "LATER", "LATE", "NEWEST", "OLDER"]);
  });

  it("a file both due and late sits with the due ones", () => {
    const files = [file({ serial: "LATE", status: "submitted", expectedReplyAt: day(-9) }), file({ serial: "BOTH", status: "submitted", expectedReplyAt: day(-1), nextActionAt: day(-1) })];
    expect(buildBoard(files, {}, [], NOW).rows[0].serial).toBe("BOTH");
  });

  it("rows carry the missing-document count, not the documents", () => {
    const row = buildBoard([file({ documents: [doc(true, false), doc(true, false), doc(true, true)] })], {}, [], NOW).rows[0];
    expect(row.missingDocs).toBe(2);
    expect("documents" in row).toBe(false);
  });
});

describe("what is owed and who has paid", () => {
  const fees = (feeService: number, feeEmbassy: number, paid: number) => ({ feeService, feeEmbassy, paid });

  it("payment state: free, unpaid, partial, paid (a cent short is still short)", () => {
    expect(paymentState(fees(0, 0, 0))).toBe("free");
    expect(paymentState(fees(300, 100, 0))).toBe("unpaid");
    expect(paymentState(fees(300, 100, 150))).toBe("partial");
    expect(paymentState(fees(300, 100, 399))).toBe("partial");
    expect(paymentState(fees(300, 100, 400))).toBe("paid");
    expect(paymentState(fees(300, 100, 450))).toBe("paid");
  });

  it("the amount due never goes below zero and rounds to the cent", () => {
    expect(feeTotal(fees(300, 100.25, 0))).toBe(400.25);
    expect(dueAmount(fees(300, 100, 150))).toBe(250);
    expect(dueAmount(fees(300, 100, 450))).toBe(0);
    expect(dueAmount(fees(0.1, 0.2, 0))).toBe(0.3);
  });

  it("the board's payment filter and the owed total agree on a part-payment", () => {
    const part = file({ feeService: 300, feeEmbassy: 100, paid: 150 });
    const b = buildBoard([part], { payment: "partial" }, [], NOW);
    expect(b.rows).toHaveLength(1);
    expect(b.counts.unpaid).toEqual({ files: 1, due: { SAR: 250 } });
  });
});
