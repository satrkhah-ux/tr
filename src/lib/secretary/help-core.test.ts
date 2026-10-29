import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Permission } from "@/lib/roles/roles";
import { HELP_TOPICS } from "./help-corpus";
import { helpContext, helpFallback, helpTopicsFor, isHowTo, matchHelp } from "./help-core";

const has = (...perms: Permission[]) => (p: Permission) => perms.includes(p);
const SALES = has("offers.write", "data.write");

describe("«اسأل مُراد» about the system", () => {
  it("every topic points at a page that exists", () => {
    expect(HELP_TOPICS.length).toBeGreaterThan(8);
    for (const t of HELP_TOPICS) {
      expect(existsSync(join(process.cwd(), "src/app", t.route, "page.tsx")), `${t.id} → ${t.route}`).toBe(true);
      expect(t.steps.length).toBeGreaterThan(1);
    }
    expect(new Set(HELP_TOPICS.map((t) => t.id)).size).toBe(HELP_TOPICS.length);
  });

  it("a how-to answer cites the real route", () => {
    const question = "كيف أنشئ بكج جديد لعميل؟";
    expect(isHowTo(question)).toBe(true);
    const matched = matchHelp(question, helpTopicsFor(SALES));
    expect(matched[0]?.route).toBe("/basic");
    expect(helpFallback(matched)).toContain("/basic");
    expect(helpContext(question, matched, helpTopicsFor(SALES))).toContain("الصفحة: /basic");
  });

  it("a page the employee cannot open is never explained", () => {
    const secrets = HELP_TOPICS.find((t) => t.route === "/developer/secrets")!;
    expect(secrets).toBeTruthy();
    const salesTopics = helpTopicsFor(SALES);
    expect(salesTopics).not.toContain(secrets);
    const question = "كيف أضيف مفتاح أو توكن جديد؟";
    expect(matchHelp(question, salesTopics)).not.toContain(secrets);
    expect(helpContext(question, matchHelp(question, salesTopics), salesTopics)).not.toContain("/developer/secrets");
    expect(helpFallback(matchHelp(question, salesTopics))).not.toContain("/developer");
    // the developer hears it
    expect(matchHelp(question, helpTopicsFor(has("developer.access")))[0]).toBe(secrets);
  });

  it("an unknown question says so instead of inventing", () => {
    expect(helpFallback(matchHelp("كيف أطلب طائرة خاصة للمريخ؟", helpTopicsFor(SALES)))).toContain("لست متأكداً");
  });
});
