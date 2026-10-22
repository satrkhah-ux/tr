import { it, expect } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";
import { screenPage } from "./page";
import type { ScreenState } from "./server";

it.skipIf(!existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe"))("late arrival, complete presentation, hidden tab, queue and reload deduplication", async () => {
  const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  const at = Date.parse("2026-10-20T12:05:00Z");
  const events: ScreenState["events"] = [
    { id: "qa-1", at: at - 60000, name: "عميل الاختبار", country: "إندونيسيا", line: "استفسار عن إندونيسيا", test: true, src: null },
    { id: "qa-2", at: at - 38000, name: "عميل آخر", country: "جورجيا", line: "بكج إلى جورجيا", test: true, src: null },
  ];
  const state: ScreenState = { now: at, build: "qa", screens: 4, position: 0, slotMs: 12000, ads: [], ticker: null, countries: [], events, demo: null };
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.evaluateOnNewDocument((start) => {
      const qa = { time: start, hidden: false, frame: (() => {}) as FrameRequestCallback };
      Object.assign(window, { qa });
      Date.now = () => qa.time;
      Object.defineProperty(document, "hidden", { get: () => qa.hidden });
      window.requestAnimationFrame = (fn) => { qa.frame = fn; return 1; };
      window.setInterval = (() => 1) as unknown as typeof window.setInterval;
    }, at);
    await page.setRequestInterception(true);
    page.on("request", async (r) => {
      const path = new URL(r.url()).pathname;
      if (path === "/") await r.respond({ contentType: "text/html", body: screenPage(1, state, true) });
      else if (path.startsWith("/fonts/")) await r.respond({ contentType: "font/ttf", body: await readFile(`public${path}`) });
      else await r.respond({ status: 503, body: "" });
    });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("http://screen-test.local");
    const advance = (seconds: number, hidden = false) => page.evaluate(({ seconds, hidden }) => {
      const q = (window as unknown as { qa: { time: number; hidden: boolean; frame: FrameRequestCallback } }).qa;
      q.hidden = hidden;
      for (let i = 0; i < seconds; i++) { q.time += 1000; q.frame(q.time); }
    }, { seconds, hidden });
    expect(await page.$eval("#alert", (e) => e.className)).toBe("on");
    expect(await page.$eval("#aDest", (e) => e.textContent)).toBe("استفسار عن إندونيسيا");
    await page.evaluate(() => document.fonts.ready);
    await new Promise((r) => setTimeout(r, 2400));
    await mkdir("output/screen-review", { recursive: true });
    await page.screenshot({ path: "output/screen-review/customer-alert-1920.png" });
    await advance(5);
    await advance(60, true);
    await advance(14);
    expect(await page.$eval("#aDest", (e) => e.textContent)).toBe("استفسار عن إندونيسيا");
    await advance(1);
    expect(await page.$eval("#aDest", (e) => e.textContent)).toBe("بكج إلى جورجيا");
    await advance(19);
    expect(await page.$eval("#alert", (e) => e.className)).toBe("on");
    await advance(1);
    expect(await page.$eval("#alert", (e) => e.className)).toBe("");
    await page.reload();
    expect(await page.$eval("#alert", (e) => e.className)).toBe("");
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 30000);
