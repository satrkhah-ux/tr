"use client";

import * as React from "react";

/*
 * Polaroid Line Carousel — instant photos pegged to a sagging string. Drag the
 * line (or use the arrows) and the prints slide along it, swinging on their
 * pegs and settling back with a little overshoot; at rest they sway in a light
 * breeze. The one in the middle is the one you're looking at.
 *
 * Adapted from the 21st.dev component for this app: every slide brings its own
 * image (no painted landscapes), the text is Tajawal, and the line physics stay
 * left-to-right whatever the page direction (the captions are RTL).
 */

export type Slide = {
  image: string;
  title?: string;
  caption?: string;
  /** a small mark in the print's corner, e.g. the rank */
  badge?: string;
  alt?: string;
};

export type PolaroidLineCarouselProps = {
  slides: Slide[];
  /** Any CSS length. Default 100svh. */
  height?: number | string;
  /** Width of a print in px (it shrinks on narrow screens). */
  cardWidth?: number;
  /** How far the string sags in the middle, px. */
  sag?: number;
  /** How much the prints swing; 0 holds them still. */
  swing?: number;
  /** ms per print; 0 turns autoplay off. It waits while someone is interacting. */
  autoplay?: number;
  /** Colour of the string and pegs. */
  string?: string;
  background?: string;
  ink?: string;
  onChange?: (index: number) => void;
  className?: string;
  style?: React.CSSProperties;
  ariaLabel?: string;
  /** false hides the counter and the arrows (a wall screen nobody touches). */
  controls?: boolean;
};

export function clamp(v: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, v));
}

/** Height of a string sagging by `sag` between (0, y0) and (w, y0), at x. */
export function stringY(x: number, w: number, y0: number, sag: number): number {
  const t = clamp(x / w, 0, 1);
  return y0 + 4 * sag * t * (1 - t);
}

/** One step of a critically damped spring toward target. */
export function springStep(x: number, v: number, target: number, dt: number, k = 70): [number, number] {
  const c = 2 * Math.sqrt(k);
  const nv = v + (k * (target - x) - c * v) * dt;
  return [x + nv * dt, nv];
}

/** One step of a print's swing: it lags behind the line's motion, gravity pulls it back, damped. */
export function swingStep(a: number, w: number, lineVel: number, dt: number, gain: number): [number, number] {
  const nw = w + (-38 * a - 4.2 * w + lineVel * 0.0034 * gain) * dt;
  return [clamp(a + nw * dt, -0.6, 0.6), nw];
}

/** Index of the print nearest the centre for a line offset. */
export function nearestAt(off: number, spacing: number, n: number): number {
  return clamp(Math.round(off / spacing), 0, Math.max(0, n - 1));
}

const PL_CSS = [
  ".pl-root{position:relative;width:100%;overflow:hidden;background:var(--pl-bg);color:var(--pl-ink);user-select:none;-webkit-user-select:none;touch-action:pan-y;outline:none;cursor:grab}",
  ".pl-root[data-drag='1']{cursor:grabbing}",
  ".pl-root:focus-visible{box-shadow:inset 0 0 0 2px var(--pl-ink)}",
  ".pl-string{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;overflow:visible}",
  ".pl-card{position:absolute;left:0;top:0;width:var(--pl-cw);transform-origin:50% 0;will-change:transform;cursor:inherit}",
  ".pl-print{position:relative;margin-top:10px;background:#fbfaf7;padding:10px 10px 0;box-shadow:0 1px 2px rgba(0,0,0,.12),0 18px 30px -16px rgba(0,0,0,.45);transition:transform .5s cubic-bezier(.2,.7,.2,1),filter .5s ease}",
  ".pl-card[data-on='0'] .pl-print{transform:scale(.9);filter:saturate(.75) brightness(.95)}",
  ".pl-shot{position:relative;aspect-ratio:1;overflow:hidden;background:#d9e3df}",
  ".pl-shot img{position:absolute;inset:0;width:100%;height:100%;max-width:none;object-fit:cover;display:block;pointer-events:none}",
  ".pl-note{height:50px;display:flex;align-items:center;justify-content:center;padding:0 6px;font:800 19px/1.1 Tajawal,'Segoe UI',sans-serif;color:#103f37;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".pl-badge{position:absolute;top:16px;right:16px;z-index:1;min-width:34px;height:34px;padding:0 8px;border-radius:999px;display:grid;place-items:center;background:#f0ad22;color:#103f37;font:800 15px/1 Tajawal,sans-serif;box-shadow:0 4px 10px rgba(0,0,0,.25)}",
  ".pl-peg{position:absolute;left:50%;top:0;width:10px;height:26px;margin-left:-5px;border-radius:2px;background:linear-gradient(90deg,#c9a67a,#e3c9a1 45%,#b8915f);box-shadow:0 2px 3px rgba(0,0,0,.25)}",
  ".pl-peg::after{content:'';position:absolute;left:4px;top:8px;width:2px;height:7px;background:rgba(80,60,30,.45);border-radius:1px}",
  ".pl-bar{position:absolute;left:clamp(16px,4vw,56px);right:clamp(16px,4vw,56px);bottom:clamp(20px,4vh,40px);display:flex;align-items:center;gap:clamp(12px,2vw,24px);cursor:default}",
  ".pl-cap{flex:1;min-width:0;overflow:hidden;padding-bottom:.15em;direction:rtl;text-align:right}",
  ".pl-cap>*{display:block;animation:pl-in .55s cubic-bezier(.2,.8,.2,1) both}",
  ".pl-title{font:800 clamp(22px,2.6vw,34px)/1.2 Tajawal,'Segoe UI',sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
  ".pl-sub{margin-top:4px;font:500 clamp(14px,1.3vw,18px)/1.4 Tajawal,'Segoe UI',sans-serif;color:var(--pl-muted)}",
  ".pl-count{font:700 13px/1 Tajawal,ui-monospace,monospace;letter-spacing:.12em;color:var(--pl-muted)}",
  ".pl-count b{color:var(--pl-ink);font-weight:800}",
  ".pl-btn{appearance:none;width:42px;height:42px;border-radius:50%;border:1px solid var(--pl-line);background:transparent;color:inherit;display:grid;place-items:center;cursor:pointer;transition:background .2s ease,color .2s ease}",
  ".pl-btn:hover{background:var(--pl-ink);color:var(--pl-bg)}",
  ".pl-btn:focus-visible{outline:2px solid var(--pl-ink);outline-offset:2px}",
  ".pl-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}",
  "@keyframes pl-in{from{transform:translateY(100%);opacity:0}to{transform:none;opacity:1}}",
  "@media (prefers-reduced-motion:reduce){.pl-cap>*{animation:none}.pl-print{transition:none}}",
].join("\n");

const pad2 = (n: number) => (n < 10 ? "0" + n : String(n));

export default function PolaroidLineCarousel({
  slides,
  height = "100svh",
  cardWidth = 300,
  sag = 46,
  swing = 1,
  autoplay = 4500,
  string = "#8a7f72",
  background = "#efece6",
  ink = "#161513",
  onChange,
  className,
  style,
  ariaLabel = "Image carousel",
  controls = true,
}: PolaroidLineCarouselProps) {
  const n = slides.length;
  const [active, setActive] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);
  const [size, setSize] = React.useState({ w: 1200, h: 800, cw: cardWidth });
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const pathRef = React.useRef<SVGPathElement | null>(null);
  const cards = React.useRef<(HTMLDivElement | null)[]>([]);
  const sim = React.useRef({ off: 0, vel: 0, target: 0, a: [] as number[], w: [] as number[] });
  const drag = React.useRef<null | { x: number; off: number; lx: number; lt: number; v: number; moved: boolean }>(null);
  const lastTouch = React.useRef(0);
  const activeRef = React.useRef(0);
  const opts = React.useRef({ sag, swing });
  React.useEffect(() => {
    opts.current = { sag, swing };
  }, [sag, swing]);

  const spacing = size.cw * 1.08;
  const goTo = React.useCallback(
    (i: number) => {
      sim.current.target = clamp(i, 0, n - 1) * spacing;
    },
    [n, spacing],
  );

  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ro = new ResizeObserver(() => {
      const r = root.getBoundingClientRect();
      const cw = Math.round(Math.max(150, Math.min(cardWidth, r.width * 0.42, r.height * 0.42)));
      setSize({ w: r.width, h: r.height, cw });
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, [cardWidth]);

  // keep the target on the active print when the spacing changes
  React.useEffect(() => {
    sim.current.target = activeRef.current * spacing;
    sim.current.off = activeRef.current * spacing;
  }, [spacing]);

  React.useEffect(() => {
    onChange?.(active);
  }, [active, onChange]);

  // the simulation, written straight to the DOM each frame
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let visible = true;
    let raf = 0;
    let prev = performance.now();
    const S = sim.current;
    const frame = (now: number) => {
      raf = 0;
      if (!visible) return;
      const dt = Math.min(0.033, (now - prev) / 1000);
      prev = now;
      const { w, h, cw } = size;
      const y0 = Math.max(40, h * 0.2);
      const d = drag.current;
      let lineVel: number;
      if (d && d.moved) {
        lineVel = d.v * 1000;
      } else {
        const before = S.off;
        [S.off, S.vel] = springStep(S.off, S.vel, S.target, dt);
        lineVel = -(S.off - before) / Math.max(dt, 1e-3);
      }
      const o = opts.current;
      const g = reduce ? 0 : o.swing;
      const near = nearestAt(S.off, spacing, n);
      for (let i = 0; i < n; i++) {
        const el = cards.current[i];
        if (!el) continue;
        const x = w / 2 + i * spacing - S.off;
        if (x < -cw * 1.5 || x > w + cw * 1.5) {
          el.style.visibility = "hidden";
          continue;
        }
        el.style.visibility = "visible";
        let a = S.a[i] || 0;
        let av = S.w[i] || 0;
        [a, av] = swingStep(a, av, lineVel, dt, g);
        if (g) a += Math.sin(now / 1300 + i * 1.7) * 0.0009 * g;
        S.a[i] = a;
        S.w[i] = av;
        const y = stringY(x, w, y0, o.sag) - 6;
        el.style.transform = `translate(${(x - cw / 2).toFixed(1)}px,${y.toFixed(1)}px) rotate(${a.toFixed(4)}rad)`;
        el.style.zIndex = String(i === near ? n + 1 : n - Math.abs(i - near));
      }
      pathRef.current?.setAttribute("d", `M0 ${y0} Q${w / 2} ${y0 + 2 * o.sag} ${w} ${y0}`);
      if (near !== activeRef.current) {
        activeRef.current = near;
        setActive(near);
      }
      raf = requestAnimationFrame(frame);
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !raf) {
        prev = performance.now();
        raf = requestAnimationFrame(frame);
      }
    });
    io.observe(root);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [size, spacing, n]);

  // autoplay, back to the first print after the last
  React.useEffect(() => {
    if (!autoplay || n < 2) return;
    const t = window.setInterval(() => {
      if (document.hidden || drag.current || performance.now() - lastTouch.current < autoplay) return;
      goTo(activeRef.current >= n - 1 ? 0 : activeRef.current + 1);
    }, autoplay);
    return () => window.clearInterval(t);
  }, [autoplay, n, goTo]);

  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest(".pl-bar")) return;
    lastTouch.current = performance.now();
    drag.current = { x: e.clientX, off: sim.current.off, lx: e.clientX, lt: e.timeStamp, v: 0, moved: false };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) > 5) {
      d.moved = true;
      setDragging(true);
      rootRef.current?.setPointerCapture(e.pointerId);
    }
    if (!d.moved) return;
    const dt = Math.max(1, e.timeStamp - d.lt);
    d.v = 0.7 * ((e.clientX - d.lx) / dt) + 0.3 * d.v;
    d.lx = e.clientX;
    d.lt = e.timeStamp;
    const max = (n - 1) * spacing;
    let off = d.off - dx;
    if (off < 0) off *= 0.35;
    if (off > max) off = max + (off - max) * 0.35;
    sim.current.off = off;
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    lastTouch.current = performance.now();
    if (!d) return;
    if (d.moved) {
      setDragging(false);
      sim.current.vel = -d.v * 1000;
      goTo(nearestAt(sim.current.off - d.v * 180, spacing, n));
      return;
    }
    const card = (e.target as HTMLElement).closest("[data-i]");
    if (card) goTo(Number(card.getAttribute("data-i")));
  };
  const step = (dir: number) => {
    lastTouch.current = performance.now();
    goTo(clamp(activeRef.current + dir, 0, n - 1));
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") step(1);
    else if (e.key === "ArrowLeft") step(-1);
    else return;
    e.preventDefault();
  };

  const s = slides[active] ?? slides[0];

  return (
    <div
      ref={rootRef}
      dir="ltr"
      className={["pl-root", className].filter(Boolean).join(" ")}
      style={{
        height,
        ["--pl-bg" as string]: background,
        ["--pl-ink" as string]: ink,
        ["--pl-muted" as string]: "color-mix(in srgb, var(--pl-ink) 62%, transparent)",
        ["--pl-line" as string]: "color-mix(in srgb, var(--pl-ink) 22%, transparent)",
        ["--pl-cw" as string]: size.cw + "px",
        ...style,
      }}
      data-drag={dragging ? "1" : "0"}
      role="region"
      aria-roledescription="carousel"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={onKey}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <style>{PL_CSS}</style>
      <svg className="pl-string" aria-hidden="true">
        <path ref={pathRef} fill="none" stroke={string} strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      {slides.map((sl, i) => (
        <div
          key={i}
          className="pl-card"
          data-i={i}
          data-on={i === active ? "1" : "0"}
          ref={(el) => {
            cards.current[i] = el;
          }}
          aria-hidden={i === active ? undefined : true}
        >
          <div className="pl-print">
            {sl.badge ? <span className="pl-badge">{sl.badge}</span> : null}
            <div className="pl-shot">
              {/* eslint-disable-next-line @next/next/no-img-element -- local static photos, sized by the print */}
              <img src={sl.image} alt={sl.alt || sl.title || ""} draggable={false} />
            </div>
            <div className="pl-note" dir="rtl">{sl.title || ""}</div>
          </div>
          <div className="pl-peg" />
        </div>
      ))}
      {s ? (
        <div className="pl-bar">
          {controls ? (
            <>
          <span className="pl-count" aria-hidden="true">
            <b>{pad2(active + 1)}</b> / {pad2(n)}
          </span>
          <button type="button" className="pl-btn" aria-label="Previous" onClick={() => step(-1)}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </button>
          <button type="button" className="pl-btn" aria-label="Next" onClick={() => step(1)}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="m6 3 5 5-5 5" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </button>
            </>
          ) : null}
          <div className="pl-cap" key={active} aria-hidden="true">
            {s.title ? <span className="pl-title">{s.title}</span> : null}
            {s.caption ? <span className="pl-sub">{s.caption}</span> : null}
          </div>
        </div>
      ) : null}
      <div className="pl-sr" aria-live="polite">
        {`${active + 1} / ${n}${s?.title ? ": " + s.title : ""}`}
      </div>
    </div>
  );
}
