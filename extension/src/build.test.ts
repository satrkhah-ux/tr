import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** The package employees install is https only: a test build has to say it is one (--dev). */
const build = fileURLToPath(new URL("../build.mjs", import.meta.url));
const run = (...args: string[]) => spawnSync(process.execPath, [build, ...args], { encoding: "utf8" });

describe("extension/build.mjs", () => {
  it("refuses a distribution build pointed at plain http, a local address, or the http test variants", () => {
    for (const args of [["--base=http://localhost:3310"], ["--teletel=http://localhost:3398"], ["--test-http"]]) {
      const r = run(...args);
      expect(r.status, args.join(" ")).toBe(1);
      expect(r.stderr).toContain("https only");
    }
  });
});
