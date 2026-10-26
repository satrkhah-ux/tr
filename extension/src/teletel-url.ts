/**
 * The Teletel conversation a tab shows: «…/app/accounts/<account>/…/conversations/<id>» —
 * from the inbox, a label, a team or a filter alike. Null for any other page.
 */
export function conversationOf(url: string | undefined, teletelOrigin: string): { account: string; id: number } | null {
  let u: URL;
  try {
    u = new URL(url ?? "");
  } catch {
    return null;
  }
  if (u.origin !== teletelOrigin) return null;
  const m = /^\/app\/accounts\/(\d+)\/(?:[^?#]*\/)?conversations\/(\d+)(?:\/|$)/.exec(u.pathname);
  if (!m) return null;
  const id = Number(m[2]);
  return Number.isSafeInteger(id) && id > 0 ? { account: m[1], id } : null;
}
