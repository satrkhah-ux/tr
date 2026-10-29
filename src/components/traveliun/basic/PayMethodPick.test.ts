import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PAY_LOGOS } from "./PayMethodPick";

/** The payment marks are a fixed list of the files in public/images/payments: never a 404, never a file left unshown. */
describe("payment method marks", () => {
  const dir = join(process.cwd(), "public/images/payments");
  const files = readdirSync(dir).map((f) => `/images/payments/${f}`);
  const named = Object.values(PAY_LOGOS).flatMap((l) => (l ? [l.light, l.dark] : []));

  it("names only files that are there", () => {
    for (const path of named) expect(files).toContain(path);
  });

  it("shows every file dropped there", () => {
    for (const path of files) expect(named).toContain(path);
  });
});
