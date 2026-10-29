/**
 * «القرارات الإدارية» — the pure half (the owner, 2026-10-29: «الإدارة تكتب قراراً وترسله إلى قسم أو موظف أو أي جهة
 * تحددها، وتحدد طبيعته … يحمل هوية ترافليون، ويُرقَّم، ويُصدر بعدد»):
 *
 *   kinds        أمر جديد / إنذار / تعليمات / تعميم / شكر — the list is the administration's (settings)
 *   audience     what the issuer picked: everyone, or any mix of roles, Teletel teams and employees — expanded to the
 *                exact employees AT ISSUE TIME (expandAudience) and frozen there
 *   reminders    once a day, from the settings' hour, to whoever has not pressed «استلمت» yet, for `remindDays`
 *   the archive  the decisions and the sales letters (staff_letters) side by side: an employee sees their own only
 *
 * No I/O: decisions.ts reads, writes and sends.
 */

export const DEFAULT_KINDS = [
  "أمر جديد",
  "إنذار",
  "تعليمات",
  "تعميم",
  "شكر",
] as const;
/** a kind that never goes on the office screens, whoever it is for */
export const WARNING_KIND = "إنذار";

export type DecisionSettings = {
  kinds: string[];
  remindHour: number;
  remindDays: number;
};
export const SETTINGS_KEY = "admin_decisions_settings";
export const DEFAULT_SETTINGS: DecisionSettings = {
  kinds: [...DEFAULT_KINDS],
  remindHour: 10,
  remindDays: 7,
};

export function parseSettings(
  raw: string | null | undefined,
): DecisionSettings {
  let v: Record<string, unknown> = {};
  try {
    v = (JSON.parse(raw ?? "{}") as Record<string, unknown>) ?? {};
  } catch {
    v = {};
  }
  const int = (x: unknown, min: number, max: number, d: number) =>
    typeof x === "number" && Number.isInteger(x) && x >= min && x <= max
      ? x
      : d;
  const kinds = Array.isArray(v.kinds)
    ? [
        ...new Set(
          v.kinds
            .filter((k): k is string => typeof k === "string")
            .map((k) => k.trim().slice(0, 40))
            .filter(Boolean),
        ),
      ]
    : [];
  return {
    kinds: kinds.length ? kinds.slice(0, 12) : [...DEFAULT_KINDS],
    // 0 = no reminders
    remindHour: int(v.remindHour, 0, 23, DEFAULT_SETTINGS.remindHour),
    remindDays: int(v.remindDays, 0, 60, DEFAULT_SETTINGS.remindDays),
  };
}

export type Audience = {
  all?: boolean;
  employees?: string[];
  roles?: string[];
  teams?: number[];
};

export function parseAudience(v: unknown): Audience {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const ids = (x: unknown) =>
    Array.isArray(x)
      ? [
          ...new Set(
            x.filter(
              (s): s is string =>
                typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s),
            ),
          ),
        ]
      : [];
  const teams = Array.isArray(o.teams)
    ? [...new Set(o.teams.filter((n): n is number => Number.isInteger(n)))]
    : [];
  return o.all === true
    ? { all: true }
    : { employees: ids(o.employees), roles: ids(o.roles), teams };
}

export const audienceEmpty = (a: Audience) =>
  !a.all && !a.employees?.length && !a.roles?.length && !a.teams?.length;

/** add or remove one pick; «الجميع» replaces everything else, and anything else replaces «الجميع» */
export function toggleAudience(
  a: Audience,
  pick:
    { all: true } | { employee: string } | { role: string } | { team: number },
): Audience {
  if ("all" in pick) return a.all ? {} : { all: true };
  const cur = parseAudience(a.all ? {} : a);
  const flip = <T>(list: T[] | undefined, x: T) =>
    list?.includes(x) ? list.filter((y) => y !== x) : [...(list ?? []), x];
  if ("employee" in pick)
    return { ...cur, employees: flip(cur.employees, pick.employee) };
  if ("role" in pick) return { ...cur, roles: flip(cur.roles, pick.role) };
  return { ...cur, teams: flip(cur.teams, pick.team) };
}

export type Person = {
  id: string;
  name: string;
  roleId: string | null;
  agentId: number | null;
};
export type Named = { id: string | number; name: string };

/** the exact employees the audience means now — active ones only (the caller passes the active list), once each, by name */
export function expandAudience(
  a: Audience,
  people: Person[],
  teamAgents: Map<number, number[]>,
): { id: string; name: string }[] {
  const picked = people.filter((p) => {
    if (a.all) return true;
    if (a.employees?.includes(p.id)) return true;
    if (p.roleId && a.roles?.includes(p.roleId)) return true;
    return (
      p.agentId != null &&
      (a.teams ?? []).some((t) => teamAgents.get(t)?.includes(p.agentId!))
    );
  });
  return [
    ...new Map(
      picked.map((p) => [p.id, { id: p.id, name: p.name.trim() }]),
    ).values(),
  ].sort((x, y) => x.name.localeCompare(y.name, "ar"));
}

/** «إلى:» on the document — what was picked, in words */
export function audienceLabel(
  a: Audience,
  names: { roles: Named[]; teams: Named[]; people: Named[] },
): string {
  if (a.all) return "جميع موظفي ترافليون";
  const of = (ids: (string | number)[] | undefined, list: Named[]) =>
    (ids ?? [])
      .map((id) => list.find((x) => x.id === id)?.name)
      .filter((n): n is string => Boolean(n));
  return [
    ...of(a.roles, names.roles).map((n) => `قسم ${n}`),
    ...of(a.teams, names.teams),
    ...of(a.employees, names.people),
  ]
    .join(" · ")
    .slice(0, 400);
}

/**
 * The title: the first line when the text has more than one and it is short (a heading); the kind otherwise. The body
 * is the rest.
 */
export function splitTitle(
  text: string,
  kind: string,
): { title: string; body: string } {
  const clean = text.replace(/\r/g, "").trim();
  const [first, ...rest] = clean.split("\n");
  const restText = rest.join("\n").trim();
  if (restText && first.trim().length <= 90)
    return {
      title: first.trim().replace(/^[#*\s]+|[*\s:]+$/g, "") || kind,
      body: restText,
    };
  return { title: kind, body: clean };
}

/**
 * «✍️ اكتب صياغة مناسبة» must never add a fact: every number in the wording (a date, an amount, a count, a percentage)
 * is one the issuer wrote. Arabic-Indic digits count as their Latin ones.
 */
const latin = (s: string) =>
  s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
export function numbersOf(s: string): string[] {
  return [...new Set(latin(s).match(/\d+(?:[.,]\d+)*/g) ?? [])].map((n) =>
    n.replace(/,/g, ""),
  );
}
export function inventedNumbers(original: string, worded: string): string[] {
  const mine = new Set(numbersOf(original));
  return numbersOf(worded).filter((n) => !mine.has(n));
}

export type RecipientState = {
  employeeId: string;
  chatId: number | null;
  deliveredAt: string | null;
  acknowledgedAt: string | null;
  remindedAt: string | null;
  reminders: number;
};

const riyadhDay = (ms: number) =>
  new Date(ms + 3 * 3600_000).toISOString().slice(0, 10);
const riyadhHour = (ms: number) => new Date(ms + 3 * 3600_000).getUTCHours();

/**
 * Who is reminded now: not acknowledged, issued at least a few hours ago and within `remindDays`, not reminded today
 * (Riyadh), and only from `remindHour` — so a decision issued in the morning is not chased the same morning.
 */
export function dueReminders(
  issuedAt: string,
  rows: RecipientState[],
  nowMs: number,
  s: Pick<DecisionSettings, "remindHour" | "remindDays">,
): RecipientState[] {
  if (!s.remindDays || !s.remindHour) return [];
  const issued = Date.parse(issuedAt);
  if (
    !Number.isFinite(issued) ||
    nowMs - issued < 4 * 3600_000 ||
    nowMs - issued > s.remindDays * 86_400_000
  )
    return [];
  if (riyadhHour(nowMs) < s.remindHour) return [];
  const today = riyadhDay(nowMs);
  return rows.filter(
    (r) =>
      !r.acknowledgedAt &&
      r.reminders < s.remindDays &&
      (!r.remindedAt || riyadhDay(Date.parse(r.remindedAt)) !== today),
  );
}

export type Tally = {
  issued: number;
  delivered: number;
  acknowledged: number;
  pending: number;
};
export function tally(
  rows: { deliveredAt: string | null; acknowledgedAt: string | null }[],
): Tally {
  const acknowledged = rows.filter((r) => r.acknowledgedAt).length;
  return {
    issued: rows.length,
    delivered: rows.filter((r) => r.deliveredAt).length,
    acknowledged,
    pending: rows.length - acknowledged,
  };
}

/** one line of the archive — a decision's copy to one employee, or one of the sales letters */
export type ArchiveEntry = {
  ref: string;
  source: "decision" | "letter";
  serial: string;
  kind: string;
  title: string;
  issuedAt: string;
  issuer: string;
  employeeId: string;
  name: string;
  deliveredAt: string | null;
  openedAt: string | null;
  acknowledgedAt: string | null;
};

/** the sales letters (staff_letters) in the same archive: letter 1, letter 2, a warned letter 2 is «إنذار» */
export function letterEntry(
  r: {
    id: number;
    employee_id: string;
    number: number;
    warned: boolean;
    issued_at: string;
    delivered: boolean;
    signed_at: string | null;
  },
  name: string,
): ArchiveEntry {
  return {
    ref: `letter-${r.id}`,
    source: "letter",
    serial: `خطاب ${r.number}`,
    kind: r.warned ? WARNING_KIND : "خطاب رسمي",
    title:
      r.number === 2
        ? "الخطاب الرسمي رقم 2 — مقارنة الأداء بعد 10 أيام"
        : "الخطاب الرسمي رقم 1 — ملخص المحادثات في تيلي تيل",
    issuedAt: r.issued_at,
    issuer: "إدارة ترافليون",
    employeeId: r.employee_id,
    name,
    // staff_letters keeps «delivered» without its time: the issue time stands for it
    deliveredAt: r.delivered ? r.issued_at : null,
    openedAt: null,
    acknowledgedAt: r.signed_at,
  };
}

export type ArchiveFilter = {
  employeeId?: string;
  kind?: string;
  from?: string;
  to?: string;
  ack?: "yes" | "no" | "";
};

/** the viewer's scope first (an employee: their own only, whatever they asked for), then the filters */
export function filterArchive(
  entries: ArchiveEntry[],
  viewer: { id: string; manager: boolean },
  f: ArchiveFilter,
): ArchiveEntry[] {
  const day = (iso: string) => riyadhDay(Date.parse(iso));
  return entries
    .filter((e) =>
      viewer.manager
        ? !f.employeeId || e.employeeId === f.employeeId
        : e.employeeId === viewer.id,
    )
    .filter((e) => !f.kind || e.kind === f.kind)
    .filter((e) => !f.from || day(e.issuedAt) >= f.from)
    .filter((e) => !f.to || day(e.issuedAt) <= f.to)
    .filter((e) =>
      f.ack === "yes"
        ? Boolean(e.acknowledgedAt)
        : f.ack === "no"
          ? !e.acknowledgedAt
          : true,
    )
    .sort(
      (a, b) =>
        b.issuedAt.localeCompare(a.issuedAt) ||
        a.name.localeCompare(b.name, "ar"),
    );
}

/** a decision's PDF: the administration, or one of its recipients */
export const mayRead = (
  viewer: { id: string; manager: boolean },
  recipientIds: string[],
) => viewer.manager || recipientIds.includes(viewer.id);

/**
 * «قرار الإدارة» on the office screens: the newest decision addressed to everyone, issued within `days`, never a
 * warning (a warning is about someone; it does not go on a television).
 */
export function officeDecision<
  T extends { kind: string; audience: Audience; issuedAt: string },
>(rows: T[], nowMs: number, days = 14): T | null {
  return (
    rows
      .filter(
        (r) =>
          r.audience.all &&
          r.kind !== WARNING_KIND &&
          nowMs - Date.parse(r.issuedAt) <= days * 86_400_000,
      )
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt))[0] ?? null
  );
}
