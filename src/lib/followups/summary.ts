import "server-only";
import { muradJson, muradProvider } from "@/lib/murad/model";
import { responsesJson } from "@/lib/providers/openai";
import { noteFor } from "@/lib/murad/core";
import { addTeletelNote, listOpenConversations, teletelGet, whatsappTemplateStatus } from "@/lib/providers/teletel";
import { WA_TEMPLATES } from "@/lib/operations/client-messages";
import { followupDb, followupPeople, followupRows } from "./service";
import { FOLLOWUP_SETTINGS_KEY, isOfferRow, offerLine, parseFollowupSettings, readable, STEP_TEMPLATE, TWO_HOUR_WINDOW_MS, WORK_COLS, type RawThreadMsg, type WorkRow } from "./rules";
import { parseSummary, renderThread, SUMMARY_SCHEMA, SUMMARY_VERSION, SUMMARY_SYSTEM, summaryPrompt, toSummaryMsg, unheardAfterUs, type FollowupSummary, type SummaryMsg } from "./summary-core";

/** The thread's last two pages (forty messages), oldest first — staff private notes included, marked. */
async function readMessages(conversationId: number): Promise<SummaryMsg[] | null> {
  const latest = await teletelGet<{ payload?: RawThreadMsg[] }>(`/conversations/${conversationId}/messages`);
  if (!latest) return null;
  let raw = latest.payload ?? [];
  const oldest = Math.min(...raw.map((m) => m.id ?? Infinity));
  if (raw.length && Number.isFinite(oldest)) {
    const older = await teletelGet<{ payload?: RawThreadMsg[] }>(`/conversations/${conversationId}/messages?before=${oldest}`);
    raw = [...(older?.payload ?? []), ...raw];
  }
  return raw.map(toSummaryMsg).filter((m) => m !== null).sort((a, b) => a.at - b.at);
}

/**
 * Murad reads the conversation and writes the file's summary and its next
 * message (summary-core.ts); kept on the row. `seen`: the conversation's last
 * activity it was made at, so it is made again only when the thread moves.
 */
export async function summarize(row: WorkRow, seen = Math.floor(Date.now() / 1000)): Promise<FollowupSummary | null> {
  if (!muradProvider()) return null;
  const messages = await readMessages(row.conversation_id);
  if (!messages) return null;
  const [people, status] = await Promise.all([followupPeople(), whatsappTemplateStatus()]);
  const now = Date.now();
  const lastClient = messages.filter((m) => m.fromClient).at(-1)?.at ?? 0;
  const windowOpen = now - lastClient * 1000 < 24 * 3600_000;
  const tpl = row.source !== "visa" && row.step !== null && !row.client_waiting ? STEP_TEMPLATE[row.step] : undefined;
  const templateReady = Boolean(tpl && status?.get(WA_TEMPLATES[tpl.key].name) === "APPROVED");
  // the card's «آخرها» and the waiting clock are about what the CLIENT sees — notes never count there
  const last = messages.filter((m) => !m.note).at(-1);
  const prompt = summaryPrompt({
    client: row.contact_name ?? "", seller: people.find((p) => p.id === row.assigned_to)?.name ?? null,
    offerLine: row.offer_line, step: row.step, clientWaiting: row.client_waiting, visa: row.source === "visa", thread: renderThread(messages),
    today: new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { timeZone: "Asia/Riyadh", dateStyle: "full" }).format(now),
    windowOpen, templateReady, waitedHours: last?.fromClient ? (now - last.at * 1000) / 3600_000 : null,
  });
  const schema = SUMMARY_SCHEMA as unknown as Record<string, unknown>;
  // a reasoning model on OpenAI (the chat model left drafts empty and missed offers on live threads, 2026-10-23); Claude as Murad has it
  const raw = muradProvider()?.provider === "claude"
    ? await muradJson("followup_summary", SUMMARY_SYSTEM, prompt, schema)
    : JSON.stringify(await responsesJson("followup_summary", schema, [{ type: "input_text", text: `${SUMMARY_SYSTEM}\n\n${prompt}` }], process.env["OPENAI_FOLLOWUP_MODEL"] || "gpt-5.5"));
  const summary = parseSummary(raw, { upto: last?.at ?? 0, step: row.step, at: new Date().toISOString(), unheard: unheardAfterUs(messages), seen }, !windowOpen && !templateReady);
  if (!summary) return null;
  await followupDb().from("sla_followups").update({
    summary,
    destination: row.destination ?? (summary.destination || null),
    ...(last ? { last_line: (last.fromClient ? readable(last.text || (last.audio ? "🎤 رسالة صوتية" : "")) : offerLine(last.text) || last.text || "📎 ملف")?.slice(0, 200), last_by: last.fromClient ? "client" : "us" } : {}),
  }).eq("id", row.id);
  return summary;
}

let running = false;
/** a few a minute: the model takes seconds each, and the minute job calls again */
const PER_RUN = 4;

/**
 * The minute job's share: summaries for the files that have none, whose thread
 * moved, or whose step changed — the client who wrote back first, then what is
 * due, then the rest (the old list last). Two hours after an offer, Murad's
 * draft also goes to the seller as a private Teletel note (the owner's switch,
 * «اقتراح مُراد بعد ساعتين»): never a message to the client.
 */
export async function summarizeDue(): Promise<{ made: number; noted: number }> {
  if (running || !muradProvider()) return { made: 0, noted: 0 };
  running = true;
  try {
    const db = followupDb();
    const [{ data }, open, { data: setting }] = await Promise.all([
      followupRows((a, b) => db.from("sla_followups").select(WORK_COLS).eq("status", "open").order("id").range(a, b)),
      listOpenConversations(),
      db.from("app_settings").select("value").eq("key", FOLLOWUP_SETTINGS_KEY).maybeSingle(),
    ]);
    const activity = new Map((open?.rows ?? []).map((c) => [c.id, c.lastActivityAt]));
    const now = Date.now();
    const rows = (data as WorkRow[]).filter((r) => {
      const s = r.summary;
      if (!s || (s.v ?? 1) < SUMMARY_VERSION) return true;
      if (isOfferRow(r) && s.step !== r.step) return true;
      const moved = activity.get(r.conversation_id);
      return moved !== undefined && moved > (s.seen ?? s.upto) + 5;
    });
    const rank = (r: WorkRow) => (r.client_waiting ? 0 : r.next_followup_at && Date.parse(r.next_followup_at) <= now ? 1 : isOfferRow(r) ? 2 : r.source === "sla" ? 4 : 3);
    rows.sort((a, b) => rank(a) - rank(b));
    // «المغلقة» carries Murad's reading too (the owner, 2026-10-25): a closed file never read, two a minute at most, after the open ones
    if (rows.length < PER_RUN) {
      // taken from a window that moves each minute: one that cannot be read never holds up the rest
      const k = Math.floor(now / 60_000) % 10;
      const { data: closed } = await db.from("sla_followups").select(WORK_COLS).eq("status", "done").is("summary", null).order("done_at", { ascending: false }).range(k * 2, k * 2 + Math.min(2, PER_RUN - rows.length) - 1);
      rows.push(...((closed ?? []) as WorkRow[]));
    }
    const settings = parseFollowupSettings(setting?.value);
    const people = settings.murad === "note" ? await followupPeople() : [];
    let made = 0, noted = 0;
    for (const row of rows.slice(0, PER_RUN)) {
      const summary = await summarize(row, activity.get(row.conversation_id) ?? Math.floor(now / 1000)).catch(() => null);
      if (!summary) continue;
      made++;
      const seller = people.find((p) => p.id === row.assigned_to);
      const due = row.next_followup_at && Date.parse(row.next_followup_at) <= now;
      // the two-hour note only while it is news (the offer at most six hours old) and in working hours (09:00–23:00 Riyadh)
      const hour = new Date(now + 3 * 3600_000).getUTCHours();
      const fresh = row.offer_at && now - Date.parse(row.offer_at) <= TWO_HOUR_WINDOW_MS && hour >= 9 && hour < 23;
      if (settings.murad === "note" && row.status === "open" && row.step === 0 && due && fresh && !row.client_waiting && !row.murad_note_at && summary.draft && seller) {
        const to = noteFor({ assignee: seller.name, assigneeId: seller.agentId, team: null });
        const posted = await addTeletelNote(row.conversation_id, [`💡 مُراد — متابعة العرض بعد ساعتين ${to}`.trim(), summary.advice, `رسالة مقترحة:\n${summary.draft}`, "أرسلها من «المتابعة» كما هي أو بعد تعديلها."].filter(Boolean).join("\n\n"));
        if (posted) {
          noted++;
          // the note itself moves the thread: count it as seen, so the summary is not made again for it
          await db.from("sla_followups").update({ murad_note_at: new Date().toISOString(), summary: { ...summary, seen: Math.floor(Date.now() / 1000) + 60 } }).eq("id", row.id);
        }
      }
    }
    return { made, noted };
  } finally {
    running = false;
  }
}
