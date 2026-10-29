"use client";

import { useEffect, useRef, useState, type JSX, type Ref } from "react";
import { createPortal } from "react-dom";
import {
  AWAY_TEXT,
  clientOf,
  elapsedMinutes,
  minutesText,
  type AwayKind,
} from "@/lib/presence/away-overlay";

/**
 * The whole page covered while a status button is on — every status alike (the owner, 2026-10-29: «لدي اتصال وعميل في
 * المكتب يجب أن يكون باقي الأجزاء غير ظاهرة كي يبين له أنه خارج النظام مؤقتاً، بدون تسجيل خروج، فقط إيقاف العداد»):
 * a calm dark-green sky, the status's own motif (a mihrab arch over a mosque, a meeting table, a guest at the desk, a
 * telephone), the minutes running, and one way out — the big button, which ends the status like pressing it again and
 * leaves the colleague on the page they were on. Nothing of the system shows or answers behind it; Esc and a click
 * outside do nothing. «لدي عميل» and «لدي اتصال» show the client the colleague typed. When the limit ends the status on
 * the server, the next read clears it (`onExpired` at the cap).
 */

export function AwayOverlay({
  kind,
  startedAt,
  capAt,
  serverNow,
  detail,
  details,
  busy,
  error,
  onEnd,
  onExpired,
}: {
  kind: AwayKind;
  startedAt: string;
  capAt: string;
  /** the server's clock when the status was read — the minutes run from it, not from this computer's clock */
  serverNow: number;
  /** the meeting's title */
  detail?: string;
  /** the status event's details: the client's name and request («لدي عميل / لدي اتصال») */
  details?: Record<string, unknown>;
  busy: boolean;
  error?: string;
  onEnd: () => void;
  onExpired: () => void;
}) {
  const [offset] = useState(() => serverNow - Date.now());
  const [now, setNow] = useState(serverNow);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now() + offset), 15_000);
    const expire = setTimeout(
      onExpired,
      Math.max(0, Date.parse(capAt) - (Date.now() + offset)) + 2_000,
    );
    return () => {
      clearInterval(tick);
      clearTimeout(expire);
    };
  }, [capAt, offset, onExpired]);

  useEffect(() => {
    button.current?.focus();
    const body = document.body;
    const before = body.style.overflow;
    body.style.overflow = "hidden";
    // Esc must not end it — and must not reach a dialog underneath either
    const stop = (e: KeyboardEvent) => {
      if (e.key === "Escape") e.stopPropagation();
    };
    window.addEventListener("keydown", stop, true);
    return () => {
      body.style.overflow = before;
      window.removeEventListener("keydown", stop, true);
    };
  }, []);

  return createPortal(
    <AwayOverlayView
      kind={kind}
      minutes={elapsedMinutes(startedAt, now)}
      detail={detail}
      client={kind === "client" || kind === "call" ? clientOf(details) : null}
      busy={busy}
      error={error}
      onEnd={onEnd}
      buttonRef={button}
    />,
    document.body,
  );
}

const MOTIF: Record<AwayKind, () => JSX.Element> = {
  prayer: Mihrab,
  meeting: Table,
  client: Guest,
  call: Telephone,
};

/** the full-page cover alone (server-renderable, for the test) */
export function AwayOverlayView({
  kind,
  minutes,
  detail,
  client,
  busy,
  error,
  onEnd,
  buttonRef,
}: {
  kind: AwayKind;
  minutes: number;
  detail?: string;
  client?: { name: string; request: string } | null;
  busy: boolean;
  error?: string;
  onEnd: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const t = AWAY_TEXT[kind];
  const Motif = MOTIF[kind];
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="away-title"
      dir="rtl"
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_50%_28%,#22604f_0%,#123a31_45%,#0a201b_100%)] px-6 text-center text-white"
    >
      <Sky />
      <Motif />
      <h2
        id="away-title"
        className="relative mt-6 text-4xl font-extrabold sm:text-5xl"
      >
        {t.title}
      </h2>
      {client ? (
        <div className="relative mt-4 max-w-xl rounded-2xl bg-white/[0.07] px-6 py-3">
          {client.name && (
            <p className="text-2xl font-bold text-[#e9d8a6]">{client.name}</p>
          )}
          {client.request && (
            <p className="mt-1 text-lg text-white/85">{client.request}</p>
          )}
        </div>
      ) : (
        <p
          className={`relative mt-3 ${kind === "prayer" ? "text-3xl font-bold text-[#e9d8a6] sm:text-4xl" : "max-w-md text-lg text-white/80"}`}
        >
          {t.sub}
        </p>
      )}
      {detail && (
        <p className="relative mt-3 text-xl font-bold text-[#e9d8a6]">
          {detail}
        </p>
      )}
      <p
        className="relative mt-5 flex items-center gap-2 text-xl text-white/85"
        aria-live="polite"
      >
        <span
          className="size-2.5 rounded-full bg-[#e9d8a6] motion-safe:animate-pulse"
          aria-hidden
        />
        منذ {minutesText(minutes)}
      </p>
      <button
        ref={buttonRef}
        type="button"
        disabled={busy}
        onClick={onEnd}
        className="relative mt-10 min-h-16 rounded-2xl bg-white px-10 text-2xl font-extrabold text-[#123a31] shadow-xl transition-colors hover:bg-[#f3efe0] focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-[#e9d8a6] disabled:opacity-60"
      >
        {busy ? "لحظة…" : t.close}
      </button>
      {error && (
        <p
          role="alert"
          className="relative mt-4 rounded-xl bg-white/10 px-4 py-2 text-base"
        >
          {error}
        </p>
      )}
      {kind === "prayer" && <Mosque />}
    </div>
  );
}

/** «لدي عميل»: a guest across the desk from the colleague, a cup between them */
function Guest() {
  return (
    <svg
      className="relative size-28 sm:size-32"
      viewBox="0 0 120 120"
      fill="none"
      stroke="#e9d8a6"
      strokeWidth="4"
      strokeLinecap="round"
      aria-hidden
    >
      <circle cx="32" cy="40" r="10" />
      <path d="M16 78 C16 62 48 62 48 78" />
      <circle cx="88" cy="40" r="10" />
      <path d="M72 78 C72 62 104 62 104 78" />
      <path d="M10 86 H110" />
      <path
        d="M53 74 H67 V84 H53 Z M67 77 C72 77 72 82 67 82"
        strokeWidth="3"
      />
    </svg>
  );
}

/** «لدي اتصال»: the receiver, and the call's waves */
function Telephone() {
  return (
    <svg
      className="relative size-28 sm:size-32"
      viewBox="0 0 120 120"
      fill="none"
      stroke="#e9d8a6"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M38 28 L50 28 L56 46 L47 52 C52 64 58 70 70 75 L76 66 L94 72 L94 84 C94 90 88 94 82 93 C56 89 33 66 29 40 C28 34 32 28 38 28 Z" />
      <path d="M72 30 C82 32 90 40 92 50" />
      <path d="M72 16 C90 18 104 32 106 50" />
    </svg>
  );
}

/** a few still stars — nothing moves */
function Sky() {
  const stars = [
    [12, 18, 1.6],
    [22, 9, 1.1],
    [31, 26, 1.3],
    [68, 12, 1.4],
    [78, 24, 1.1],
    [88, 15, 1.7],
    [45, 7, 1],
    [58, 30, 1.2],
    [8, 40, 1],
    [93, 38, 1.2],
  ];
  return (
    <svg
      className="pointer-events-none absolute inset-0 size-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      {stars.map(([x, y, r]) => (
        <circle
          key={`${x}-${y}`}
          cx={x}
          cy={y}
          r={r / 5}
          fill="#f6efd8"
          opacity={0.55}
        />
      ))}
    </svg>
  );
}

/** «صلاة»: a mihrab's pointed arch, an inner arch and its hanging lamp — no crescent (the owner, 2026-10-29) */
function Mihrab() {
  return (
    <svg
      className="relative size-28 sm:size-32"
      viewBox="0 0 120 120"
      fill="none"
      stroke="#e9d8a6"
      strokeWidth="4"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M22 108 V60 C22 36 44 26 60 10 C76 26 98 36 98 60 V108" />
      <path
        d="M36 108 V64 C36 48 50 40 60 30 C70 40 84 48 84 64 V108"
        strokeWidth="3"
      />
      <path d="M60 30 V52" strokeWidth="2" />
      <path d="M54 52 H66 L63 62 H57 Z" fill="#e9d8a6" stroke="none" />
      <path d="M14 108 H106" />
    </svg>
  );
}

/** «اجتماع»: a round table and its chairs, in the same quiet lines */
function Table() {
  return (
    <svg
      className="relative size-28 sm:size-32"
      viewBox="0 0 120 120"
      fill="none"
      stroke="#e9d8a6"
      strokeWidth="4"
      aria-hidden
    >
      <ellipse cx="60" cy="64" rx="30" ry="14" />
      {[
        [60, 34],
        [60, 94],
        [22, 64],
        [98, 64],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="8" />
      ))}
    </svg>
  );
}

/** the mosque's outline along the bottom: an onion dome on its hall, two small domes, two minarets — one quiet shape */
function Mosque() {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0"
      aria-hidden
    >
      <svg
        className="h-36 w-full sm:h-52"
        viewBox="0 0 400 92"
        preserveAspectRatio="xMidYMax meet"
      >
        <path
          fill="#ffffff"
          fillOpacity="0.08"
          d={[
            // the hall and its dome, the finial above
            "M140 92 V70 H150 C150 50 178 46 192 32 L200 22 L208 32 C222 46 250 50 250 70 H260 V92 Z",
            "M198.5 22 V12 H201.5 V22 Z",
            // the small domes either side
            "M112 92 V78 C112 70 121 67 126 61 C131 67 140 70 140 78 V92 Z",
            "M260 92 V78 C260 70 269 67 274 61 C279 67 288 70 288 78 V92 Z",
            // the minarets, each with its balcony and pointed cap
            "M94 92 V46 L100 32 L106 46 V92 Z M91 56 H109 V60 H91 Z",
            "M294 92 V46 L300 32 L306 46 V92 Z M291 56 H309 V60 H291 Z",
          ].join(" ")}
        />
      </svg>
      {/* the ground runs the whole width, whatever the screen */}
      <div className="h-4 bg-white/[0.08]" />
    </div>
  );
}
