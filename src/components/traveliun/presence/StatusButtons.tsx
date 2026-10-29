"use client";

import { useCallback, useEffect, useMemo, useState, useTransition, type ComponentType } from "react";
import { Phone, UserRound, Users } from "lucide-react";
import { endMyStatus, getMyPresence, getStatusColleagues, saveMyClient, startMyStatus, type MyPresence } from "@/lib/data/presence-status";
import { STATUS_BUTTON, type StatusKind } from "@/lib/presence/excuse";
import { awayKindOf, once, type ClientForm } from "@/lib/presence/away-overlay";
import { AwayOverlay } from "./AwayOverlay";

/**
 * The status buttons beside مُراد (the owner, 2026-10-29), in his own side strip — so they stand over no button or field.
 * Each colleague sees the ones their permissions give (and «اجتماع» while invited to an open meeting). On: no request is
 * routed to them and no delay is counted, up to the button's limit — from the press, «لدي عميل» / «لدي اتصال» too (their
 * client is typed inside the cover). Pressed again: off.
 */

/** «صلاة»: a mihrab's arch, in lucide's lines — no crescent anywhere (the owner, 2026-10-29) */
function MihrabIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M5 21v-9c0-4 4-6 7-9 3 3 7 5 7 9v9" />
      <path d="M9 21v-6c0-2 1.5-3.5 3-5 1.5 1.5 3 3 3 5v6" />
      <path d="M3 21h18" />
    </svg>
  );
}

const ICON: Record<StatusKind, ComponentType<{ className?: string }>> = { client: UserRound, call: Phone, prayer: MihrabIcon, meeting: Users };
const minutesSince = (iso: string, now: number) => Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));

export function StatusButtons() {
  const [p, setP] = useState<MyPresence | null>(null);
  const [colleagues, setColleagues] = useState<{ id: string; name: string }[] | null>(null);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [now, setNow] = useState(0);

  const load = useCallback(() => {
    getMyPresence()
      .then((v) => {
        setP(v);
        if (v) setNow(v.at);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  // every status covers the page (away-overlay.ts); its button ends this status once — a new status, a new once
  const awayStarted = awayKindOf(p?.active) ? p!.active!.startedAt : null;
  const endAway = useMemo(
    () =>
      once(async (form?: ClientForm) => {
        const r = await endMyStatus(form);
        if (!r.ok) setError(r.error);
        load();
        return r;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one guard per status started
    [awayStarted, load],
  );

  // whom a client may ask for — read once, the first time a client / a call is on
  const withClient = p?.active?.kind === "client" || p?.active?.kind === "call";
  useEffect(() => {
    if (withClient && colleagues === null) getStatusColleagues().then(setColleagues, () => setColleagues([]));
  }, [withClient, colleagues]);

  if (!p || (!p.allowed.length && !p.active)) return null;
  const away = awayKindOf(p.active);

  const press = (kind: StatusKind) => {
    setError("");
    if (p.active?.kind === kind) return start(async () => void (await endMyStatus().then(load)));
    start(async () => {
      const r = await startMyStatus(kind);
      if (!r.ok) setError(r.error);
      load();
    });
  };

  return (
    <>
      {away && p.active && (
        <AwayOverlay
          key={p.active.startedAt}
          kind={away}
          startedAt={p.active.startedAt}
          capAt={p.active.capAt}
          serverNow={now}
          detail={away === "meeting" ? p.meeting?.title : undefined}
          details={p.active.details}
          colleagues={colleagues ?? []}
          busy={pending}
          error={error}
          onSave={saveMyClient}
          onEnd={(form) => start(async () => void (await endAway(form)))}
          onExpired={load}
        />
      )}
      <div className="flex flex-col items-center gap-1.5" role="group" aria-label="حالتي الآن">
        {p.allowed.map((k) => {
          const Icon = ICON[k];
          const on = p.active?.kind === k;
          const title = on ? `${STATUS_BUTTON[k]} — منذ ${minutesSince(p.active!.startedAt, now)} د · اضغط لإنهائها` : STATUS_BUTTON[k];
          return (
            <button
              key={k}
              type="button"
              disabled={pending}
              onClick={() => press(k)}
              title={title}
              aria-label={title}
              aria-pressed={on}
              className={`flex size-9 items-center justify-center rounded-s-lg shadow-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 ${
                on ? "bg-amber-500 text-white" : "bg-white text-[var(--tv-brand)] hover:bg-[#e3ece8]"
              }`}
            >
              <Icon className="size-4" />
            </button>
          );
        })}
        {error && (
          <span className="sr-only" role="alert">
            {error}
          </span>
        )}
      </div>
    </>
  );
}
