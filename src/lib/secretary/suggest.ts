import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/data/audit";
import { WORK_COLS, type WorkRow } from "@/lib/followups/rules";
import { followupRows } from "@/lib/followups/service";
import { noteFor } from "@/lib/murad/core";
import { addTeletelNote, listOpenConversations } from "@/lib/providers/teletel";
import { normalizeDraftData, type DraftData } from "@/lib/offer/draft-types";
import { normAr } from "@/lib/catalog/norm";
import { escapeHtml, staffSend } from "@/lib/telegram/staff-bot";
import { siteUrl } from "@/lib/telegram/ops-bot";
import { buildSuggestions, type CandidateHotel, rateKey } from "./suggest-core";
import { secretaryDb, secretarySettings } from "./core";

/**
 * «العروض المقترحة الأرخص» — the sweep (phase ج, api/murad/run): a client who
 * OBJECTED to the price (Murad's summary says the next move is an alternative)
 * or went SILENT after the offer for `silentHours` gets, beside the employee's
 * own file, up to two review-ready variants with the same route and dates and
 * cheaper same-star hotels, priced ONLY from the company's rate memory. The
 * seller is told in their secretary thread, on «تنبيهاتي», and in a private
 * Teletel note with a mention. Nothing reaches the client.
 */

const DONE_KEY = "secretary_suggestions";
const PER_RUN = 2;

type DoneMap = Record<string, { at: string; drafts: string[] }>;

const dayStartRiyadh = (nowMs: number) => new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(nowMs) + "T00:00:00+03:00").toISOString();

function due(r: WorkRow, silentHours: number, nowMs: number): "objection" | "silence" | null {
  if (r.status !== "open" || !r.offer_id || !r.assigned_to) return null;
  if (r.summary?.next === "alternative") return "objection";
  if (!r.offer_at) return null;
  const offerMs = Date.parse(r.offer_at);
  const lastClient = r.last_client_at ? Date.parse(r.last_client_at) : 0;
  if (!r.client_waiting && lastClient < offerMs && nowMs - offerMs >= silentHours * 3_600_000) return "silence";
  return null;
}

const fold = (s: string) => normAr(s).replace(/^ال/, "");

/** The candidates per draft city key: the city's catalogue hotels that have a remembered per-night rate. */
async function marketFor(db: SupabaseClient, draft: DraftData): Promise<Map<string, CandidateHotel[]>> {
  const names = [...new Set(draft.cities.map((c) => fold(c.city_name)).filter(Boolean))];
  const { data: cityRows } = await db.from("cities").select("id, arabic_name");
  const cityId = new Map<string, string>();
  for (const c of (cityRows ?? []) as { id: string; arabic_name: string }[]) if (names.includes(fold(c.arabic_name))) cityId.set(fold(c.arabic_name), c.id);
  const ids = [...new Set(cityId.values())];
  if (!ids.length) return new Map();
  const { data: hotels } = await db.from("hotels").select("id, arabic_name, stars, city_id").in("city_id", ids);
  const hotelRows = (hotels ?? []) as { id: string; arabic_name: string; stars: number | null; city_id: string }[];
  if (!hotelRows.length) return new Map();
  const { data: rates } = await db
    .from("hotel_rate_memory")
    .select("hotel_id, room_type_name, board_type, price, currency")
    .eq("per_night", true)
    .in("hotel_id", hotelRows.map((h) => h.id));
  const byHotel = new Map<string, CandidateHotel>();
  for (const h of hotelRows) byHotel.set(h.id, { id: h.id, name: h.arabic_name, stars: h.stars, rates: {} });
  for (const r of (rates ?? []) as { hotel_id: string; room_type_name: string; board_type: string | null; price: number; currency: string }[]) {
    const h = byHotel.get(r.hotel_id);
    if (h) h.rates[rateKey(r.room_type_name, r.board_type)] = { perNight: Number(r.price), currency: r.currency || "SAR" };
  }
  const byCityId = new Map<string, CandidateHotel[]>();
  for (const h of hotelRows) {
    const c = byHotel.get(h.id)!;
    byCityId.set(h.city_id, [...(byCityId.get(h.city_id) ?? []), c]);
  }
  const market = new Map<string, CandidateHotel[]>();
  for (const c of draft.cities) {
    const id = cityId.get(fold(c.city_name));
    if (c.key && id) market.set(c.key, byCityId.get(id) ?? []);
  }
  return market;
}

/** Typed-price difference between the original and a variant, when both sides are fully priced. */
function savingsLine(original: DraftData, variant: DraftData): string | null {
  const total = (d: DraftData) => d.hotels.reduce((n: number | null, h) => (n == null ? null : (h.rooms ?? []).reduce((m: number | null, r) => (m == null || r.price == null ? null : m + r.price), n)), 0 as number | null);
  const a = total(original);
  const b = total(variant);
  if (a == null || b == null || b >= a) return null;
  const cur = variant.hotels[0]?.manual_currency?.trim() || "";
  return `فنادقه أرخص بنحو ${Math.round((a - b) * 100) / 100} ${cur}`.trim();
}

export async function sweepSecretarySuggestions(nowMs = Date.now()): Promise<Record<string, unknown>> {
  const db = secretaryDb();
  const settings = await secretarySettings(db);
  if (settings.off || !settings.suggest.on) return { off: true };

  const { data: doneRow } = await db.from("app_settings").select("value").eq("key", DONE_KEY).maybeSingle();
  let done: DoneMap = {};
  try { done = JSON.parse((doneRow as { value?: string } | null)?.value ?? "{}") as DoneMap; } catch { done = {}; }
  const today = dayStartRiyadh(nowMs);
  const madeToday = Object.values(done).filter((d) => d.at >= today && d.drafts.length).length;
  if (madeToday >= settings.suggest.maxPerDay) return { capped: madeToday };

  const { data: rows } = await followupRows<WorkRow>((a, b) => db.from("sla_followups").select(WORK_COLS).eq("status", "open").not("offer_id", "is", null).order("id").range(a, b));
  const dueRows = rows.filter((r) => !done[r.id] && due(r, settings.suggest.silentHours, nowMs)).slice(0, PER_RUN);
  if (!dueRows.length) return { due: 0 };

  let made = 0;
  for (const r of dueRows) {
    const reason = due(r, settings.suggest.silentHours, nowMs)!;
    // the followup's offer → its draft (the same path /followups walks)
    const { data: offer } = await db.from("offers").select("serial").eq("id", r.offer_id!).maybeSingle();
    const serial = (offer as { serial: string } | null)?.serial;
    const { data: draftRow } = serial
      ? await db.from("offer_drafts").select("id, data").eq("data->>produced_serial", serial).limit(1).maybeSingle()
      : { data: null };
    const record = draftRow as { id: string; data: Record<string, unknown> } | null;
    const mark = async (drafts: string[]) => {
      done[r.id] = { at: new Date(nowMs).toISOString(), drafts };
      const keep = Object.entries(done).sort(([, a], [, b]) => (a.at < b.at ? 1 : -1)).slice(0, 500);
      await db.from("app_settings").upsert({ key: DONE_KEY, value: JSON.stringify(Object.fromEntries(keep)), updated_at: new Date(nowMs).toISOString() });
    };
    if (!record) { await mark([]); continue; }

    const draft = normalizeDraftData(record.data);
    const market = await marketFor(db, draft).catch(() => new Map<string, CandidateHotel[]>());
    const variants = buildSuggestions(draft, market, settings.suggest.proposals);
    if (!variants.length) { await mark([]); continue; }

    const client = draft.customer.customer_name || r.contact_name || `#${r.conversation_id}`;
    const ids: string[] = [];
    const lines: string[] = [];
    for (let k = 0; k < variants.length; k += 1) {
      const title = `مقترح سكرتيرك ${k + 1} — ${client}`;
      const { data: inserted } = await db.from("offer_drafts").insert({ data: variants[k].data, title, created_by: r.assigned_to }).select("id").maybeSingle();
      const id = (inserted as { id: string } | null)?.id;
      if (!id) continue;
      ids.push(id);
      const saved = savingsLine(draft, variants[k].data);
      lines.push([`مقترح ${k + 1}: ${variants[k].swapped.map((s) => `${s.city}: ${s.to} بدل ${s.from} (${s.stars}★)`).join("، ")}`, saved ? `— ${saved}` : ""].filter(Boolean).join(" "));
    }
    if (!ids.length) { await mark([]); continue; }
    await mark(ids);
    made += 1;

    const why = reason === "objection" ? "اعترض على السعر" : "سكت بعد العرض";
    const note = [
      `جهّزت لك عروضاً للعميل ${client} (${why}) — نفس المسار والتواريخ، فنادق بنفس التصنيف وسعر أقل من ذاكرة أسعارنا:`,
      ...lines,
      ...ids.map((id, k) => `مقترح ${k + 1}: ${siteUrl()}/basic/${id}`),
      "راجع الأسعار ثم أرسل ما يناسب — لم يصل العميل شيء.",
    ].join("\n");
    await db.from("secretary_messages").insert({ employee_id: r.assigned_to!, role: "secretary", content: note });
    const conv = (await listOpenConversations().catch(() => null))?.rows.find((c) => c.id === r.conversation_id);
    if (conv) await addTeletelNote(r.conversation_id, `💡 ${noteFor(conv)} جهزت لك عروضاً للعميل راجعها — «سكرتيري الخاص».`).catch(() => null);
    const { data: emp } = await db.from("employees").select("telegram_chat_id").eq("id", r.assigned_to!).maybeSingle();
    const chat = (emp as { telegram_chat_id: number | string | null } | null)?.telegram_chat_id;
    if (chat) {
      await staffSend(Number(chat), `🗂 <b>العرض جاهز</b> — ${escapeHtml(client)} (${why})\n${escapeHtml(lines.join("\n"))}`, [[{ text: "افتح سكرتيري الخاص", url: `${siteUrl()}/secretary` }]], {}, "secretary").catch(() => null);
    }
    await logAudit({
      action: "secretary.suggested",
      entity: "sla_followups",
      entity_id: r.id,
      meta: { conversation: r.conversation_id, reason, drafts: ids, seller: r.assigned_to },
    });
  }
  return { due: dueRows.length, made };
}
