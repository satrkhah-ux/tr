// «مساعد ترافليون» — builds the browser extension into extension/dist (load it unpacked, or zip it).
//
//   npm run ext:build                              → for https://pkg.traveliun.com
//   npm run ext:build -- --base=http://localhost:3240   → for a local dev server
//
// The manifest is written here, not kept as a file, so the system's address (and
// the permission for it) has one source: --base.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "dist");
const arg = process.argv.find((a) => a.startsWith("--base="));
const base = new URL(arg ? arg.slice("--base=".length) : "https://pkg.traveliun.com").origin;
// match patterns name the host without its port
const host = `${new URL(base).protocol}//${new URL(base).hostname}`;

const VERSION = "0.1.0";

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "icons"), { recursive: true });

const common = { bundle: true, target: "chrome116", define: { __TV_BASE__: JSON.stringify(base) }, logLevel: "warning", legalComments: "none" };
await build({ ...common, entryPoints: [join(here, "src/sw.ts")], outfile: join(out, "sw.js"), format: "esm" });
for (const name of ["popup", "panel", "link"]) {
  await build({ ...common, entryPoints: [join(here, `src/${name}.ts`)], outfile: join(out, `${name}.js`), format: "iife" });
}
for (const file of ["popup.html", "panel.html", "styles.css"]) cpSync(join(here, "static", file), join(out, file));
cpSync(join(here, "..", "public", "icons", "icon-192.png"), join(out, "icons", "icon.png"));

const manifest = {
  manifest_version: 3,
  name: "مساعد ترافليون",
  short_name: "ترافليون",
  description: "مساعد موظفي ترافليون: ملف العميل بجانب محادثة تيلي تيل، التنبيهات، وإرسال سعر فندق إلى الملف.",
  version: VERSION,
  minimum_chrome_version: "116",
  icons: { 16: "icons/icon.png", 48: "icons/icon.png", 128: "icons/icon.png" },
  action: { default_popup: "popup.html", default_title: "مساعد ترافليون", default_icon: { 16: "icons/icon.png", 32: "icons/icon.png" } },
  side_panel: { default_path: "panel.html" },
  background: { service_worker: "sw.js", type: "module" },
  permissions: ["storage", "sidePanel"],
  host_permissions: [`${host}/*`],
  // every page of ours, not /extension alone: the sign-in reaches /extension without a page load, and a script
  // matched to that path would never arrive — link.ts itself acts on /extension only
  content_scripts: [{ matches: [`${host}/*`], js: ["link.js"], run_at: "document_idle" }],
};
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`extension ${VERSION} → ${out} (for ${base})`);
