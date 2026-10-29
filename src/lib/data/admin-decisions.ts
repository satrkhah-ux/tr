"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { currentCan } from "@/lib/roles/current";
import { getCurrentEmployeeId } from "./metrics";
import {
  acknowledge,
  archiveEntries,
  createDraft,
  directory,
  getDecision,
  issueDecision,
  issuedDecisions,
  loadSettings,
  markOpened,
  recipientOf,
  resolveAudience,
  saveSettings,
  setDraftText,
  updateDraft,
  wordDraft,
} from "@/lib/decisions/decisions";
import {
  audienceEmpty,
  filterArchive,
  parseAudience,
  tally,
  type ArchiveEntry,
  type ArchiveFilter,
  type Audience,
  type DecisionSettings,
  type Tally,
} from "@/lib/decisions/core";

/**
 * «القرارات الإدارية» in the system: the administration's archive and issue form (/employees/decisions, employees.manage)
 * and each employee's own decisions and letters (/my-decisions, anyone signed in — their own only, read by their id on
 * the server, never by what the page asks for).
 */

const db = () => createSupabaseServiceClient() as unknown as SupabaseClient;
const riyadhDay = (iso: string) =>
  new Date(Date.parse(iso) + 3 * 3600_000).toISOString().slice(0, 10);
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function viewer(): Promise<{
  id: string;
  name: string;
  manager: boolean;
} | null> {
  const id = await getCurrentEmployeeId();
  if (!id) return null;
  const [manager, { data }] = await Promise.all([
    currentCan("employees.manage"),
    db().from("employees").select("arabic_name").eq("id", id).maybeSingle(),
  ]);
  return {
    id,
    name:
      ((data as { arabic_name?: string } | null)?.arabic_name ?? "").trim() ||
      "الإدارة",
    manager,
  };
}

export type DecisionCard = {
  id: string;
  serial: string;
  kind: string;
  title: string;
  text: string;
  audience: string;
  issuedAt: string;
  issuer: string;
  tally: Tally;
  recipients: {
    employeeId: string;
    name: string;
    deliveredAt: string | null;
    openedAt: string | null;
    acknowledgedAt: string | null;
    via: string | null;
  }[];
};

export type DecisionsArchive = {
  entries: ArchiveEntry[];
  decisions: DecisionCard[];
  people: { id: string; name: string }[];
  roles: { id: string; name: string }[];
  teams: { id: number; name: string }[];
  settings: DecisionSettings;
};

/** the administration's archive; null for anyone else */
export async function getDecisionsArchive(
  filter: ArchiveFilter = {},
): Promise<DecisionsArchive | null> {
  const me = await viewer();
  if (!me?.manager) return null;
  const [entries, list, dir, settings] = await Promise.all([
    archiveEntries(filter.employeeId || undefined),
    issuedDecisions(),
    directory(),
    loadSettings(),
  ]);
  const shown = filterArchive(entries, me, filter);
  const refs = new Set(shown.map((e) => e.ref));
  return {
    entries: shown,
    decisions: list
      .filter((d) => !filter.employeeId || refs.has(d.id))
      .filter((d) => !filter.kind || d.kind === filter.kind)
      .filter(
        (d) =>
          (!filter.from || riyadhDay(d.issued_at!) >= filter.from) &&
          (!filter.to || riyadhDay(d.issued_at!) <= filter.to),
      )
      .map((d) => ({
        id: d.id,
        serial: d.serial!,
        kind: d.kind,
        title: d.title,
        text: d.final_text,
        audience: d.audience_label,
        issuedAt: d.issued_at!,
        issuer: d.issued_by_name ?? "",
        tally: tally(
          d.recipients.map((r) => ({
            deliveredAt: r.delivered_at,
            acknowledgedAt: r.acknowledged_at,
          })),
        ),
        recipients: d.recipients.map((r) => ({
          employeeId: r.employee_id,
          name: r.name,
          deliveredAt: r.delivered_at,
          openedAt: r.opened_at,
          acknowledgedAt: r.acknowledged_at,
          via: r.ack_via,
        })),
      }))
      .filter((d) =>
        filter.ack === "no"
          ? d.tally.pending > 0
          : filter.ack === "yes"
            ? d.tally.pending === 0
            : true,
      ),
    people: dir.people.map((p) => ({ id: p.id, name: p.name })),
    roles: dir.roles.map((r) => ({ id: String(r.id), name: r.name })),
    teams: dir.teams.map((t) => ({ id: Number(t.id), name: t.name })),
    settings,
  };
}

export type MyDecision = ArchiveEntry & { text: string | null };

/** the signed-in employee's own decisions and letters; opening one (`openId`) is recorded */
export async function getMyDecisions(
  openId?: string,
): Promise<{ name: string; items: MyDecision[] } | null> {
  const me = await viewer();
  if (!me) return null;
  if (openId) await markOpened(openId, me.id);
  const entries = filterArchive(
    await archiveEntries(me.id),
    { id: me.id, manager: false },
    {},
  );
  const ids = entries.filter((e) => e.source === "decision").map((e) => e.ref);
  const { data } = ids.length
    ? await db().from("admin_decisions").select("id, final_text").in("id", ids)
    : { data: [] };
  const text = new Map(
    ((data ?? []) as { id: string; final_text: string }[]).map((d) => [
      d.id,
      d.final_text,
    ]),
  );
  return {
    name: me.name,
    items: entries.map((e) => ({ ...e, text: text.get(e.ref) ?? null })),
  };
}

/** «✅ استلمت» from the system — the signed-in employee's own copy, once */
export async function acknowledgeMyDecision(id: string): Promise<Result> {
  const me = await viewer();
  if (!me) return { ok: false, error: "سجّل الدخول أولاً." };
  if (!(await recipientOf(id, me.id)))
    return { ok: false, error: "هذا القرار ليس موجهاً إليك." };
  await acknowledge(id, me, "web");
  return { ok: true };
}

/** a draft from the form: created or updated, its text set; how many it reaches now */
export async function saveDecisionDraft(input: {
  id?: string;
  kind: string;
  audience: Audience;
  text: string;
}): Promise<
  Result<{
    id: string;
    count: number;
    label: string;
    title: string;
    body: string;
  }>
> {
  const me = await viewer();
  if (!me?.manager) return { ok: false, error: "هذا للإدارة فقط." };
  const kind = input.kind.trim();
  if (!(await loadSettings()).kinds.includes(kind))
    return { ok: false, error: "اختر نوع القرار." };
  const audience = parseAudience(input.audience);
  if (audienceEmpty(audience))
    return { ok: false, error: "اختر لمن يصدر القرار." };
  if (!input.text.trim()) return { ok: false, error: "اكتب نص القرار." };
  const who = await resolveAudience(audience);
  if (!who)
    return {
      ok: false,
      error: "تعذّر قراءة فرق تيلي تيل الآن — جرّب بعد دقيقة.",
    };
  if (!who.people.length)
    return { ok: false, error: "لا يوجد موظف نشط ضمن من اخترت." };
  const id =
    input.id && (await getDecision(input.id))?.status === "draft"
      ? input.id
      : await createDraft(me.id, kind);
  if (!id) return { ok: false, error: "تعذّر حفظ المسودة." };
  await updateDraft(id, { kind, audience, audience_label: who.label });
  const d = await setDraftText(id, input.text);
  if (!d) return { ok: false, error: "تعذّر حفظ المسودة." };
  return {
    ok: true,
    id,
    count: who.people.length,
    label: who.label,
    title: d.title,
    body: d.final_text,
  };
}

/** «✍️ اكتب صياغة مناسبة» on the form */
export async function wordDecisionDraft(
  id: string,
): Promise<Result<{ title: string; body: string }>> {
  const me = await viewer();
  if (!me?.manager) return { ok: false, error: "هذا للإدارة فقط." };
  const r = await wordDraft(id);
  return r.ok
    ? { ok: true, title: r.draft.title, body: r.draft.final_text }
    : r;
}

/** the issuer edited the title or the wording on the form before issuing */
export async function editDecisionWording(
  id: string,
  title: string,
  body: string,
): Promise<Result> {
  const me = await viewer();
  if (!me?.manager) return { ok: false, error: "هذا للإدارة فقط." };
  if (!title.trim() || !body.trim())
    return { ok: false, error: "العنوان والنص مطلوبان." };
  const d = await updateDraft(id, {
    title: title.trim().slice(0, 200),
    final_text: body.trim().slice(0, 6000),
  });
  return d ? { ok: true } : { ok: false, error: "صدر القرار أو حُذف." };
}

export async function issueDecisionNow(
  id: string,
): Promise<
  Result<{
    serial: string;
    recipients: number;
    delivered: number;
    noTelegram: number;
  }>
> {
  const me = await viewer();
  if (!me?.manager) return { ok: false, error: "هذا للإدارة فقط." };
  const r = await issueDecision(id, { id: me.id, name: me.name });
  return r.ok
    ? {
        ok: true,
        serial: r.serial,
        recipients: r.recipients,
        delivered: r.delivered,
        noTelegram: r.noTelegram,
      }
    : r;
}

export async function saveDecisionSettings(
  s: DecisionSettings,
): Promise<Result> {
  const me = await viewer();
  if (!me?.manager) return { ok: false, error: "هذا للإدارة فقط." };
  await saveSettings(s, me);
  return { ok: true };
}
