"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const REFRESH_MS = 5 * 60_000;
/** the office bulletin is up for 60 s on every screen at once (office-screens/core.ts countryBulletinElapsed); the strip is gone a little before */
const WALL_PASS_MS = 57_000;

type Country = { country: string; src: string };

/** The office wall this screen is part of: its place from the LEFT, how many, and when the pass began on the server's clock. */
export type Wall = { pos: number; of: number; start: number; delta: number };
/** as the screen sends it: `now` is its server clock at that moment (the difference to this TV's clock is taken here) */
export type WallParams = { pos: number; of: number; start: number; now: number };

const toWall = (p: WallParams): Wall => ({ pos: p.pos, of: p.of, start: p.start, delta: p.now - Date.now() });

/**
 * «الأكثر طلباً اليوم»: Traveliun's green with the world map behind, the logo,
 * and today's countries pegged to one straight line that moves left to right —
 * the most asked leading, ranked, never a count (the user, 2026-10-23/24).
 *
 * On the office wall (`wall`, framed by office-screens/page.ts) it is ONE strip
 * across all the screens at once: each screen draws its own part of it from the
 * server's clock, so the prints travel from one screen to the next at one
 * level, once, and the bulletin leaves every screen together. On its own
 * (/top-today) the line goes round and round on the one screen.
 */
export function TopToday({ countries, wall: first = null }: { countries: Country[]; wall?: WallParams | null }) {
  const router = useRouter();
  const [wall, setWall] = useState<Wall | null>(() => (first ? toWall(first) : null));
  useEffect(() => {
    const t = window.setInterval(() => router.refresh(), REFRESH_MS);
    // each time the bulletin comes up the screen says when it began (its clock is the server's)
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { tt?: string; pos?: number; of?: number; start?: number; now?: number } | null;
      if (e.origin !== window.location.origin || d?.tt !== "start") return;
      if ([d.pos, d.of, d.start, d.now].every((v) => typeof v === "number" && Number.isFinite(v))) {
        setWall(toWall({ pos: d.pos as number, of: d.of as number, start: d.start as number, now: d.now as number }));
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("message", onMessage);
    };
  }, [router]);

  const today = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Riyadh" }).format(new Date());
  // on the wall the title stands once, on the right-most screen (where Arabic starts), the logo on the left-most
  const showTitle = !wall || wall.pos === wall.of - 1;
  const showLogo = !wall || wall.pos === 0;

  return (
    <main dir="rtl" className="relative flex h-screen flex-col overflow-hidden bg-[radial-gradient(ellipse_at_top,#1f7667_0%,#135549_45%,#0b3a32_100%)] text-white">
      {/* the world map, faint, behind everything */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[url('/traveliun/world-map.png')] bg-cover bg-center opacity-[0.12] mix-blend-screen" />
      <header className="relative z-10 flex min-h-[clamp(90px,16vh,200px)] items-center justify-between gap-4 px-[clamp(16px,4vw,56px)] pt-[clamp(16px,3vh,36px)]">
        <div className={showTitle ? "" : "invisible"}>
          <p className="text-[clamp(13px,1.2vw,22px)] font-bold text-[#f0ad22]">{today}</p>
          <h1 className="mt-1 text-[clamp(26px,3.4vw,64px)] font-extrabold leading-tight">الأكثر طلباً اليوم</h1>
          <p className="mt-1 text-[clamp(13px,1.2vw,22px)] font-medium text-white/70">الوجهات التي سأل عنها عملاؤنا اليوم، الأكثر أولاً</p>
        </div>
        {showLogo ? (
          // eslint-disable-next-line @next/next/no-img-element -- static brand asset
          <img src="/traveliun/logo-en.svg" alt="Traveliun" className="h-[clamp(36px,5vw,90px)] w-auto brightness-0 invert" />
        ) : null}
      </header>

      {countries.length === 0 ? (
        <div className="relative z-10 flex flex-1 items-center justify-center px-6 text-center text-[clamp(18px,2vw,32px)] font-bold text-white/80">
          {showTitle ? "لم تصل محادثات بوجهة محددة اليوم بعد" : ""}
        </div>
      ) : (
        <DriftLine key={wall ? `${wall.start}` : "loop"} countries={countries} wall={wall} />
      )}

      {wall ? null : (
        <footer className="relative z-10 flex items-center justify-between px-[clamp(16px,4vw,56px)] pb-3 text-[clamp(12px,1vw,18px)] font-semibold text-white/55">
          <span>ترافليون للسفر والسياحة</span>
          <span>traveliun.com.sa</span>
        </footer>
      )}
    </main>
  );
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

/**
 * The prints on one straight line, moved every frame by the clock — no steps,
 * no spring. Print i sits i places to the LEFT of #1 and everything drifts
 * right, so they read #1, #2, #3… as they arrive.
 *  · wall: one pass across all the screens (x on the wall − this screen's part);
 *  · alone: round and round on this screen.
 */
function DriftLine({ countries, wall }: { countries: Country[]; wall: Wall | null }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const cards = useRef<(HTMLDivElement | null)[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    // layout pixels, not the zoomed rect: the app's body zoom (1.12) would put every screen's part of the wall 12% off
    const ro = new ResizeObserver(() => setSize({ w: box.offsetWidth, h: box.offsetHeight }));
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  // sized by the height alone, so every screen of the wall draws the same print
  const cw = Math.round(Math.max(140, Math.min(400, size.h * 0.58, wall ? Infinity : size.w * 0.2)));
  const spacing = Math.round(cw * 1.3);
  const copies = wall || !size.w ? 1 : Math.max(1, Math.ceil((size.w + 2 * spacing) / (countries.length * spacing)));
  const items = Array.from({ length: copies }, () => countries).flat();
  const y0 = Math.max(12, (size.h - cw * 1.32) / 2);

  useEffect(() => {
    const { w, h } = size;
    if (!w || !h) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const n = items.length;
    let raf = 0;
    let place: (now: number) => (i: number) => number;
    if (wall) {
      // the whole wall, then this screen's window on it; #1 enters at the wall's left edge and the last leaves its right
      const wallW = wall.of * w;
      const travel = wallW + cw + (n - 1) * spacing;
      const speed = travel / WALL_PASS_MS; // px per ms
      place = () => {
        const moved = Math.min(travel, Math.max(0, Date.now() + wall.delta - wall.start) * speed);
        return (i) => -cw - i * spacing + moved - wall.pos * w;
      };
    } else {
      const loop = n * spacing;
      const speed = reduce ? 0 : Math.min(110, Math.max(45, w / 20)) / 1000;
      const start = performance.now();
      const off0 = w * 0.78 - cw / 2 + spacing; // #1 begins at the right, where the eye starts
      place = (now) => (i) => mod(off0 + (now - start) * speed - i * spacing, loop) - spacing;
    }
    const frame = (now: number) => {
      const xOf = place(now);
      for (let i = 0; i < n; i++) {
        const el = cards.current[i];
        if (!el) continue;
        const x = xOf(i);
        if (x < -cw * 1.5 || x > w + cw * 0.5) {
          el.style.visibility = "hidden";
          continue;
        }
        el.style.visibility = "visible";
        const a = reduce ? 0 : Math.sin(now / 1500 + i * 1.3) * 0.02; // a light breeze, nothing more
        el.style.transform = `translate3d(${x.toFixed(1)}px,0,0) rotate(${a.toFixed(4)}rad)`;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size, cw, spacing, items.length, wall]);

  return (
    <div ref={boxRef} dir="ltr" className="relative z-10 flex-1 overflow-hidden" aria-label="الأكثر طلباً اليوم" role="list">
      {/* one level, edge to edge, so it continues straight onto the next screen */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 h-[2px] bg-[#f0ad22]" style={{ top: y0 + 6 }} />
      {items.map((c, i) => {
        const rank = (i % countries.length) + 1;
        return (
          <div
            key={i}
            role="listitem"
            aria-hidden={i >= countries.length || undefined}
            ref={(el) => {
              cards.current[i] = el;
            }}
            className="invisible absolute left-0 origin-top will-change-transform"
            style={{ width: cw, top: y0 }}
          >
            <div className="relative mt-[10px] bg-[#fbfaf7] p-[4%] pb-0 shadow-[0_1px_2px_rgba(0,0,0,.12),0_18px_30px_-16px_rgba(0,0,0,.5)]">
              <span className="absolute right-[7%] top-[7%] z-[1] grid min-w-[2.1em] place-items-center rounded-full bg-[#f0ad22] px-[0.5em] py-[0.35em] text-[clamp(12px,1.1vw,22px)] font-extrabold leading-none text-[#103f37] shadow-[0_4px_10px_rgba(0,0,0,.25)]">
                #{rank}
              </span>
              <div className="relative aspect-square overflow-hidden bg-[#d9e3df]">
                {/* eslint-disable-next-line @next/next/no-img-element -- local static photos, sized by the print */}
                <img src={c.src} alt={c.country} draggable={false} className="absolute inset-0 h-full w-full object-cover" />
              </div>
              <div dir="rtl" className="flex h-[3.2em] items-center justify-center truncate text-[clamp(14px,1.4vw,28px)] font-extrabold text-[#103f37]">
                {c.country}
              </div>
            </div>
            {/* the peg */}
            <div className="absolute left-1/2 top-0 h-[26px] w-[10px] -translate-x-1/2 rounded-[2px] bg-[linear-gradient(90deg,#c9a67a,#e3c9a1_45%,#b8915f)] shadow-[0_2px_3px_rgba(0,0,0,.25)]" />
          </div>
        );
      })}
    </div>
  );
}
