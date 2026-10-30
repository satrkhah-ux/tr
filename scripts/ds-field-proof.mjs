// A/B: old raw-hex basicField/basicLabel vs the token version, computed in the real production CSS.
import puppeteer from "puppeteer-core";
import { readdirSync, readFileSync } from "node:fs";
// Run from a checkout that has just run `next build`:  node scripts/ds-field-proof.mjs  (CHROME=path to override the browser)
const root = ".next/static";
const css = [];
(function walk(d) { for (const f of readdirSync(d, { withFileTypes: true })) { const p = d + "/" + f.name; if (f.isDirectory()) walk(p); else if (p.endsWith(".css")) css.push(readFileSync(p, "utf8")); } })(root);
const all = css.join("\n");
if (!all.includes(".tv-field")) { console.log("NO BUILT CSS WITH THE NEW FIELD — wrong build"); process.exit(2); }
for (const v of ["--tv-border-default", "--tv-surface-raised", "--tv-text-brand", "--tv-action-focus", "--tv-text-muted", ".tv-field", "text-tv-text-muted"]) console.log("built CSS has", v, all.includes(v));
const OLD = "h-9 w-full rounded-[8px] border border-[#dbe6e1] bg-white px-2.5 text-[12.5px] text-[#185045] outline-none transition-colors focus:border-[#2aa87a]";
const NEW = "tv-field h-9 w-full rounded-[8px] border px-2.5 text-[12.5px] outline-none transition-colors";
const cases = { plain: "", phoneErr: " border-[#e0879b] focus:border-[#c22850]", priceErr: [" border-[#f0b4c2] bg-[#fff5f7]", " border-[#f0b4c2]"] };
let body = "";
for (const [k, extra] of Object.entries(cases)) { const [o, n] = Array.isArray(extra) ? extra : [extra, extra]; body += `<input id="old-${k}" class="${OLD}${o}"><input id="new-${k}" class="${NEW}${n}">`; }
body += `<label id="old-label" class="grid gap-1 text-[10.5px] font-bold text-[#557d78]">x</label><label id="new-label" class="grid gap-1 text-[10.5px] font-bold text-tv-text-muted">x</label>`;
const html = `<!doctype html><html><head><style>${all}</style></head><body>${body}</body></html>`;
const b = await puppeteer.launch({ executablePath: process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const p = await b.newPage();
await p.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
await p.setContent(html);
const read = (id) => p.$eval("#" + id, (e) => { const s = getComputedStyle(e); return [s.borderTopColor, s.backgroundColor, s.color].join(" | "); });
let bad = 0;
for (const theme of ["light", "dark"]) {
  await p.evaluate((t) => document.documentElement.classList.toggle("dark", t === "dark"), theme);
  for (const k of [...Object.keys(cases), "label"]) for (const focus of k === "label" ? [false] : [false, true]) {
    const r = {};
    for (const side of ["old", "new"]) { if (focus) await p.focus(`#${side}-${k}`); else await p.evaluate(() => document.activeElement?.blur()); r[side] = await read(`${side}-${k}`); }
    const same = r.old === r.new; if (!same && theme === "light") bad++; // dark may differ only where the old !important layer hid focus/error borders
    console.log(`${theme.padEnd(5)} ${k.padEnd(8)} ${focus ? "focus" : "     "} ${same ? "SAME" : "DIFF"}  old=${r.old}${same ? "" : `  new=${r.new}`}`);
  }
}
await b.close();
console.log(bad ? `LIGHT DIFFERENCES: ${bad}` : "light: zero differences");
process.exit(bad ? 1 : 0);
