"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import { createPortal } from "react-dom";
import {
  AWAY_TEXT,
  elapsedMinutes,
  minutesText,
  type AwayKind,
} from "@/lib/presence/away-overlay";

/**
 * The whole page covered while «صلاة» (or «اجتماع») is on: a calm dark-green sky, a crescent over a mosque's outline,
 * the minutes running, and one way out — the big button, which ends the status like pressing it again. Esc and a
 * click outside do nothing (the colleague is away; the counter must not stop by accident). When the limit ends it on
 * the server, the next read clears it (`onExpired` at the cap).
 */

export function AwayOverlay({
  kind,
  startedAt,
  capAt,
  serverNow,
  detail,
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
  detail?: string;
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
      busy={busy}
      error={error}
      onEnd={onEnd}
      buttonRef={button}
    />,
    document.body,
  );
}

/** the drawing alone (server-renderable, for the test) */
export function AwayOverlayView({
  kind,
  minutes,
  detail,
  busy,
  error,
  onEnd,
  buttonRef,
}: {
  kind: AwayKind;
  minutes: number;
  detail?: string;
  busy: boolean;
  error?: string;
  onEnd: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const t = AWAY_TEXT[kind];
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="away-title"
      dir="rtl"
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_50%_28%,#22604f_0%,#123a31_45%,#0a201b_100%)] px-6 text-center text-white"
    >
      <Sky />
      {kind === "prayer" ? <Crescent /> : <Table />}
      <h2
        id="away-title"
        className="relative mt-6 text-4xl font-extrabold sm:text-5xl"
      >
        {t.title}
      </h2>
      <p
        className={`relative mt-3 ${kind === "prayer" ? "text-3xl font-bold text-[#e9d8a6] sm:text-4xl" : "max-w-md text-lg text-white/80"}`}
      >
        {t.sub}
      </p>
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

function Crescent() {
  return (
    <svg
      className="relative size-28 sm:size-32"
      viewBox="0 0 120 120"
      aria-hidden
    >
      <defs>
        <mask id="away-crescent">
          <rect width="120" height="120" fill="#fff" />
          <circle cx="74" cy="48" r="40" fill="#000" />
        </mask>
      </defs>
      <circle
        cx="58"
        cy="60"
        r="44"
        fill="#e9d8a6"
        mask="url(#away-crescent)"
      />
      <path
        d="M92 30 l3 7 7 1 -5 5 1 7 -6 -3 -6 3 1 -7 -5 -5 7 -1z"
        fill="#f6efd8"
      />
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
