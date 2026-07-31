import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { buildOpsDigest } from "@/lib/telegram/ops-digest";
import { anomalies, ticketMinutes } from "./anomalies";
import type { EyeReport, EyeSnapshot, Note } from "./types";

/**
 * Gather the day, then let the pure rules judge it.
 *
 * This module only READS and shapes; every decision about what is worth saying
 * lives in anomalies.ts, where it can be tested without a database. The split is
 * the same one signals.ts / operations-work.ts already use in this codebase.
 *
 * Service client throughout: the watcher runs from a webhook and from a cron,
 * neither of which has a session cookie. The permission check belongs to the
 * caller — the bot resolves a Telegram account to an employee holding
 * `dashboard.admin` before any of this is invoked.
 */

/** Riyadh is UTC+3 all year — no daylight saving, so a fixed shift is exact. */
const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;

export function riyadhParts(iso: string | number | Date = new Date()): { day: string; time: string } {
  const shifted = new Date(new Date(iso).getTime() + RIYADH_OFFSET_MS);
  const s = shifted.toISOString();
  return { day: s.slice(0, 10), time: s.slice(11, 16) };
}

function db(): SupabaseClient {
  return createSupabaseServiceClient() as unknown as SupabaseClient;
}

type EmployeeRow = {
  id: string;
  arabic_name: string;
  email: string | null;
  status: string | null;
  roles: { arabic_name: string } | { arabic_name: string }[] | null;
};

export async function buildEyeReport(): Promise<EyeReport> {
  const now = new Date();
  const nowIso = now.toISOString();
  const { day } = riyadhParts(now);
  // The working day starts at Riyadh midnight, which is 21:00 UTC the day before.
  const dayStartIso = new Date(Date.parse(`${day}T00:00:00Z`) - RIYADH_OFFSET_MS).toISOString();

  const supabase = db();

  const [empRes, attRes, ticketRes, auditRes, offerRes, bookingRes, ops] = await Promise.all([
    supabase.from("employees").select("id, arabic_name, email, status, roles(arabic_name)").order("arabic_name"),
    supabase.from("attendance_days").select("employee_id, first_seen_at, last_seen_at, beats").eq("day", day),
    // Open tickets of any age + everything touched today: the rules need both the
    // backlog and the day's own performance.
    supabase.from("care_tickets").select("id, subject, customer, employee_id, created_at, responded_at").order("created_at", { ascending: false }).limit(200),
    supabase.from("audit_logs").select("action, actor_id, actor_email, entity_id, created_at, meta").gte("created_at", dayStartIso).order("created_at"),
    supabase.from("offers").select("serial, status, total, currency, created_at").gte("created_at", dayStartIso),
    supabase.from("operation_bookings").select("id, operation_id, title, status, confirmed_at, confirmation_number").not("confirmed_at", "is", null),
    buildOpsDigest(5),
  ]);

  const employees = (empRes.data ?? []) as unknown as EmployeeRow[];
  const attendance = new Map(
    ((attRes.data ?? []) as { employee_id: string; first_seen_at: string; last_seen_at: string; beats: number }[]).map((a) => [a.employee_id, a]),
  );

  const audit = ((auditRes.data ?? []) as {
    action: string;
    actor_id: string | null;
    actor_email: string | null;
    entity_id: string | null;
    created_at: string;
    meta: Record<string, unknown> | null;
  }[]);

  // The audit log stores an email, not a name — resolve it once so the briefing
  // says «هاني» rather than «accounts@traveliun.com».
  const nameByEmail = new Map<string, string>();
  const actionsByActor = new Map<string, number>();
  for (const e of employees) if (e.email) nameByEmail.set(e.email, e.arabic_name);
  for (const entry of audit) {
    if (!entry.actor_id) continue;
    actionsByActor.set(entry.actor_id, (actionsByActor.get(entry.actor_id) ?? 0) + 1);
  }

  const snapshot: EyeSnapshot = {
    employees: employees.map((e) => {
      const att = attendance.get(e.id);
      const role = Array.isArray(e.roles) ? e.roles[0] : e.roles;
      return {
        id: e.id,
        name: e.arabic_name,
        active: (e.status ?? "Active") === "Active",
        section: role?.arabic_name ?? null,
        first_seen_at: att?.first_seen_at ?? null,
        last_seen_at: att?.last_seen_at ?? null,
        beats: att?.beats ?? 0,
        actions_today: actionsByActor.get(e.id) ?? 0,
      };
    }),
    tickets: ((ticketRes.data ?? []) as { id: string; subject: string; customer: string | null; employee_id: string | null; created_at: string; responded_at: string | null }[]).map((t) => ({
      ...t,
      employee_name: employees.find((e) => e.id === t.employee_id)?.arabic_name ?? null,
    })),
    audit: audit.map((a) => ({
      action: a.action,
      actor_id: a.actor_id,
      actor_name: nameByEmail.get(a.actor_email ?? "") ?? a.actor_email ?? null,
      entity_id: a.entity_id,
      created_at: a.created_at,
      meta: a.meta,
    })),
    offers: ((offerRes.data ?? []) as { serial: string; status: string; total: number | null; created_at: string }[]),
    bookings: ((bookingRes.data ?? []) as { id: string; operation_id: string; title: string; status: string; confirmed_at: string | null; confirmation_number: string | null }[]),
    ops,
  };

  // ---- the sections ----
  const expected = snapshot.employees.filter((e) => e.active);
  const present = expected.filter((e) => e.first_seen_at);

  const openTickets = snapshot.tickets.filter((t) => !t.responded_at);
  const answeredToday = snapshot.tickets.filter((t) => t.responded_at && riyadhParts(t.responded_at).day === day);
  const openedToday = snapshot.tickets.filter((t) => riyadhParts(t.created_at).day === day);
  const durations = answeredToday.map((t) => ticketMinutes(t, nowIso)).filter((m): m is number => m != null);
  const worst = [...openTickets].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];

  const offersToday = snapshot.offers;
  const currency = (offerRes.data as { currency?: string }[] | null)?.[0]?.currency ?? "SAR";
  const issued = offersToday.filter((o) => o.status !== "draft");

  const report: EyeReport = {
    day,
    attendance: {
      expected: expected.length,
      present: present.length,
      absent: expected.filter((e) => !e.first_seen_at).map((e) => e.name),
      windows: present.map((e) => ({
        name: e.name,
        from: riyadhParts(e.first_seen_at!).time,
        to: riyadhParts(e.last_seen_at!).time,
        // one beat per ~30s of an open screen; a floor of one minute so a single
        // beat does not read as zero.
        minutes: Math.max(1, Math.round((e.beats * 30) / 60)),
      })),
    },
    response: {
      opened: openedToday.length,
      answered: answeredToday.length,
      unanswered: openTickets.length,
      avgMinutes: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
      worstMinutes: worst ? ticketMinutes(worst, nowIso) : null,
      worstSubject: worst?.subject ?? null,
    },
    ops,
    sales: {
      issuedToday: issued.length,
      confirmedToday: offersToday.filter((o) => o.status === "confirmed").length,
      totalToday: issued.length ? issued.reduce((sum, o) => sum + (o.total ?? 0), 0) : null,
      currency,
    },
    activity: [...actionsByActor.entries()]
      .map(([id, count]) => ({ name: snapshot.employees.find((e) => e.id === id)?.name ?? "—", count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    notes: anomalies(snapshot, nowIso, day),
  };

  return report;
}

/**
 * Write the notes down so they acquire an age.
 *
 * A repeat is an UPDATE on unique(code, subject_id): `times_seen` climbs and
 * `last_seen_day` moves, which is what lets tomorrow say «متكرّرة منذ يومين»
 * without anyone remembering anything. A note management has already
 * acknowledged stays acknowledged — it is not resurrected by being true again.
 */
export async function persistNotes(notes: Note[], day: string): Promise<void> {
  if (notes.length === 0) return;
  const supabase = db();

  for (const note of notes) {
    const { data } = await supabase
      .from("eye_notes")
      .select("id, times_seen, status, first_seen_day")
      .eq("code", note.code)
      .eq("subject_id", note.subject_id)
      .maybeSingle();
    const existing = data as { id: string; times_seen: number; status: string; first_seen_day: string } | null;

    if (existing) {
      await supabase
        .from("eye_notes")
        .update({
          title: note.title,
          detail: note.detail ?? null,
          severity: note.severity,
          last_seen_day: day,
          times_seen: existing.times_seen + 1,
        })
        .eq("id", existing.id);
      continue;
    }

    await supabase.from("eye_notes").insert({
      code: note.code,
      subject_kind: note.subject_kind,
      subject_id: note.subject_id,
      severity: note.severity,
      title: note.title,
      detail: note.detail ?? null,
      first_seen_day: day,
      last_seen_day: day,
    });
  }
}

export type OpenNote = {
  id: string;
  code: string;
  severity: string;
  title: string;
  detail: string | null;
  times_seen: number;
  first_seen_day: string;
};

/** Notes still open, worst and oldest first. */
export async function openNotes(limit = 15): Promise<OpenNote[]> {
  try {
    const { data } = await db()
      .from("eye_notes")
      .select("id, code, severity, title, detail, times_seen, first_seen_day")
      .eq("status", "open")
      .order("severity")
      .order("last_seen_day", { ascending: false })
      .limit(limit);
    return (data ?? []) as OpenNote[];
  } catch {
    return [];
  }
}

export async function setNoteStatus(noteId: string, status: "ack" | "ignored"): Promise<boolean> {
  try {
    const { error } = await db()
      .from("eye_notes")
      .update({ status, resolved_at: new Date().toISOString() })
      .eq("id", noteId);
    return !error;
  } catch {
    return false;
  }
}

/** Store the day's report so a number can be traced back to the day it was said. */
export async function storeReport(report: EyeReport, script: string, sentTo: number): Promise<void> {
  try {
    await db()
      .from("eye_reports")
      .upsert(
        {
          day: report.day,
          report: report as unknown as Record<string, unknown>,
          script,
          sent_to: sentTo,
          generated_at: new Date().toISOString(),
        },
        { onConflict: "day" },
      );
  } catch {
    /* the briefing still went out; losing the archive must not fail the send */
  }
}
