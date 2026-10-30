// Design-system batch 5 (one-off codemod, kept for review).
//  Cards: card class constants and static className="…" on a container (div/section/article/li/aside/form/
//  details) with a card radius + border + white fill take the tv-card utility (border.subtle +
//  surface.raised, light and dark) instead of their own border/fill and dark: classes.
//  Chips: the status colour pairs (success / danger / warning fill + text, and any dark: pair right after
//  them) become the status tokens, which carry their own dark values.
// Almatar and the OKX template pages are left alone.
//   node scripts/ds-cards-chips.mjs            (dry run)   node scripts/ds-cards-chips.mjs --write
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SKIP = /[\\/]almatar[\\/]|[\\/]app[\\/](wallet|trade|markets|p2p|login|signup|support|admin|about|affiliate|app|careers|contact|copy-trading|forgot-password|kyc|law-enforcement)[\\/]|^src[\\/]components[\\/][^\\/]+\.tsx$|[\\/]ui[\\/]/;
const CONST = /^\s*(export )?const [a-zA-Z]*(card|Card)[a-zA-Z]*(\s*:\s*string)?\s*=/;
const RADIUS = /^rounded-(2xl|xl|\[1[2-6]px\])$/;
const COLOUR = /^(?:dark:)?(?:border-\[#[0-9a-fA-F]{6}\]|bg-white|bg-\[#[0-9a-fA-F]{6}\])$/;

export function toCard(cls) {
  const p = cls.split(/\s+/).filter(Boolean);
  if (p.includes("tv-card") || !p.includes("border") || !p.includes("bg-white") || !p.some((x) => RADIUS.test(x))) return null;
  return ["tv-card", ...p.filter((x) => !COLOUR.test(x))].join(" ");
}

const STATUS = { "0f7a52": "success", c22850: "danger", a86a10: "warning" };
const light = (hex) => { const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255); return (Math.max(r, g, b) + Math.min(r, g, b)) / 2 > 0.9; };
/** a pale status fill + its status text (+ a dark: pair right after) → the status tokens */
export function toChips(line) {
  let n = 0;
  line = line.replace(/bg-\[#([0-9a-fA-F]{6})\] text-\[#(0f7a52|c22850|a86a10)\](?: dark:bg-\[#[0-9a-fA-F]{6}\] dark:text-\[#[0-9a-fA-F]{6}\])?/gi, (m, bg, fg) => {
    if (!light(bg)) return m;
    n++;
    const t = STATUS[fg.toLowerCase()];
    return `bg-tv-status-${t}-bg text-tv-status-${t}`;
  });
  return [line, n];
}

const write = process.argv.includes("--write");
const stats = { cardConst: 0, cardInline: 0, chips: 0 };
const files = new Set();
function walk(dir) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) { walk(p); continue; }
    if (!/\.tsx?$/.test(f.name) || SKIP.test(p) || /\.test\.tsx?$/.test(f.name)) continue;
    const src = readFileSync(p, "utf8");
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const [chipped, n] = toChips(lines[i]);
      lines[i] = chipped;
      stats.chips += n;
      if (CONST.test(lines[i])) {
        const at = /=\s*$/.test(lines[i]) ? i + 1 : i;
        lines[at] = lines[at].replace(/"([^"]*)"/, (m, cls) => { const c = toCard(cls); if (!c) return m; stats.cardConst++; return `"${c}"`; });
        continue;
      }
      const tag = [...lines.slice(Math.max(0, i - 4), i + 1).join(" ").matchAll(/<(\w+)/g)].pop();
      if (!tag || !/^(div|section|article|li|aside|form|details)$/.test(tag[1])) continue;
      lines[i] = lines[i].replace(/className="([^"]*)"/, (m, cls) => { const c = toCard(cls); if (!c) return m; stats.cardInline++; return `className="${c}"`; });
    }
    const out = lines.join("\n");
    if (out !== src) { files.add(p); if (write) writeFileSync(p, out); }
  }
}
walk("src");
console.log(files.size, "files", stats);
