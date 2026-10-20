import { expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";
import { screenPage } from "./page";
import type { ScreenState } from "./server";

it.skipIf(!existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe"))("transparent motion, real counters, destination scenery and image-error fallback", async () => {
  const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const now = 600000;
  const countries = ["جورجيا", "مصر", "تركيا", "إندونيسيا", "فيتنام", "المملكة المتحدة", "ماليزيا", "التشيك"];
  const state: ScreenState = { now, build: "motion-test", screens: 4, position: 0, slotMs: 12000,
    ads: [{ src: "/screen-landmarks/georgia.webp", name: "جورجيا" }], ticker: null, countries,
    countryStats: countries.map((country, i) => ({ country, count: 80 - i * 7 })), events: [], demo: null };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.evaluateOnNewDocument(() => {
      const qa = { time: 600000, frame: (() => {}) as FrameRequestCallback };
      Object.assign(window, { qa });
      Date.now = () => qa.time;
      window.requestAnimationFrame = (fn) => { qa.frame = fn; return 1; };
    });
    await page.setRequestInterception(true);
    page.on("request", async (r) => {
      const path = new URL(r.url()).pathname;
      if (path === "/") await r.respond({ contentType: "text/html", body: screenPage(1, state, true) });
      else if (path.startsWith("/fonts/") || path.startsWith("/screen-landmarks/")) {
        try { await r.respond({ contentType: path.endsWith(".ttf") ? "font/ttf" : path.endsWith(".svg") ? "image/svg+xml" : "image/webp", body: await readFile(`public${path}`) }); }
        catch { await r.respond({ status: 404, body: "" }); }
      } else await r.respond({ status: 503, body: "" });
    });
    const errors: string[] = []; page.on("pageerror", (e) => errors.push(String(e)));
    const setTime = async (time: number) => {
      await page.evaluate((time) => {
        const qa = (window as unknown as { qa: { time: number; frame: FrameRequestCallback } }).qa;
        qa.time = time; qa.frame(time);
      }, time);
      await new Promise((r) => setTimeout(r, 80));
    };
    await page.goto("http://motion-test.local");
    await setTime(now + 400);
    const midway = Number(await page.$eval("#countryCount", (e) => e.textContent));
    expect(midway).toBeGreaterThan(0); expect(midway).toBeLessThan(80);
    await setTime(now + 1600);
    expect(await page.$eval("#countryCount", (e) => e.textContent)).toBe("80");
    expect(await page.$eval("#countries", (e) => getComputedStyle(e).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
    await page.evaluate(() => document.fonts.ready);
    await new Promise((r) => setTimeout(r, 1600));
    await mkdir("output/screen-review", { recursive: true });
    await writeFile("output/screen-review/motion-screen-1.html", screenPage(1, state, true));
    await writeFile("output/screen-review/motion-screen-2.html", screenPage(2, { ...state, position: 1 }, true));
    await page.screenshot({ path: "output/screen-review/motion-countries-1920.png" });
    await setTime(now + 6100);
    expect(await page.$eval("#countryHero", (e) => e.textContent)).toBe("مصر");
    expect(await page.$eval("#countryRank", (e) => e.textContent)).toBe("02");
    expect(await page.$eval("#countryCount", (e) => e.textContent)).toBe("73");
    await page.setViewport({ width: 1280, height: 720 });
    await new Promise((r) => setTimeout(r, 1500));
    await page.screenshot({ path: "output/screen-review/motion-countries-1280.png" });
    for (const country of ["georgia", "egypt"]) {
      state.now = 900000; state.countries = []; state.countryStats = [];
      state.events = [{ id: country, at: 890000, country, name: "أحمد العتيبي", line: country === "georgia" ? "بكج إلى جورجيا" : "بكج إلى مصر", src: `/screen-landmarks/${country}.webp`, test: true }];
      await page.goto("http://motion-test.local");
      await new Promise((r) => setTimeout(r, 2300));
      expect(await page.$eval("#alertImg", (e) => (e as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      expect(await page.$eval("#alertImg", (e) => (e as HTMLImageElement).src)).toContain(`/${country}.webp`);
      await page.screenshot({ path: `output/screen-review/motion-alert-${country}.png` });
    }
    await page.$eval("#alertImg", (e) => { (e as HTMLImageElement).src = "/screen-landmarks/missing.webp"; });
    await new Promise((r) => setTimeout(r, 200));
    expect(await page.$eval("#alertImg", (e) => (e as HTMLElement).style.display)).toBe("none");
    expect(await page.$eval("#alert", (e) => getComputedStyle(e).backgroundImage)).toContain("journey.svg");
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 30000);
