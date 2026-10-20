import { expect, it } from "vitest";
import { core } from "./core";

it("hands the bulletin from 1 to 4 without any overlapping screen", () => {
  const start = 600000;
  for (let elapsed = 0; elapsed < 600000; elapsed += 100) {
    const active = [1, 2, 3, 4].filter((screen) => core.countryBulletinElapsed(start + elapsed, screen, 4) >= 0);
    expect(active).toEqual(elapsed < 144000 ? [Math.floor(elapsed / 36000) + 1] : []);
  }
});
it("resumes at the correct screen after reload and repeats every ten minutes", () => {
  for (let screen = 1; screen <= 4; screen++) {
    const start = 600000 + (screen - 1) * 36000;
    expect(core.countryBulletinElapsed(start - 1, screen, 4)).toBe(-1);
    expect(core.countryBulletinElapsed(start, screen, 4)).toBe(0);
    expect(core.countryBulletinElapsed(start + 35999, screen, 4)).toBe(35999);
    expect(core.countryBulletinElapsed(start + 36000, screen, 4)).toBe(-1);
    expect(core.countryBulletinElapsed(start + 600000 + 9000, screen, 4)).toBe(9000);
  }
});
