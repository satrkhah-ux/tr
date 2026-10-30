// Design-system batch 2 (one-off codemod, kept for review): an `outline-none` / `focus:outline-none` that
// removes the browser's focus outline with nothing in its place gets a visible keyboard ring from the
// action.focus token. A line that already draws a ring (focus:ring / focus-visible:ring / focus-visible:outline)
// is left as it is. OKX pages untouched.
//   node scripts/ds-focus-ring.mjs            (dry run)   node scripts/ds-focus-ring.mjs --write
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OKX = /^src[\\/](app[\\/](wallet|trade|markets|p2p|login|signup|support|admin|about|affiliate|app|careers|contact|copy-trading|forgot-password|kyc|law-enforcement)|components[\\/][^\\/]+\.tsx$)/;
const RING = " focus-visible:ring-2 focus-visible:ring-tv-action-focus";
const HAS_RING = /focus(-visible)?:ring|focus-visible:outline-(?!none)/;
const write = process.argv.includes("--write");
let files = 0, added = 0;
function walk(dir) {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name);
    if (f.isDirectory()) { walk(p); continue; }
    if (!/\.tsx?$/.test(f.name) || OKX.test(p) || f.name.startsWith("ds-")) continue;
    const s = readFileSync(p, "utf8");
    const next = s.split("\n").map((line) => {
      if (HAS_RING.test(line)) return line;
      return line.replace(/(?<![\w:-])((?:focus:)?outline-none)(?![\w-])/, (m) => { added++; return m + RING; });
    }).join("\n");
    if (next !== s) { files++; if (write) writeFileSync(p, next); }
  }
}
walk("src");
console.log(files, "files", added, "rings added");
