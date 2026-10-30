// Design-system batch 4 (one-off codemod, kept for review).
//  1. Button class constants (btn, btnPrimary, primary, smallButton …) in the two looks the screens repeat —
//     primary (#185045 fill, white text) and secondary (bordered, #185045 text, pale hover) — drop their own
//     colours for buttonTone() from ui/button-variants.ts.
//  2. Static className="…" on a <button> in those same two looks gets tv-btn-primary / tv-btn-secondary.
//  3. Phones: a button with an explicit small height (h-6…9, size-6…9, py-0.5…1.5) gets max-sm:min-h-10
//     (and max-sm:min-w-10 when it is a square icon button) — 40px, ~45px under the 1.12 zoom.
// Dashed "add" buttons, danger buttons, the Almatar portal and the OKX template pages are left alone.
//   node scripts/ds-buttons.mjs            (dry run)   node scripts/ds-buttons.mjs --write
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SKIP = /[\\/]almatar[\\/]|[\\/]app[\\/](wallet|trade|markets|p2p|login|signup|support|admin|about|affiliate|app|careers|contact|copy-trading|forgot-password|kyc|law-enforcement)[\\/]|^src[\\/]components[\\/][^\\/]+\.tsx$|[\\/]ui[\\/]/;
const CONST = /^\s*(export )?const ([a-zA-Z]*(btn|Btn|button|Button)[a-zA-Z]*|primary)(\s*:\s*string)?\s*=/;
const HEX = (h) => new RegExp(`^(?:hover:)?(?:bg|text|border)-\\[#${h}\\]$`, "i");

/** "primary" | "secondary" | null, and the classes left once the look's own colours are removed */
export function classify(cls) {
  const p = cls.split(/\s+/).filter(Boolean);
  if (p.includes("tv-btn-primary") || p.includes("tv-btn-secondary") || p.includes("border-dashed")) return null;
  const drop = (re) => p.filter((x) => !re.some((r) => r.test(x)));
  if (p.some((x) => /^bg-\[#185045\]$/i.test(x)) && p.includes("text-white"))
    return ["primary", drop([/^bg-\[#185045\]$/i, /^text-white$/, /^hover:bg-\[#0f4439\]$/i, /^hover:opacity-90$/, /^dark:(bg|text|border)-/])];
  if (p.includes("border") && p.some((x) => /^text-\[#185045\]$/i.test(x)) && p.some((x) => /^hover:bg-\[#(f4f8f6|f4f6f3|f0f7f4)\]$/i.test(x)) && !p.some((x) => /^bg-(?!white$)/.test(x)))
    return ["secondary", drop([/^border-\[#[0-9a-f]{6}\]$/i, /^bg-white$/, /^text-\[#185045\]$/i, /^hover:bg-\[#[0-9a-f]{6}\]$/i, /^dark:(hover:)?(bg|text|border)-/])];
  return null;
}
/** phone tap size, added once */
export function tap(cls) {
  if (/max-sm:(min-)?(h|size)-/.test(cls)) return cls;
  if (/(?<![\w:-])size-[6-9](?![\w.-])/.test(cls)) return `${cls} max-sm:min-h-10 max-sm:min-w-10`;
  if (/(?<![\w:-])(h-[6-9]|py-(0\.5|1|1\.5))(?![\w.-])/.test(cls)) return `${cls} max-sm:min-h-10`;
  return cls;
}

const write = process.argv.includes("--write");
const stats = { constPrimary: 0, constSecondary: 0, inlinePrimary: 0, inlineSecondary: 0, tap: 0 };
const files = new Set();
function walk(dir) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) { walk(p); continue; }
    if (!/\.tsx?$/.test(f.name) || SKIP.test(p)) continue;
    const src = readFileSync(p, "utf8");
    const lines = src.split("\n");
    let usesTone = false;
    for (let i = 0; i < lines.length; i++) {
      if (CONST.test(lines[i])) {
        const at = /=\s*$/.test(lines[i]) ? i + 1 : i;
        lines[at] = lines[at].replace(/"([^"]*)"/, (m, cls) => {
          const c = classify(cls);
          if (!c) return m;
          stats[c[0] === "primary" ? "constPrimary" : "constSecondary"]++;
          usesTone = true;
          const rest = tap(c[1].join(" "));
          if (rest !== c[1].join(" ")) stats.tap++;
          return `\`\${buttonTone({ variant: "${c[0] === "primary" ? "default" : "secondary"}" })} ${rest}\``;
        });
        continue;
      }
      const tag = [...lines.slice(Math.max(0, i - 4), i + 1).join(" ").matchAll(/<(\w+)/g)].pop();
      if (!tag || tag[1] !== "button") continue;
      // static className="…": look + tap size; a template className={`…`}: tap size on its literal part only
      lines[i] = lines[i]
        .replace(/className="([^"]*)"/, (m, cls) => {
          const c = classify(cls);
          let next = c ? [`tv-btn-${c[0]}`, ...c[1]].join(" ") : cls;
          if (c) stats[c[0] === "primary" ? "inlinePrimary" : "inlineSecondary"]++;
          const t = tap(next);
          if (t !== next) stats.tap++;
          next = t;
          return `className="${next}"`;
        })
        .replace(/className=\{`([^`$]*)/, (m, head, at, line) => {
          if (line[at + m.length] === "$" && !/\s$/.test(head)) return m; // head ends mid-class (px-${n}): leave it
          const t = tap(head.trimEnd());
          if (t === head.trimEnd()) return m;
          stats.tap++;
          return `className={\`${t}${head.slice(head.trimEnd().length)}`;
        });
    }
    let out = lines.join("\n");
    if (usesTone && !/from "@\/components\/ui\/button-variants"/.test(out)) {
      const imports = [...out.matchAll(/^import [^;]+;\s*$/gm)];
      const last = imports.at(-1);
      const line = 'import { buttonTone } from "@/components/ui/button-variants";\n';
      out = last ? out.slice(0, last.index + last[0].length) + "\n" + line.trimEnd() + out.slice(last.index + last[0].length) : line + out;
    }
    if (out !== src) { files.add(p); if (write) writeFileSync(p, out); }
  }
}
walk("src");
console.log(files.size, "files", stats);
