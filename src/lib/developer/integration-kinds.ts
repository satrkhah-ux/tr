/** «الربط الخارجي» — the kinds of thing the system leans on, and what is never stored about them. Pure. */
export type IntegrationKind = "server" | "database" | "api" | "bot" | "sheet" | "script" | "domain" | "subscription" | "cron" | "service";
export const INTEGRATION_KINDS: IntegrationKind[] = ["server", "database", "api", "bot", "sheet", "script", "domain", "subscription", "cron", "service"];
export const KIND_AR: Record<IntegrationKind, string> = {
  server: "خادم",
  database: "قاعدة بيانات",
  api: "واجهة برمجية",
  bot: "بوت",
  sheet: "شيت",
  script: "سكربت",
  domain: "نطاق",
  subscription: "اشتراك",
  cron: "مهمة مجدولة",
  service: "خدمة",
};

/**
 * Where a secret lives may be env var names («OPENAI_API_KEY، TELETEL_API_TOKEN»),
 * a path («/home/deploy/apps/traveliun-bot/.env») or words — never the value: a
 * word of 24 or more characters that is neither an env var name nor a path reads
 * as a key or a token, and is refused.
 */
export function looksLikeSecret(text: string): boolean {
  return text
    .split(/[\s،,()]+/u)
    .some((w) => w.length >= 24 && !/^[A-Z][A-Z0-9_]*$/.test(w) && !/^[~/]/.test(w));
}
