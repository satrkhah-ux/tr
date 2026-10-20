import { describe, expect, it } from "vitest";
import { mayAct, mayRead, validateResult } from "./rules";
import { canOpenPath } from "@/lib/roles/section-access";

describe("follow-up access and work rules", () => {
  const worker = { employeeId: "one", manager: false };
  it("exposes available files without permitting unclaimed writes", () => {
    expect(mayRead({ assigned_to: null, status: "open" }, worker)).toBe(true);
    expect(mayAct({ assigned_to: null }, worker)).toBe(false);
    expect(mayRead({ assigned_to: null, status: "done" }, worker)).toBe(false);
  });
  it("revokes the old worker after reassignment", () => {
    expect(mayRead({ assigned_to: "two", status: "open" }, worker)).toBe(false);
    expect(mayAct({ assigned_to: "two" }, worker)).toBe(false);
    expect(mayAct({ assigned_to: "two" }, { ...worker, manager: true })).toBe(true);
  });
  it("keeps client-list access separate from follow-up access", () => {
    expect(canOpenPath("/followups", (key) => key === "clients.view")).toBe(false);
    expect(canOpenPath("/followups/file", (key) => key === "followups.work")).toBe(true);
    expect(canOpenPath("/clients", (key) => key === "followups.work")).toBe(false);
  });
  it("requires future dates for unanswered or deferred calls", () => {
    expect(validateResult("no_answer", null, "")).toBe("due");
    expect(validateResult("later", "2020-01-01", "")).toBe("due");
    expect(validateResult("later", "2099-01-01", "")).toBeNull();
    expect(validateResult("interested", "invalid", "")).toBe("due");
  });
  it("requires explanations for terminal outcomes", () => {
    expect(validateResult("completed", null, "")).toBe("note");
    expect(validateResult("not_interested", null, "لا يرغب")).toBeNull();
    expect(validateResult("made-up", null, "x")).toBe("invalid");
    expect(validateResult("toString", null, "x")).toBe("invalid");
  });
});
