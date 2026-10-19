"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

// The logo's own plane (the dark piece, split into logo-plane.svg) leaves its
// spot, loops around the logo and lands back home. Fractions of the logo box.
const HOME = { x: 0.23, y: 0.14 };
const CENTER = { x: 0.5, y: 0.5 };
const R = { x: 0.62, y: 0.75 };
const START = Math.atan2((HOME.y - CENTER.y) / R.y, (HOME.x - CENTER.x) / R.x);

/** Offset of the plane from home at loop progress t (0 and 1 = home). */
function loopOffset(t: number) {
  const a = START - 2 * Math.PI * t; // clockwise
  return {
    x: (Math.cos(a) - Math.cos(START)) * R.x,
    y: (Math.sin(a) - Math.sin(START)) * R.y,
  };
}

/**
 * Page-to-page wait. A navigation reports no real percentage, so the plane
 * creeps toward 90% of the loop while waiting (slower the closer it gets) and
 * finishes the loop the moment the page arrives — a fast page makes a fast
 * flight, a slow one a slow crawl.
 */
function Loader() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [progress, setProgress] = useState<number | null>(null);
  const tick = useRef<number | undefined>(undefined);
  const p = useRef(0);
  const arrived = useRef(true);
  const shownAt = useRef(0);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      clearInterval(tick.current);
      p.current = 0;
      arrived.current = false;
      shownAt.current = Date.now() + 150; // an instant page needs no plane
      tick.current = window.setInterval(() => {
        if (arrived.current && Date.now() < shownAt.current) {
          clearInterval(tick.current); // arrived before the plane was due
          return;
        }
        if (arrived.current) {
          p.current = Math.min(1, p.current + 0.06);
        } else {
          p.current += (0.9 - p.current) * 0.012;
        }
        if (Date.now() >= shownAt.current) setProgress(p.current);
        if (p.current >= 1) {
          clearInterval(tick.current);
          window.setTimeout(() => setProgress(null), 200);
        }
      }, 30);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // The new page arrived: finish the loop quickly.
  useEffect(() => {
    if (arrived.current) return;
    arrived.current = true;
  }, [pathname, search]);

  if (progress === null) return null;
  const o = loopOffset(progress);
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-white/75 backdrop-blur-sm dark:bg-black/60"
      role="status"
      aria-label="جارٍ التحميل"
    >
      <div className="relative w-[200px] max-w-[60vw] dark:brightness-0 dark:invert">
        {/* eslint-disable @next/next/no-img-element */}
        <img src="/traveliun/logo-body.svg" alt="Traveliun" className="h-auto w-full" />
        <img
          src="/traveliun/logo-plane.svg"
          alt=""
          className="absolute inset-0 h-auto w-full"
          style={{
            transform: `translate(${o.x * 100}%, ${o.y * 100}%) rotate(${progress * 360}deg)`,
            transformOrigin: `${HOME.x * 100}% ${HOME.y * 100}%`,
          }}
        />
        {/* eslint-enable @next/next/no-img-element */}
      </div>
    </div>
  );
}

export function NavigationLoader() {
  return (
    <Suspense fallback={null}>
      <Loader />
    </Suspense>
  );
}
