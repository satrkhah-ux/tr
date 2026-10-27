"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Bell, BellOff, Check, Loader2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getMyNotifications, markNotificationsRead, type MyNotifications } from "@/lib/notifications/actions";
import { groupNotifications, kindLabel, relativeTime, shouldChime, type NotificationRow } from "@/lib/notifications/core";

/**
 * «مركز الإشعارات» — the bell in the top bar (the owner, 2026-10-26): the
 * unread count, a panel of the last 30 days (filter by kind, ≥5 alike folded,
 * mark all read), a short chime for what arrives WHILE the page is open (never
 * for old rows, never muted, never outside the office hours — the browser
 * allows sound only after the first interaction, so the first click anywhere
 * unlocks it). The same count reaches مُراد's floating button through a window
 * event (tv-notifications).
 */

export const NOTIF_EVENT = "tv-notifications";
const MUTE_KEY = "notif_muted";

const subscribeMute = (cb: () => void) => { window.addEventListener("storage", cb); return () => window.removeEventListener("storage", cb); };
const readMute = () => { try { return window.localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; } };

/** two short sine notes through WebAudio — embedded, no file, no dependency */
function chime(ctx: AudioContext) {
  const note = (freq: number, at: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + 0.28);
    osc.connect(gain).connect(ctx.destination);
    osc.start(ctx.currentTime + at);
    osc.stop(ctx.currentTime + at + 0.3);
  };
  note(880, 0);
  note(1175, 0.16);
}

export function NotificationBell() {
  const [data, setData] = useState<MyNotifications | null>(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const [unfolded, setUnfolded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const muted = useSyncExternalStore(subscribeMute, readMute, () => false);
  const [mutedNow, setMutedNow] = useState<boolean | null>(null);
  const router = useRouter();
  const openedAt = useRef(Date.now());
  const chimed = useRef(new Set<string>());
  const audio = useRef<AudioContext | null>(null);
  const isMuted = mutedNow ?? muted;

  // the browser's rule: sound only after a user gesture — the first click anywhere arms it
  useEffect(() => {
    const arm = () => {
      try { audio.current ??= new AudioContext(); void audio.current.resume(); } catch { /* no sound then */ }
      window.removeEventListener("pointerdown", arm);
    };
    window.addEventListener("pointerdown", arm);
    return () => window.removeEventListener("pointerdown", arm);
  }, []);

  const load = useCallback(async () => {
    try {
      const d = await getMyNotifications();
      if (!d) return;
      setData(d);
      window.dispatchEvent(new CustomEvent(NOTIF_EVENT, { detail: { count: d.unread } }));
      if (audio.current?.state === "running") {
        for (const r of d.rows) {
          if (chimed.current.has(r.id) || !shouldChime(r, openedAt.current, readMute(), d.withinHours)) continue;
          chimed.current.add(r.id);
          chime(audio.current);
          break; // one chime per batch, not a bell concert
        }
      }
    } catch { /* next poll tries again */ }
  }, []);

  useEffect(() => {
    void load();
    const tick = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30_000);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(tick); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  if (!data?.enabled) return null;

  async function openRow(r: NotificationRow) {
    setOpen(false);
    if (!r.read_at) {
      setData((d) => d && { ...d, unread: Math.max(d.unread - 1, 0), rows: d.rows.map((x) => (x.id === r.id ? { ...x, read_at: new Date().toISOString() } : x)) });
      void markNotificationsRead([r.id]).catch(() => null);
    }
    if (r.href) router.push(r.href);
  }

  async function markAll() {
    setBusy(true);
    try {
      await markNotificationsRead("all");
      setData((d) => d && { ...d, unread: 0, rows: d.rows.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })) });
      window.dispatchEvent(new CustomEvent(NOTIF_EVENT, { detail: { count: 0 } }));
    } catch { /* stays as was */ } finally { setBusy(false); }
  }

  function toggleMute() {
    const next = !isMuted;
    setMutedNow(next);
    try { window.localStorage.setItem(MUTE_KEY, next ? "1" : "0"); } catch { /* per-tab only then */ }
  }

  const rows = filter ? data.rows.filter((r) => r.kind === filter) : data.rows;
  const kinds = [...new Set(data.rows.map((r) => r.kind))];
  const groups = groupNotifications(rows);

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger render={
      <button type="button" aria-label="الإشعارات" title="الإشعارات" className="relative flex size-10 items-center justify-center rounded-[10px] border border-[#dbe6e1] bg-[#f5f8f7] text-[var(--tv-brand)] hover:bg-[#eef4f1]">
        <Bell className="size-[18px]" />
        {data.unread > 0 && <span className="absolute -top-1.5 -end-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#b3261e] px-1 text-[11px] font-extrabold text-white tabular-nums">{data.unread > 99 ? "99+" : data.unread}</span>}
      </button>
    } />
    <PopoverContent className="w-[min(380px,calc(100vw/var(--tv-zoom)_-_24px))]">
      <div dir="rtl" className="max-h-[70vh] overflow-y-auto">
        <div className="mb-2 flex items-center gap-2">
          <strong className="flex-1 text-sm">الإشعارات</strong>
          <button type="button" onClick={toggleMute} aria-label={isMuted ? "شغّل الصوت" : "اكتم الصوت"} title={isMuted ? "شغّل الصوت" : "اكتم الصوت"} className="rounded p-1 text-[#557d78] hover:bg-[#f4f8f6]">
            {isMuted ? <BellOff className="size-4" /> : <Bell className="size-4" />}
          </button>
          <button type="button" disabled={busy || !data.unread} onClick={() => void markAll()} className="inline-flex items-center gap-1 rounded border border-[#dbe6e1] px-2 py-1 text-xs font-bold text-[#185045] disabled:opacity-50">
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} تعليم الكل مقروءاً
          </button>
        </div>
        {!data.withinHours && <p className="mb-2 rounded bg-[#f4f8f6] p-1.5 text-[11px] text-[#557d78]">خارج ساعات الدوام — الإشعارات تصل بلا صوت.</p>}
        {kinds.length > 1 && <div className="mb-2 flex flex-wrap gap-1">
          <button type="button" onClick={() => setFilter(null)} className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${filter === null ? "border-[var(--tv-brand)] bg-[var(--tv-brand)] text-white" : "border-[#dbe6e1] text-[#557d78]"}`}>الكل</button>
          {kinds.map((k) => <button key={k} type="button" onClick={() => setFilter(filter === k ? null : k)} className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${filter === k ? "border-[var(--tv-brand)] bg-[var(--tv-brand)] text-white" : "border-[#dbe6e1] text-[#557d78]"}`}>{kindLabel(k)}</button>)}
        </div>}
        {!rows.length && <p className="p-3 text-sm text-[#557d78]">لا إشعارات في آخر ٣٠ يوماً.</p>}
        <div className="space-y-1.5">
          {groups.map((g) => {
            if (g.folded && !unfolded.has(g.kind)) {
              return <button key={g.kind} type="button" onClick={() => setUnfolded((s) => new Set([...s, g.kind]))}
                className="flex w-full items-center gap-2 rounded-lg border border-[#e3e9e6] bg-[#f8fafa] p-2.5 text-start text-sm font-bold text-[#185045]">
                {kindLabel(g.kind)}: {g.items.length} إشعاراً <span className="flex-1" /><span className="text-xs text-[#557d78]">عرض الكل</span>
              </button>;
            }
            return g.items.map((r) => <button key={r.id} type="button" onClick={() => void openRow(r)}
              className={`block w-full rounded-lg border p-2.5 text-start ${r.read_at ? "border-[#eef3f1] bg-white opacity-70" : "border-[#cfe0db] bg-[#f4f8f6]"}`}>
              <p className="text-sm font-bold leading-6 text-[#185045]">{r.title}</p>
              {r.body && <p className="text-xs leading-5 text-[#557d78] line-clamp-2">{r.body}</p>}
              <p className="mt-0.5 text-[10px] text-[#8ba09b]">{kindLabel(r.kind)} · {relativeTime(r.created_at)}</p>
            </button>);
          })}
        </div>
      </div>
    </PopoverContent>
  </Popover>;
}
