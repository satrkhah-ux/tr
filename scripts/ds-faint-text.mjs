// Design-system batch 1 (one-off codemod, kept for review): every teal-grey text colour under 4.5:1 on white
// becomes the text-tv-text-faint token (light #5e776f — the same hue darkened to 4.5:1 on the tinted surface;
// dark unchanged #9fb3ac). Leaves dark:/placeholder: variants, the OKX pages and non-class hex alone.
//   node scripts/ds-faint-text.mjs            (dry run: counts)   node scripts/ds-faint-text.mjs --write
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OKX = /^src[\\/](app[\\/](wallet|trade|markets|p2p|login|signup|support)|components[\\/][^\\/]+\.tsx$)/;
const lum = (h) => { const c = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const onWhite = (h) => 1.05 / (lum(h) + 0.05);
function hs(hex) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return { h: 0, s: 0 };
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  return { h: (mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60, s };
}
/** the faint family: teal-grey (hue 155–172, low saturation) and too light for body text */
export const isFaint = (hex) => { const { h, s } = hs(hex); return h >= 155 && h <= 172 && s <= 0.16 && onWhite(hex) < 4.5; };

const write = process.argv.includes("--write");
const counts = {};
let files = 0;
function walk(dir) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) { walk(p); continue; }
    if (!/\.tsx?$/.test(f.name) || OKX.test(p)) continue;
    const s = readFileSync(p, "utf8");
    const next = s.replace(/(?<![\w-])((?:[a-z-]+:)*)text-\[#([0-9a-fA-F]{6})\]/g, (m, pre, hex) => {
      if (/(^|:)(dark|placeholder):/.test(pre) || !isFaint(hex)) return m;
      counts[hex.toLowerCase()] = (counts[hex.toLowerCase()] ?? 0) + 1;
      return `${pre}text-tv-text-faint`;
    });
    if (next !== s) { files++; if (write) writeFileSync(p, next); }
  }
}
walk("src");
console.log(files, "files", Object.values(counts).reduce((a, b) => a + b, 0), "classes", counts);
