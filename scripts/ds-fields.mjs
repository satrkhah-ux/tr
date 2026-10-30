// Design-system batch 3 (one-off codemod, kept for review): field class constants (`const field = "…"`,
// fieldClass, input, area …) — a bordered input on white — draw their colours from the tv-field utility
// (border.default / surface.raised / text.brand / action.focus, light + dark) instead of their own hex,
// slate and dark: classes. Sizes, radii, padding and weights stay. tv-field sorts before every colour
// utility, so a screen's error border on top of a constant still wins.
//   node scripts/ds-fields.mjs            (dry run)   node scripts/ds-fields.mjs --write
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SKIP = /AlmatarRequestForm|StaffRegisterForm|TraveliunTable|FlightBuilder|HotelSearchBar|[\\/]basic[\\/]styles\.ts$/;
const OKX = /[\\/]app[\\/](wallet|trade|markets|p2p|login|signup|support|admin|about|affiliate|app|careers|contact|copy-trading|forgot-password|kyc|law-enforcement)[\\/]|^src[\\/]components[\\/][^\\/]+\.tsx$/;
const NAME =/^(export )?const ([a-zA-Z]*(field|Field|input|Input)[a-zA-Z]*|area)(\s*:\s*string)?\s*=\s*$|^(export )?const ([a-zA-Z]*(field|Field|input|Input)[a-zA-Z]*|area)(\s*:\s*string)?\s*=\s*"/;
const COLOUR = /^(?:(?:dark|focus):)*(?:border-(?:\[#[0-9a-fA-F]{6}\]|slate-\d+)|bg-white|bg-\[#[0-9a-fA-F]{6}\]|text-(?:\[#[0-9a-fA-F]{6}\]|slate-\d+))$/;

export function toField(cls) {
  const parts = cls.split(/\s+/).filter(Boolean);
  if (!parts.includes("border") || parts.includes("border-0") || !parts.includes("bg-white")) return null;
  return ["tv-field", ...parts.filter((p) => !COLOUR.test(p))].join(" ");
}

const write = process.argv.includes("--write");
const changed = [];
function walk(dir) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) { walk(p); continue; }
    if (!/\.tsx?$/.test(f.name) || SKIP.test(p)) continue;
    const lines = readFileSync(p, "utf8").split("\n");
    let hit = false;
    for (let i = 0; i < lines.length; i++) {
      // inline: a static className="…" on an <input>/<select>/<textarea> (tag opened within the last 4 lines)
      const tag = [...lines.slice(Math.max(0, i - 4), i + 1).join(" ").matchAll(/<(\w+)/g)].pop();
      if (tag && /^(input|select|textarea)$/.test(tag[1]) && !OKX.test(p)) {
        lines[i] = lines[i].replace(/className="([^"]*)"/, (m, cls) => {
          const next = toField(cls);
          if (!next) return m;
          hit = true;
          changed.push(`${p}:${i + 1} (inline)`);
          return `className="${next}"`;
        });
      }
      if (!NAME.test(lines[i].trim())) continue;
      const at = lines[i].includes('"') ? i : i + 1; // value on the same line or the next
      lines[at] = lines[at].replace(/"([^"]*)"/, (m, cls) => {
        const next = toField(cls);
        if (!next) return m;
        hit = true;
        changed.push(`${p}:${at + 1}`);
        return `"${next}"`;
      });
    }
    if (hit && write) writeFileSync(p, lines.join("\n"));
  }
}
walk("src/components");
walk("src/app");
console.log(changed.length, "constants\n" + changed.join("\n"));
