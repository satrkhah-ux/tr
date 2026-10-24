import { expect, it } from "vitest";
import { core } from "./core";

// «الأكثر طلباً اليوم» is ONE strip across the whole wall (the user, 2026-10-24): every screen at once, 60 s, every ten minutes
it("brings the bulletin up on every screen together and takes it down together", () => {
  const start = 600000;
  for (let elapsed = 0; elapsed < 600000; elapsed += 100) {
    const active = [1, 2, 3, 4].filter((screen) => core.countryBulletinElapsed(start + elapsed, screen, 4) >= 0);
    expect(active).toEqual(elapsed < 60000 ? [1, 2, 3, 4] : []);
  }
});
it("resumes at the same moment after a reload and repeats every ten minutes", () => {
  for (let screen = 1; screen <= 4; screen++) {
    expect(core.countryBulletinElapsed(600000 - 1, screen, 4)).toBe(-1);
    expect(core.countryBulletinElapsed(600000, screen, 4)).toBe(0);
    expect(core.countryBulletinElapsed(600000 + 59999, screen, 4)).toBe(59999);
    expect(core.countryBulletinElapsed(600000 + 60000, screen, 4)).toBe(-1);
    expect(core.countryBulletinElapsed(1200000 + 9000, screen, 4)).toBe(9000);
  }
  expect(core.countryBulletinElapsed(600000, 5, 4)).toBe(-1);
});
