import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loginName, passwordProblem } from "./password-rule";

describe("a temporary password the administration types", () => {
  it("is long enough, mixes letters and digits, and does not carry the login's name", () => {
    expect(passwordProblem("short1", "ahmed")).not.toBeNull();
    expect(passwordProblem("onlyletters", "ahmed")).not.toBeNull();
    expect(passwordProblem("1234567890", "ahmed")).not.toBeNull();
    expect(passwordProblem("ahmed2026xyz", loginName("Ahmed@Company.sa"))).not.toBeNull();
    expect(passwordProblem("Rq7-mountain-42", loginName("ahmed@company.sa"))).toBeNull();
  });
});

describe("setting it from the system", () => {
  const read = (file: string) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const body = (src: string, name: string) => src.slice(src.indexOf(`export async function ${name}`)).split(/\nexport /)[0];

  it("is gated before anything else, and never writes the password into the audit log", () => {
    const partner = body(read("partners/registration.ts"), "setPartnerPassword");
    const staff = body(read("data/employee-accounts.ts"), "setEmployeePassword");
    expect(partner.indexOf('currentCan("settings.manage")')).toBeGreaterThan(-1);
    expect(partner.indexOf('currentCan("settings.manage")')).toBeLessThan(partner.indexOf("setTemporaryPassword("));
    expect(staff.indexOf("guard()")).toBeGreaterThan(-1);
    expect(staff.indexOf("guard()")).toBeLessThan(staff.indexOf("setTemporaryPassword("));
    for (const src of [partner, staff]) {
      // neither a «password» field nor the variable as a value — must_change_password is the flag, not the secret
      for (const meta of src.match(/meta: \{[^}]*\}/g) ?? []) expect(meta).not.toMatch(/(?<![\w])password\s*[:,}]|:\s*password\b/);
    }
  });

  it("forces a new password at the first sign-in", () => {
    expect(read("auth/temp-password.ts")).toMatch(/must_change_password: true/);
    expect(body(read("data/employee-accounts.ts"), "setEmployeePassword")).toMatch(/must_change_password: true/);
  });
});
