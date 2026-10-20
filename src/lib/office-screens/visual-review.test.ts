import { it, expect } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";
import { screenPage } from "./page";
import { managerPage } from "../manager-screen/page";
import { buildScreen, MANAGER_DEFAULTS } from "../manager-screen/rules";

it.skipIf(!existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe"))("visual review and ten-minute bulletin boundaries", async () => {
  const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setRequestInterception(true);
    page.on("request", async (r) => {
      const name = new URL(r.url()).pathname;
      if (name.startsWith("/fonts/")) await r.respond({ status: 200, contentType: "font/ttf", headers: { "Access-Control-Allow-Origin": "*" }, body: await readFile(`public${name}`) });
      else await r.respond({ status: 503, body: "" });
    });
    const errors: string[] = []; page.on("pageerror", (e) => errors.push(String(e)));
    const now = Date.parse("2026-10-20T12:10:05Z");
    await page.evaluate((n) => { Object.assign(window, { qaNow: n }); Date.now = () => (window as unknown as { qaNow: number }).qaNow; }, now);
    const html = screenPage(1, { now, build: "qa", screens: 4, position: 0, slotMs: 12000, ads: [], ticker: null, countries: ["تركيا", "جورجيا", "تايلاند", "أذربيجان", "إندونيسيا", "البوسنة والهرسك", "ماليزيا", "بريطانيا"], events: [], demo: null }, true);
    await page.setContent(html.replace("<head>", '<head><base href="http://qa.local/">'));
    await page.evaluate(() => document.fonts.ready); await new Promise((r) => setTimeout(r, 1100));
    expect(await page.$eval("#countries", (e) => e.className)).toBe("on");
    await mkdir("output/screen-review", { recursive: true });
    await page.screenshot({ path: "output/screen-review/countries-1920.png" });
    await page.setViewport({ width: 1280, height: 720 }); await page.screenshot({ path: "output/screen-review/countries-1280.png" });
    await page.evaluate((n) => { Object.assign(window, { qaNow: n + 31000 }); }, now);
    await new Promise((r) => setTimeout(r, 100)); expect(await page.$eval("#countries", (e) => e.className)).toBe("");
    await page.evaluate((n) => { Object.assign(window, { qaNow: n + 600000 }); }, now);
    await new Promise((r) => setTimeout(r, 100)); expect(await page.$eval("#countries", (e) => e.className)).toBe("on");
    await page.setViewport({ width: 1920, height: 1080 });
    const built = buildScreen({ now, day: "2026-10-20", thresholds: MANAGER_DEFAULTS, hours: { open: "09:00", close: "23:00" }, leads: [], waits: [], open: [], agents: [], employees: [], audit: [], offers: [], confirms: [], drafts: [], ads: { currency: "USD", rows: [], latest: null }, murad: [], integrations: [], backup: null, ops: { live: [] } });
    await page.setContent(managerPage({ ...built, now, at: new Date(now).toISOString(), day: "2026-10-20", thresholds: MANAGER_DEFAULTS, daily: null, ticker: [{ at: new Date(now).toISOString(), red: true, text: "قرار الإدارة: توزيع الطلبات المتأخرة على الموظفين المتصلين ومتابعة الرد قبل نهاية الدوام · قيد التنفيذ · الموعد 2026-10-20" }] }).replace("<head>", '<head><base href="http://qa.local/">'));
    await page.evaluate(() => document.fonts.ready); await new Promise((r) => setTimeout(r, 300));
    await page.screenshot({ path: "output/screen-review/manager-1920.png" });
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 30000);
