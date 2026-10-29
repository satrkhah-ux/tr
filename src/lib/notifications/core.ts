/**
 * «مركز الإشعارات» — the pure rules: dedupe keys the sweep stamps, the panel's
 * grouping (≥5 alike fold into one line), and when a sound may play (only for
 * what arrived AFTER the page opened, never muted, only in the office hours).
 */

export type NotificationRow = {
  id: string;
  kind: string;
  title: string;
  body: string;
  href: string | null;
  source: string;
  created_at: string;
  read_at: string | null;
};

export const KIND_LABELS: Record<string, string> = {
  reminder: "تذكير",
  waiting: "عميل ينتظر",
  hot: "عميل ساخن",
  offer_due: "متابعة عرض",
  proposal_ready: "العرض جاهز",
  draft_ready: "مسودة جاهزة",
  ops: "عمليات",
  visa: "تأشيرات",
  mail: "بريد",
  client_msg: "رسالة للعميل",
};
export const kindLabel = (kind: string) => KIND_LABELS[kind] ?? kind;

/** the sweep's dedupe keys: one notification per EVENT, however many minutes it runs */
export const dedupeKeys = {
  reminder: (reminderId: number) => `rem:${reminderId}`,
  /** a waiting episode: the same client waiting since the same moment reminds once */
  waiting: (conversationId: number, waitingSinceUnix: number) => `wait:${conversationId}:${waitingSinceUnix}`,
  /** a hot client reminds once per Riyadh day */
  hot: (conversationId: number, riyadhDay: string) => `hot:${conversationId}:${riyadhDay}`,
  offerDue: (followupId: string, step: number | null) => `due:${followupId}:${step ?? "x"}`,
  proposal: (followupId: string) => `prop:${followupId}`,
  draftReady: (draftId: string) => `draft:${draftId}`,
};

export type NotificationGroup = { kind: string; items: NotificationRow[]; folded: boolean };

/** ≥5 unread of one kind fold into one line (the newest first inside each group) */
export function groupNotifications(rows: NotificationRow[], foldAt = 5): NotificationGroup[] {
  const byKind = new Map<string, NotificationRow[]>();
  for (const r of rows) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r]);
  return [...byKind.entries()]
    .map(([kind, items]) => ({ kind, items, folded: items.filter((i) => !i.read_at).length >= foldAt }))
    .sort((a, b) => (a.items[0].created_at < b.items[0].created_at ? 1 : -1));
}

/** sound: new since the page opened, not muted, inside the office hours — and never for a read row */
export function shouldChime(row: Pick<NotificationRow, "created_at" | "read_at">, openedAtMs: number, muted: boolean, withinHours: boolean): boolean {
  return !muted && withinHours && !row.read_at && Date.parse(row.created_at) > openedAtMs;
}

/** «قبل ٥ دقائق» — the panel's relative time */
export function relativeTime(iso: string, nowMs = Date.now()): string {
  const m = Math.floor((nowMs - Date.parse(iso)) / 60_000);
  if (m < 1) return "الآن";
  if (m < 60) return `قبل ${m} دقيقة`;
  const h = Math.round(m / 60);
  if (h < 24) return `قبل ${h} ساعة`;
  const d = Math.round(h / 24);
  return d === 1 ? "أمس" : `قبل ${d} أيام`;
}
