import { describe, expect, it } from "vitest";
import { cleanErrorReport, cleanRoute, errorDedupeKey, explainKnownError } from "./error-core";

describe("«أرسل الخطأ لمُراد» — what may travel", () => {
  it("strips the stack, tokens, keys, e-mails and phones", () => {
    const r = cleanErrorReport({
      message: [
        "تعذّر الحفظ: Bearer abcdefghijklmnop1234 refused for ali@example.com +966 55 123 4567 key sk_live_ABCDEFGH12345678",
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
        "    at saveDraft (C:\\app\\src\\lib\\basic\\actions.ts:120:15)",
        "    at async Object.run (webpack-internal:///./node_modules/next/dist/server/app-render.js:4:9)",
      ].join("\n"),
      route: "/basic/03e31898-aaaa-bbbb-cccc-1234567890ab?client=Ali&token=xyz#top",
      action: "saveDraft",
      at: "2026-10-29T10:00:30.000Z",
    })!;
    for (const leaked of ["abcdefghijklmnop1234", "ali@example.com", "123 4567", "sk_live_ABCDEFGH12345678", "eyJhbGci", "actions.ts", "app-render", "Ali", "xyz"]) {
      expect(JSON.stringify(r)).not.toContain(leaked);
    }
    expect(r.message).toContain("تعذّر الحفظ");
    expect(r.route).toBe("/basic/:id");
    expect(r.action).toBe("saveDraft");
  });

  it("refuses an empty message and a strange action name", () => {
    expect(cleanErrorReport({ message: "   at x (a.ts:1:1)" })).toBeNull();
    expect(cleanErrorReport({ message: "x", action: "drop table; --" })?.action).toBeNull();
    expect(cleanRoute("javascript:alert(1)")).toBe("/");
  });

  it("one occurrence = one key; another minute or message = another", () => {
    const base = { message: "لا صلاحية", route: "/operations", action: null, at: "2026-10-29T10:00:30.000Z" };
    const k = errorDedupeKey("emp-1", base);
    expect(errorDedupeKey("emp-1", { ...base, at: "2026-10-29T10:00:59.000Z" })).toBe(k);
    expect(errorDedupeKey("emp-1", { ...base, at: "2026-10-29T10:01:00.000Z" })).not.toBe(k);
    expect(errorDedupeKey("emp-1", { ...base, message: "تعذّر الحفظ." })).not.toBe(k);
    expect(errorDedupeKey("emp-2", base)).not.toBe(k);
  });

  it("our own texts are explained without the model", () => {
    expect(explainKnownError("لا صلاحية")?.cause).toContain("صلاحية");
    expect(explainKnownError("سجّل الدخول بحساب موظف.")?.cause).toContain("جلستك");
    expect(explainKnownError("تعذّر الاتصال.")?.cause).toContain("الاتصال");
    expect(explainKnownError("Teletel API 404")?.cause).toContain("تيلي تيل");
    expect(explainKnownError("something odd happened")).toBeNull();
  });
});
