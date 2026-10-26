"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { BotMessageSquare } from "lucide-react";
import { SecretaryPanel } from "./SecretaryPanel";
import { candidateSpots, settleSpot, type Box, type Spot } from "./fab-placement";

/**
 * «مُراد — سكرتيري الخاص»: the floating button on every page except sign-in (the owner, 2026-10-26) — and never in front of
 * a button, a link or a field (the owner, 2026-10-26: «لا اريد ازالة مراد كزر عائم بل يتم تنقيته وتنسيقه من الظهور امام الازرار
 * والمدخلات»). It stands on the page's end edge and measures what is under it: when the spot covers a control (a table's
 * action buttons, a form's «التالي», a field) it slides to the nearest free spot up the edge, as the page scrolls and
 * changes; while a field has the focus, or when the whole edge is busy, it docks as a slim tab on the edge instead.
 * The panel opens on the day board («خطتي») with a chat tab beside it.
 */

// the bell (NotificationBell) announces the unread count; مُراد's button wears the same number
let notifCount = 0;
const subscribeNotif = (cb: () => void) => {
  const on = (e: Event) => { notifCount = Number((e as CustomEvent<{ count?: number }>).detail?.count ?? 0) || 0; cb(); };
  window.addEventListener("tv-notifications", on);
  return () => window.removeEventListener("tv-notifications", on);
};
const readNotif = () => notifCount;

const CONTROLS = 'button, a[href], input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"], [contenteditable="true"]';
const TYPING = 'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, select, [contenteditable="true"]';

/** every control on screen now, except مُراد's own */
function busyBoxes(own: HTMLElement | null): Box[] {
  const out: Box[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(CONTROLS)) {
    if (own?.contains(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) continue;
    if (getComputedStyle(el).visibility === "hidden") continue;
    out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  }
  return out;
}

export function SecretaryFab() {
  const [open, setOpen] = useState(false);
  const [spot, setSpot] = useState<Spot | null | undefined>(undefined); // undefined: not measured yet; null: docked
  const unread = useSyncExternalStore(subscribeNotif, readNotif, () => 0);
  const pathname = usePathname();
  const rootRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  const spotRef = useRef<Spot | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  openRef.current = open;

  const measure = useCallback(() => {
    // the panel is open: stand still
    if (openRef.current) return;
    const typing = document.activeElement?.matches?.(TYPING) ?? false;
    let next: Spot | null = null;
    if (!typing) {
      const rtl = (document.querySelector(".tv-app")?.getAttribute("dir") ?? document.documentElement.dir) === "rtl";
      const phone = window.innerWidth < 1024;
      const spots = candidateSpots({ width: window.innerWidth, height: window.innerHeight }, rtl, 70, phone ? 96 : 20);
      next = settleSpot(spotRef.current, spots, busyBoxes(rootRef.current));
    }
    spotRef.current = next;
    setSpot((was) => (was !== undefined && was?.left === next?.left && was?.top === next?.top ? was : next));
  }, []);

  const later = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(measure, 160);
  }, [measure]);

  useEffect(() => {
    measure();
    window.addEventListener("scroll", later, { capture: true, passive: true });
    window.addEventListener("resize", later);
    window.addEventListener("focusin", later);
    window.addEventListener("focusout", later);
    const watch = new MutationObserver(later);
    watch.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.removeEventListener("scroll", later, { capture: true });
      window.removeEventListener("resize", later);
      window.removeEventListener("focusin", later);
      window.removeEventListener("focusout", later);
      watch.disconnect();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [measure, later, pathname]);

  // the panel closed: look again (it stood still while open)
  useEffect(() => {
    if (!open) measure();
  }, [open, measure]);

  if (pathname?.startsWith("/secretary")) return null;

  const docked = spot === null;
  return (
    <div ref={rootRef} dir="rtl">
      {open && (
        <div className="fixed inset-x-3 bottom-24 z-[70] mx-auto w-auto max-w-md overflow-hidden rounded-2xl border border-[#dfe8e4] bg-[#fbfdfc] shadow-2xl md:inset-x-auto md:bottom-20 md:end-5 md:w-[420px]">
          <SecretaryPanel close={() => setOpen(false)} />
        </div>
      )}
      {docked ? (
        // the whole edge is busy (or a field is being typed in): a slim tab on the screen's edge, out of the way
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="مُراد — سكرتيري الخاص"
          title="مُراد — سكرتيري الخاص"
          className="fixed bottom-1/2 end-0 z-[69] flex h-14 w-4 items-center justify-center rounded-s-lg bg-[var(--tv-brand)]/80 text-white shadow transition-[width,opacity] hover:w-8 hover:bg-[var(--tv-brand)]"
        >
          <BotMessageSquare className="size-3.5" />
          {unread > 0 && <span className="absolute -top-1 -end-1 h-3 min-w-3 rounded-full bg-[#b3261e] ring-2 ring-white" />}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="مُراد — سكرتيري الخاص"
          title="مُراد — سكرتيري الخاص"
          style={spot ? { left: spot.left, top: spot.top } : { left: 8, bottom: 20 }}
          className={`fixed z-[69] flex items-center justify-center rounded-full bg-[var(--tv-brand)] text-[13px] font-extrabold text-white shadow-lg ring-2 ring-white/60 transition-[top,left,transform] duration-300 hover:scale-105 ${spot === undefined ? "invisible" : ""}`}
        >
          {/* 52px: the size fab-placement.ts measures free spots for */}
          <span className="flex size-[52px] items-center justify-center">مُراد</span>
          {unread > 0 && <span className="absolute -top-1 -end-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#b3261e] px-1 text-[11px] font-extrabold tabular-nums text-white ring-2 ring-white">{unread > 99 ? "99+" : unread}</span>}
        </button>
      )}
    </div>
  );
}
