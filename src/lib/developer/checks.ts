import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { TranslationKey } from "@/lib/i18n";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getTeletelConfig } from "@/lib/providers/teletel";
import { DEFAULT_MODEL } from "@/lib/providers/openai";
import { getOcrProvider } from "@/lib/repackage/extract/ocr";
import { pdfEngine } from "@/lib/offer-doc/pdf";
import { eyeBotToken } from "@/lib/telegram/eye-bot";
import { opsBotToken } from "@/lib/telegram/ops-bot";
import { cronRunKey, type CronJob, type CronRun } from "@/lib/data/cron-runs";
import {
  ageStatus,
  CHECK_TIMEOUT_MS,
  latencyStatus,
  maskHost,
  scrub,
  withTimeout,
  worstStatus,
  type CheckGroup,
  type CheckResult,
  type CheckStatus,
  type Msg,
} from "./health";

/**
 * /developer's live checks: one cheap READ per external connection — never a
 * write, never a paid call. Each runs under its own timeout and all run in
 * parallel, so one dead service shows as «متوقف» instead of hanging the page.
 *
 * What leaves this module is statuses, latencies, names and masked hosts —
 * never a key or a token (scrub() cuts them out of any provider error text).
 * The caller is responsible for the developer.access gate.
 */

const env = (name: string): string | undefined => process.env[name] || undefined;

/** Every secret a check holds — cut out of any error text before it is shown. */
const SECRET_ENV = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "TELETEL_API_TOKEN",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "AVIATIONSTACK_API_KEY",
  "AZURE_DI_KEY",
  "TELEGRAM_EYE_BOT_TOKEN",
  "TELEGRAM_OPS_BOT_TOKEN",
  "TELEGRAM_WEBAPP_BOT_TOKEN",
];

const HOUR = 3_600_000;

type Outcome = Pick<CheckResult, "status" | "latencyMs" | "detail" | "extra" | "lastRunAt">;
type Check = { id: string; group: CheckGroup; label: TranslationKey; manual?: boolean; run: () => Promise<Outcome> };

const unconfigured = (...names: string[]): Outcome => ({
  status: "unconfigured",
  latencyMs: null,
  detail: { key: "dev.d.notConfigured", params: { env: names.join(" / ") } },
});

const timedOut = (): Outcome => ({
  status: "down",
  latencyMs: null,
  detail: { key: "dev.d.timeout", params: { s: CHECK_TIMEOUT_MS / 1000 } },
});

function failed(error: unknown): Outcome {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return timedOut();
  const reason = error instanceof Error ? error.message : String(error);
  return { status: "down", latencyMs: null, detail: { key: "dev.d.failed", params: { reason: scrub(reason, SECRET_ENV.map(env)) } } };
}

/** A non-2xx answer, said the way the developer acts on it: a refused key needs a new key. */
function httpProblem(status: number, latencyMs: number): Outcome {
  if (status === 401 || status === 403) return { status: "down", latencyMs, detail: { key: "dev.d.tokenRejected", params: { status } } };
  return { status: status >= 500 ? "down" : "warn", latencyMs, detail: { key: "dev.d.httpError", params: { status } } };
}

const ok = (latencyMs: number, detail: Msg, extra?: Msg[]): Outcome => ({ status: latencyStatus(latencyMs), latencyMs, detail, extra });

async function timed<T>(work: () => PromiseLike<T>): Promise<[T, number]> {
  const start = performance.now();
  const value = await work();
  return [value, Math.round(performance.now() - start)];
}

const signal = () => AbortSignal.timeout(CHECK_TIMEOUT_MS);
const get = (url: string, headers?: Record<string, string>) => fetch(url, { headers, signal: signal(), cache: "no-store" });

const supabaseUrl = () => env("NEXT_PUBLIC_SUPABASE_URL");
const serviceReady = () => Boolean(supabaseUrl() && env("SUPABASE_SERVICE_ROLE_KEY"));
const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;

// ---------- Telegram ----------
type TgReply<T> = { ok?: boolean; result?: T; description?: string };
type TgHook = { url?: string; pending_update_count?: number; last_error_date?: number; last_error_message?: string };

async function telegram<T>(token: string, method: string): Promise<TgReply<T>> {
  return (await (await get(`https://api.telegram.org/bot${token}/${method}`)).json()) as TgReply<T>;
}

/** getMe names the bot; a bot that lives on a webhook also has its webhook read (the first thing to check when a bot goes quiet). */
function botCheck(token: () => string | undefined, envName: string, webhook: boolean): () => Promise<Outcome> {
  return async () => {
    const value = token();
    if (!value) return unconfigured(envName);
    const [me, ms] = await timed(() => telegram<{ username?: string }>(value, "getMe"));
    if (!me.ok) return failed(new Error(me.description ?? "getMe"));
    const detail: Msg = { key: "dev.d.bot", params: { username: me.result?.username ?? "—" } };
    if (!webhook) return ok(ms, detail);

    const info = (await telegram<TgHook>(value, "getWebhookInfo")).result ?? {};
    if (!info.url) return { status: "warn", latencyMs: ms, detail, extra: [{ key: "dev.d.noWebhook" }] };
    const extra: Msg[] = [{ key: "dev.d.webhook", params: { host: maskHost(info.url), pending: info.pending_update_count ?? 0 } }];
    // Telegram keeps the last error forever; only a recent one means deliveries are failing now.
    const failing = Boolean(info.last_error_date && Date.now() / 1000 - info.last_error_date < 24 * 3600);
    if (failing) extra.push({ key: "dev.d.webhookError", params: { reason: scrub(info.last_error_message ?? "", [value]) } });
    return { ...ok(ms, detail, extra), ...(failing ? { status: "warn" as const } : {}) };
  };
}

// ---------- AviationStack ----------
/** The one live call: from the «اختبار» button only — the plan's monthly quota is about a hundred requests. */
async function flightApiCall(): Promise<Outcome> {
  const key = env("AVIATIONSTACK_API_KEY");
  if (!key) return unconfigured("AVIATIONSTACK_API_KEY");
  const base = env("AVIATIONSTACK_BASE_URL") ?? "https://api.aviationstack.com/v1";
  const [res, ms] = await timed(() => get(`${base}/flights?access_key=${encodeURIComponent(key)}&limit=1`));
  const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; info?: string; message?: string } };
  // the provider explains a refusal (quota, plan, key) in the body, whatever the status
  if (body.error) {
    const reason = scrub(body.error.info ?? body.error.message ?? body.error.code ?? "", [key]);
    return { status: "down", latencyMs: ms, detail: { key: "dev.d.apiError", params: { reason } } };
  }
  return res.ok ? ok(ms, { key: "dev.d.flightOk" }) : httpProblem(res.status, ms);
}

// ---------- scheduled jobs ----------
/**
 * A job's last run, from the row each run overwrites (data/cron-runs.ts). A run
 * that failed is «متوقف» whatever its age; otherwise its age against `everyMs`.
 */
function cronCheck(job: CronJob, everyMs: number, describe: (summary: Record<string, unknown>) => Msg): () => Promise<Outcome> {
  return async () => {
    if (!serviceReady()) return unconfigured("SUPABASE_SERVICE_ROLE_KEY");
    const { data, error } = await db().from("app_settings").select("value").eq("key", cronRunKey(job)).abortSignal(signal()).maybeSingle();
    if (error) return failed(error);
    let run: Partial<CronRun> | null = null;
    try {
      run = JSON.parse((data as { value?: string } | null)?.value ?? "null") as Partial<CronRun> | null;
    } catch {
      /* an unreadable row reads as no run */
    }
    if (!run?.at) return { status: "warn", latencyMs: null, detail: { key: "dev.d.cronNever" } };
    const summary = run.summary ?? {};
    return {
      status: run.ok ? ageStatus(Date.now() - Date.parse(run.at), everyMs) : "down",
      latencyMs: null,
      lastRunAt: run.at,
      detail: run.ok
        ? describe(summary)
        : { key: "dev.d.cronFailed", params: { reason: scrub(String(summary.error ?? ""), SECRET_ENV.map(env)) } },
    };
  };
}

// ---------- the list ----------
type SupplierRow = {
  name_ar: string;
  environment: string | null;
  enabled: boolean;
  credentials_encrypted: string | null;
  last_error: string | null;
};

const CHECKS: Check[] = [
  {
    id: "db",
    group: "core",
    label: "dev.c.db",
    run: async () => {
      if (!serviceReady()) return unconfigured("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
      const [{ error }, ms] = await timed(() => db().from("app_settings").select("key").limit(1).abortSignal(signal()));
      if (error) return failed(error);
      return ok(ms, { key: "dev.d.db", params: { host: maskHost(supabaseUrl()) } });
    },
  },
  {
    id: "auth",
    group: "core",
    label: "dev.c.auth",
    run: async () => {
      if (!serviceReady()) return unconfigured("SUPABASE_SERVICE_ROLE_KEY");
      const [{ data, error }, ms] = await timed(() => db().auth.admin.listUsers({ page: 1, perPage: 1 }));
      if (error) return failed(error);
      return ok(ms, { key: "dev.d.auth", params: { total: data.total } });
    },
  },
  {
    id: "storage",
    group: "core",
    label: "dev.c.storage",
    run: async () => {
      if (!serviceReady()) return unconfigured("SUPABASE_SERVICE_ROLE_KEY");
      const [{ data, error }, ms] = await timed(() => db().storage.listBuckets());
      if (error) return failed(error);
      const names = (data ?? []).map((b) => b.name);
      return ok(ms, { key: "dev.d.storage", params: { count: names.length, names: names.join("، ") || "—" } });
    },
  },
  {
    id: "pdf",
    group: "core",
    label: "dev.c.pdf",
    run: async () => {
      const engine = pdfEngine();
      if (engine.serverless) return { status: "ok", latencyMs: null, detail: { key: "dev.d.pdfServerless" } };
      if (!engine.executable) return { status: "down", latencyMs: null, detail: { key: "dev.d.pdfMissing" } };
      return { status: "ok", latencyMs: null, detail: { key: "dev.d.pdfLocal", params: { exe: engine.executable.split(/[\\/]/).pop() ?? "" } } };
    },
  },
  {
    id: "teletel",
    group: "api",
    label: "dev.c.teletel",
    run: async () => {
      const config = getTeletelConfig();
      if (!config) return unconfigured("TELETEL_BASE_URL", "TELETEL_API_TOKEN");
      const [res, ms] = await timed(() => get(`${config.baseUrl}/api/v1/profile`, { api_access_token: config.token }));
      // a firewall's 403 is an HTML page; Teletel's own refusal is JSON (same reading as diagnoseTeletel)
      if (res.status === 403 && !(res.headers.get("content-type") ?? "").includes("json")) {
        return { status: "down", latencyMs: ms, detail: { key: "dev.d.blocked" } };
      }
      if (!res.ok) return httpProblem(res.status, ms);
      const profile = (await res.json()) as { name?: string; accounts?: { id?: number; name?: string }[] };
      const account = profile.accounts?.find((a) => String(a.id) === config.accountId)?.name;
      return ok(ms, { key: "dev.d.teletel", params: { name: account ?? profile.name ?? "—", host: maskHost(config.baseUrl) } });
    },
  },
  {
    id: "openai",
    group: "api",
    label: "dev.c.openai",
    run: async () => {
      const key = env("OPENAI_API_KEY");
      if (!key) return unconfigured("OPENAI_API_KEY");
      const model = env("OPENAI_MODEL") ?? DEFAULT_MODEL;
      // reading a model's card is free — it spends no tokens
      const [res, ms] = await timed(() => get(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, { authorization: `Bearer ${key}` }));
      if (res.status === 404) return { status: "warn", latencyMs: ms, detail: { key: "dev.d.openaiModel", params: { model } } };
      if (!res.ok) return httpProblem(res.status, ms);
      return ok(ms, { key: "dev.d.openai", params: { model } });
    },
  },
  {
    id: "aviationstack",
    group: "api",
    label: "dev.c.aviationstack",
    manual: true,
    run: async () =>
      env("AVIATIONSTACK_API_KEY") ? { status: "idle", latencyMs: null, detail: { key: "dev.d.flightIdle" } } : unconfigured("AVIATIONSTACK_API_KEY"),
  },
  {
    id: "ocr",
    group: "api",
    label: "dev.c.ocr",
    // Azure bills per page and has no free read worth spending on — configured is all we say
    run: async () =>
      getOcrProvider().isConfigured()
        ? { status: "idle", latencyMs: null, detail: { key: "dev.d.ocr", params: { host: maskHost(env("AZURE_DI_ENDPOINT")) } } }
        : unconfigured("AZURE_DI_ENDPOINT", "AZURE_DI_KEY"),
  },
  {
    id: "weather",
    group: "api",
    label: "dev.c.weather",
    run: async () => {
      const [res, ms] = await timed(() => get("https://api.open-meteo.com/v1/forecast?latitude=24.71&longitude=46.68&current=temperature_2m"));
      if (!res.ok) return httpProblem(res.status, ms);
      const temp = ((await res.json()) as { current?: { temperature_2m?: number } }).current?.temperature_2m;
      return ok(ms, { key: "dev.d.weather", params: { temp: temp === undefined ? "—" : Math.round(temp) } });
    },
  },
  {
    id: "rates",
    group: "api",
    label: "dev.c.rates",
    run: async () => {
      // the first feed getRates() asks (data/rates-actions.ts); the others are its fallbacks
      const [res, ms] = await timed(() => get("https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/sar.json"));
      if (!res.ok) return httpProblem(res.status, ms);
      const date = ((await res.json()) as { date?: string }).date;
      // published daily: three days without a new date means the feed stopped
      const stale = !date || Date.now() - Date.parse(`${date}T00:00:00Z`) > 72 * HOUR;
      return stale
        ? { status: "warn", latencyMs: ms, detail: { key: "dev.d.ratesStale", params: { date: date ?? "—" } } }
        : ok(ms, { key: "dev.d.rates", params: { date } });
    },
  },
  {
    id: "suppliers",
    group: "api",
    label: "dev.c.suppliers",
    // the registry only: a supplier's own API is tested from /settings/suppliers, with its credentials
    run: async () => {
      if (!serviceReady()) return unconfigured("SUPABASE_SERVICE_ROLE_KEY");
      const { data, error } = await db()
        .from("hotel_suppliers")
        .select("name_ar, environment, enabled, credentials_encrypted, last_error")
        .order("priority", { ascending: true })
        .abortSignal(signal());
      if (error) return failed(error);
      const rows = (data ?? []) as SupplierRow[];
      if (rows.length === 0) return { status: "unconfigured", latencyMs: null, detail: { key: "dev.d.noSuppliers" } };
      const graded = rows.map((r): [CheckStatus, Msg] => {
        const params = { name: r.name_ar, env: r.environment || "live" };
        if (!r.enabled) return ["unconfigured", { key: "dev.d.supplierOff", params }];
        if (!r.credentials_encrypted) return ["warn", { key: "dev.d.supplierNoCreds", params }];
        if (r.last_error) return ["warn", { key: "dev.d.supplierError", params: { ...params, reason: scrub(r.last_error, SECRET_ENV.map(env)) } }];
        return ["ok", { key: "dev.d.supplierOn", params }];
      });
      return {
        status: worstStatus(graded.map(([s]) => s)),
        latencyMs: null,
        detail: { key: "dev.d.suppliers", params: { enabled: rows.filter((r) => r.enabled).length, total: rows.length } },
        extra: graded.map(([, m]) => m),
      };
    },
  },
  { id: "bot_eye", group: "bots", label: "dev.c.botEye", run: botCheck(eyeBotToken, "TELEGRAM_EYE_BOT_TOKEN", true) },
  { id: "bot_ops", group: "bots", label: "dev.c.botOps", run: botCheck(opsBotToken, "TELEGRAM_OPS_BOT_TOKEN", true) },
  {
    id: "bot_app",
    group: "bots",
    label: "dev.c.botApp",
    // the Mini App bridge: no webhook by design — its only act is the sign-in
    run: botCheck(() => env("TELEGRAM_WEBAPP_BOT_TOKEN"), "TELEGRAM_WEBAPP_BOT_TOKEN", false),
  },
  {
    id: "job_eye",
    group: "jobs",
    label: "dev.c.eyeJob",
    // The VPS crontab posts /api/eye/daily at 20:00 Riyadh; every delivery is an
    // eye.report_sent row.
    run: async () => {
      if (!eyeBotToken()) return unconfigured("TELEGRAM_EYE_BOT_TOKEN");
      if (!serviceReady()) return unconfigured("SUPABASE_SERVICE_ROLE_KEY");
      const { data, error } = await db()
        .from("audit_logs")
        .select("created_at, meta")
        .eq("action", "eye.report_sent")
        .order("created_at", { ascending: false })
        .limit(1)
        .abortSignal(signal());
      if (error) return failed(error);
      const last = ((data ?? []) as { created_at: string; meta: { delivered?: number } | null }[])[0];
      if (!last) return { status: "warn", latencyMs: null, detail: { key: "dev.d.eyeNever" } };
      return {
        status: ageStatus(Date.now() - Date.parse(last.created_at), 24 * HOUR),
        latencyMs: null,
        lastRunAt: last.created_at,
        detail: { key: "dev.d.eyeJob", params: { delivered: last.meta?.delivered ?? 0 } },
      };
    },
  },
  {
    id: "job_ops_daily",
    group: "jobs",
    label: "dev.c.opsDailyJob",
    // the VPS crontab: 07:00 every day (api/ops/daily/route.ts)
    run: cronCheck("ops_daily", 24 * HOUR, (s) => ({
      key: "dev.d.opsDailyJob",
      params: { travelled: Number(s.travelled ?? 0), completed: Number(s.completed ?? 0), alerts: Number(s.alerts ?? 0) },
    })),
  },
  {
    id: "job_ops_flights",
    group: "jobs",
    label: "dev.c.opsFlightsJob",
    // the VPS crontab: every 30 minutes (api/ops/flights/route.ts)
    run: cronCheck("ops_flights", HOUR / 2, (s): Msg =>
      s.skipped === "switched_off"
        ? { key: "dev.d.opsFlightsOff" }
        : s.skipped === "not_configured"
          ? { key: "dev.d.notConfigured", params: { env: "AVIATIONSTACK_API_KEY" } }
          : { key: "dev.d.opsFlightsJob", params: { checked: Number(s.checked ?? 0), moved: Number(s.moved ?? 0), alerts: Number(s.alerts ?? 0) } },
    ),
  },
  {
    id: "job_leads_pull",
    group: "jobs",
    label: "dev.c.leadsPullJob",
    // the VPS crontab: every 5 minutes (api/leads/pull/route.ts); late after 20
    run: cronCheck("leads_pull", 20 * 60 * 1000, (s) => ({
      key: "dev.d.leadsPullJob",
      params: { read: Number(s.read ?? 0), added: Number(s.added ?? 0), updated: Number(s.updated ?? 0) },
    })),
  },
  {
    id: "job_murad",
    group: "jobs",
    label: "murad.check",
    // the VPS crontab: every minute (api/murad/run/route.ts); the age rule is the shared one
    run: cronCheck("murad_run", 60_000, (s): Msg => {
      const n = (k: string) => Number(s[k] ?? 0);
      if (s.skipped === "switched_off") return { key: "murad.check.off" };
      if (s.skipped === "no_provider") return { key: "murad.check.noProvider" };
      if (s.skipped === "not_configured") return { key: "dev.d.notConfigured", params: { env: "TELETEL_BASE_URL / TELETEL_API_TOKEN" } };
      if (s.skipped === "busy") return { key: "murad.check.busy" };
      if (s.capped) return { key: "murad.check.capped", params: { used: n("used"), cap: n("cap") } };
      return { key: "murad.check.detail", params: { read: n("read"), auto: n("auto"), suggest: n("suggest"), used: n("used"), cap: n("cap") } };
    }),
  },
];

async function settle(check: Check, run: () => Promise<Outcome> = check.run): Promise<CheckResult> {
  const outcome = await withTimeout(run().catch(failed), CHECK_TIMEOUT_MS, timedOut);
  return { id: check.id, group: check.group, label: check.label, manual: check.manual, checkedAt: new Date().toISOString(), ...outcome };
}

export function runAllChecks(): Promise<CheckResult[]> {
  return Promise.all(CHECKS.map((check) => settle(check)));
}

export async function runCheck(id: string): Promise<CheckResult | null> {
  const check = CHECKS.find((c) => c.id === id);
  return check ? settle(check) : null;
}

export async function testFlightApi(): Promise<CheckResult> {
  const check = CHECKS.find((c) => c.id === "aviationstack") as Check;
  return settle(check, flightApiCall);
}

// ---------- the server itself ----------
export type ServerInfo = {
  /** the deploy's id — the shipped commit on the VPS (scripts/vps-deploy.sh), the page's data-dpl-id; null when run without one */
  deploymentId: string | null;
  node: string;
  nodeEnv: string;
  platform: string;
  uptimeSec: number;
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  now: string;
  timeZone: string;
};

export function serverInfo(): ServerInfo {
  const memory = process.memoryUsage();
  const mb = (bytes: number) => Math.round(bytes / 1_048_576);
  return {
    // dot access on purpose: Next inlines NEXT_DEPLOYMENT_ID at build (the Dockerfile ARG), which is the id this build serves
    deploymentId: process.env.NEXT_DEPLOYMENT_ID || null,
    node: process.version,
    nodeEnv: process.env.NODE_ENV ?? "",
    platform: `${process.platform}/${process.arch}`,
    uptimeSec: Math.round(process.uptime()),
    rssMb: mb(memory.rss),
    heapUsedMb: mb(memory.heapUsed),
    heapTotalMb: mb(memory.heapTotal),
    now: new Date().toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}
