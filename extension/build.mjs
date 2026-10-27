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
// Teletel's address (the side panel reads its conversations; teletel.js fills its reply box) — --teletel for a stand-in
const teletelArg = process.argv.find((a) => a.startsWith("--teletel="));
const teletel = new URL(teletelArg ? teletelArg.slice("--teletel=".length) : "https://chat.teletel.io").origin;
const teletelHost = `${new URL(teletel).protocol}//${new URL(teletel).hostname}`;
// the package employees install is https only: a local address, plain http or the test variants (which open every
// port of localhost, or the hotel sites over http) are refused unless --dev says this is a test build
const dev = process.argv.includes("--dev");
const insecure = [base, teletel].some((u) => new URL(u).protocol !== "https:") || process.argv.includes("--test-http");
if (insecure && !dev) {
  console.error("refusing: a distribution build is https only — add --dev for a local test build (never to be handed out)");
  process.exit(1);
}
// match patterns name the host without its port
const host = `${new URL(base).protocol}//${new URL(base).hostname}`;

const VERSION = "0.2.1";
const HOTEL_SITES = ["https://www.agoda.com/*", "https://www.booking.com/*", "https://www.almosafer.com/*"];
// --test-http: the same three over http too, for a stand-in served locally (Chrome's --host-resolver-rules) — tests only
if (process.argv.includes("--test-http")) HOTEL_SITES.push(...HOTEL_SITES.map((p) => p.replace("https://", "http://")));

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "icons"), { recursive: true });

const common = { bundle: true, target: "chrome116", define: { __TV_BASE__: JSON.stringify(base), __TV_TELETEL__: JSON.stringify(teletel) }, logLevel: "warning", legalComments: "none" };
await build({ ...common, entryPoints: [join(here, "src/sw.ts")], outfile: join(out, "sw.js"), format: "esm" });
for (const name of ["popup", "panel", "link", "teletel", "capture"]) {
  await build({ ...common, entryPoints: [join(here, `src/${name}.ts`)], outfile: join(out, `${name}.js`), format: "iife" });
}
for (const file of ["popup.html", "panel.html", "styles.css", "INSTALL-AR.txt"]) cpSync(join(here, "static", file), join(out, file));
cpSync(join(here, "..", "public", "icons", "icon-192.png"), join(out, "icons", "icon.png"));

const manifest = {
  manifest_version: 3,
  name: dev ? "مساعد ترافليون (تجربة)" : "مساعد ترافليون",
  short_name: "ترافليون",
  description: "مساعد موظفي ترافليون: ملف العميل بجانب محادثة تيلي تيل، التنبيهات، وإرسال سعر فندق إلى الملف.",
  version: VERSION,
  minimum_chrome_version: "116",
  icons: { 16: "icons/icon.png", 48: "icons/icon.png", 128: "icons/icon.png" },
  action: { default_popup: "popup.html", default_title: "مساعد ترافليون", default_icon: { 16: "icons/icon.png", 32: "icons/icon.png" } },
  side_panel: { default_path: "panel.html" },
  background: { service_worker: "sw.js", type: "module" },
  permissions: ["storage", "sidePanel"],
  // the system and Teletel only (the panel reads which conversation a tab shows); the hotel sites get their
  // button through content_scripts alone — no host permission there
  host_permissions: [`${host}/*`, `${teletelHost}/*`],
  // every page of ours, not /extension alone: the sign-in reaches /extension without a page load, and a script
  // matched to that path would never arrive — link.ts itself acts on /extension only
  content_scripts: [
    { matches: [`${host}/*`], js: ["link.js"], run_at: "document_idle" },
    // Teletel: fills the reply box when the side panel asks — never sends, never reads the conversation
    { matches: [`${teletelHost}/*`], js: ["teletel.js"], run_at: "document_idle" },
    // «أرسل السعر إلى الملف»: one button, read only on the employee's press
    { matches: HOTEL_SITES, js: ["capture.js"], run_at: "document_idle" },
  ],
};
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`extension ${VERSION} → ${out} (for ${base}, Teletel ${teletel})`);
