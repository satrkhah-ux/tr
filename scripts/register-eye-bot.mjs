// Point the «عين الإدارة» bot at this deployment and give it its menu button.
// Usage: node scripts/register-eye-bot.mjs [https://pkg.traveliun.com]
//
// Run once after the token is in .env.local (locally) or the server .env.
// Idempotent — re-running just re-registers the same webhook and button.
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

const token = process.env.TELEGRAM_EYE_BOT_TOKEN;
if (!token) {
  console.error("TELEGRAM_EYE_BOT_TOKEN is missing.\nCreate the bot in @BotFather, then put the token in .env.local (and the server .env).");
  process.exit(1);
}

const site = (process.argv[2] ?? process.env.NEXT_PUBLIC_SITE_URL ?? "https://pkg.traveliun.com").replace(/\/$/, "");
const secret = process.env.TELEGRAM_EYE_WEBHOOK_SECRET || undefined;

const api = async (method, body) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json();
  console.log(`${method}: ${json.ok ? "ok" : "FAILED"}${json.description ? ` — ${json.description}` : ""}`);
  return json;
};

const me = await api("getMe");
if (me.ok) console.log(`  bot: @${me.result.username} (${me.result.first_name})`);

await api("setWebhook", {
  url: `${site}/api/telegram/eye`,
  allowed_updates: ["message", "callback_query"],
  ...(secret ? { secret_token: secret } : {}),
});

// The menu button opens the dashboard — this bot's audience is management.
await api("setChatMenuButton", {
  menu_button: { type: "web_app", text: "لوحة التحكم", web_app: { url: `${site}/tg?to=%2Fdashboard` } },
});

await api("setMyCommands", {
  commands: [
    { command: "start", description: "تعريف" },
    { command: "report", description: "تقرير اليوم بالصوت" },
    { command: "notes", description: "الملاحظات المفتوحة" },
  ],
  language_code: "ar",
});

await api("setMyDescription", {
  description: "عين الإدارة: تقرير يومي بالصوت عن الحضور وسرعة الرد على العملاء والعمليات والمبيعات، مع الملاحظات التي تحتاج قراراً.",
  language_code: "ar",
});

const info = await api("getWebhookInfo");
if (info.ok) console.log(`  webhook: ${info.result.url || "(none)"}  pending: ${info.result.pending_update_count ?? 0}`);
