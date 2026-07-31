// Read today's real briefing WITHOUT sending it and WITHOUT spending a TTS call.
// Usage: node scripts/eye-dry-run.mjs [http://localhost:3000]
//
// Needs the app running (dev or prod). It calls GET /api/eye/daily, which runs
// the same builder the evening cron runs — so the numbers and the Saudi script
// printed here are exactly what management would hear.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(join(root, ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]] === undefined) {
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

const secret = process.env.ADMIN_API_SECRET;
if (!secret) {
  console.error("ADMIN_API_SECRET is missing from .env.local");
  process.exit(1);
}

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const res = await fetch(`${base}/api/eye/daily`, { headers: { "x-admin-secret": secret } });
if (!res.ok) {
  console.error(`GET ${base}/api/eye/daily → ${res.status}`);
  console.error(await res.text());
  process.exit(1);
}
const { report, script, summary, listeners } = await res.json();

const line = "─".repeat(72);
console.log(`\n${line}\nيوم ${report.day}   |   المستمعون: ${listeners.length ? listeners.join("، ") : "لا أحد مربوط بعد"}\n${line}`);

console.log(`\nالحضور     : ${report.attendance.present}/${report.attendance.expected}` +
  (report.attendance.absent.length ? `   غائب: ${report.attendance.absent.join("، ")}` : ""));
for (const w of report.attendance.windows) console.log(`             ${w.name}: ${w.from} → ${w.to}  (~${w.minutes}د)`);

console.log(`\nالاستجابة  : فُتحت ${report.response.opened} · رُدّ على ${report.response.answered} · بلا رد ${report.response.unanswered}` +
  (report.response.avgMinutes != null ? ` · متوسط ${report.response.avgMinutes}د` : ""));
if (report.response.worstSubject) console.log(`             الأطول: «${report.response.worstSubject}» ${report.response.worstMinutes}د`);

console.log(`\nالعمليات   : ${report.ops.liveCases} ملف · يحتاج إجراءً ${report.ops.needsAction} · حرِج ${report.ops.critical} · حجوزات مفتوحة ${report.ops.openBookings}`);
console.log(`المبيعات   : صدر ${report.sales.issuedToday} · مؤكَّد ${report.sales.confirmedToday}` +
  (report.sales.totalToday != null ? ` · ${report.sales.totalToday} ${report.sales.currency}` : ""));
if (report.activity.length) console.log(`النشاط     : ${report.activity.map((a) => `${a.name} (${a.count})`).join(" · ")}`);

console.log(`\n${line}\nالملاحظات (${report.notes.length})\n${line}`);
for (const n of report.notes) {
  const mark = n.severity === "critical" ? "🔴" : n.severity === "warn" ? "🟠" : "⚪️";
  console.log(`${mark} [${n.code}] ${n.title}${n.detail ? `\n     ${n.detail}` : ""}`);
}

console.log(`\n${line}\nالنصّ المنطوق (${script.length} حرفاً)\n${line}\n${script}`);
console.log(`\n${line}\nالملخّص المكتوب\n${line}\n${summary.replace(/<[^>]+>/g, "")}\n`);
