/**
 * pkg's nightly backup (deploy/pkg-backup.py → app_settings.pkg_backup): healthy
 * when the newest run succeeded within 26 hours and its dump is not suspiciously
 * small (the database dumped to 1.7 MB on 2026-10-19; an empty or cut-off dump is
 * a few KB). Pure, so the check and its test read it the same way.
 */
export const BACKUP_MAX_AGE_MS = 26 * 3600_000;
export const BACKUP_MIN_DUMP_BYTES = 500_000;

export type BackupHealth =
  | { status: "ok"; day: string; mb: number; objects: number; hours: number }
  | { status: "down"; reason: "never" | "failed" | "stale" | "small"; hours: number | null; error?: string };

export function backupHealth(raw: string | null | undefined, now: number): BackupHealth {
  let v: { day?: string; ok?: boolean; at?: string; dump_bytes?: number; objects?: number; error?: string } = {};
  try {
    v = raw ? JSON.parse(raw) : {};
  } catch {
    return { status: "down", reason: "never", hours: null };
  }
  if (!v.at) return { status: "down", reason: "never", hours: null };
  const hours = Math.round((now - Date.parse(v.at)) / 360_000) / 10;
  if (!v.ok) return { status: "down", reason: "failed", hours, error: v.error };
  if (now - Date.parse(v.at) > BACKUP_MAX_AGE_MS) return { status: "down", reason: "stale", hours };
  if ((v.dump_bytes ?? 0) < BACKUP_MIN_DUMP_BYTES) return { status: "down", reason: "small", hours };
  return { status: "ok", day: v.day ?? "", mb: Math.round((v.dump_bytes ?? 0) / 100_000) / 10, objects: v.objects ?? 0, hours };
}
