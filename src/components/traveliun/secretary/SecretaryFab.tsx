"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { getSecretaryBoard, type SecretaryBoard } from "@/lib/data/my-followups";
import { SecretaryChat } from "./SecretaryChat";
import { SecretaryDayBoard } from "./SecretaryDayBoard";

/**
 * «مُراد — سكرتيري الخاص»: the floating button on EVERY page of the system
 * except sign-in (the owner, 2026-10-26: «اجعله عائماً على النظام بشكل كامل
 * باستثناء تسجيل الدخول») — focus mode included. Murad's name IS the button;
 * a first-time pill says what it is until the first click (localStorage).
 * The panel opens on the day board («خطتي») with a chat tab beside it.
 */
const SEEN_KEY = "secretary_fab_seen";
const subscribeSeen = (cb: () => void) => { window.addEventListener("storage", cb); return () => window.removeEventListener("storage", cb); };
// a private window where storage throws just never shows the pill
const readSeen = () => { try { return window.localStorage.getItem(SEEN_KEY) === "1"; } catch { return true; } };

export function SecretaryFab() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"plan" | "chat">("plan");
  const [board, setBoard] = useState<SecretaryBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [clicked, setClicked] = useState(false);
  const seen = useSyncExternalStore(subscribeSeen, readSeen, () => true);
  const firstTime = !seen && !clicked;
  const pathname = usePathname();

  if (pathname?.startsWith("/secretary")) return null;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (firstTime) {
      setClicked(true);
      try { window.localStorage.setItem(SEEN_KEY, "1"); } catch { /* ignore */ }
    }
    if (next && !board && !loading) {
      setLoading(true);
      getSecretaryBoard().then((b) => setBoard(b)).catch(() => null).finally(() => setLoading(false));
    }
  }

  return <>
    {open && <div dir="rtl" className="fixed inset-x-3 bottom-24 z-[70] mx-auto flex max-h-[78vh] w-auto max-w-md flex-col overflow-hidden rounded-2xl border border-[#dfe8e4] bg-[#fbfdfc] shadow-2xl md:inset-x-auto md:end-5 md:bottom-24">
      <div className="flex items-center gap-2 bg-[var(--tv-brand)] px-4 py-2.5 text-white">
        <span className="flex size-8 items-center justify-center rounded-full bg-white/15 text-[13px] font-extrabold">مُراد</span>
        <strong className="flex-1 text-sm">سكرتيرك الخاص</strong>
        <Link href="/secretary" className="text-xs underline">الصفحة الكاملة</Link>
        <button type="button" onClick={() => setOpen(false)} aria-label="أغلق" className="rounded p-1 hover:bg-white/10"><X className="size-4" /></button>
      </div>
      <div className="flex border-b border-[#dfe8e4] bg-white text-sm font-bold">
        {([["plan", "خطتي"], ["chat", "اسأل مُراد"]] as const).map(([k, label]) => <button key={k} type="button" onClick={() => setTab(k)}
          className={`flex-1 px-3 py-2 ${tab === k ? "border-b-2 border-[var(--tv-brand)] text-[var(--tv-brand)]" : "text-[#8ba09b]"}`}>{label}</button>)}
      </div>
      {tab === "plan"
        ? <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {loading && <p className="flex items-center gap-2 p-2 text-sm text-[#557d78]"><Loader2 className="size-4 animate-spin" /> يقرأ يومك…</p>}
            {!loading && board && <SecretaryDayBoard board={board} compact />}
            {!loading && !board && <p className="p-2 text-sm text-[#557d78]">تعذّر قراءة خطتك الآن — افتح الصفحة الكاملة.</p>}
          </div>
        : <SecretaryChat tall />}
    </div>}
    <div className="fixed bottom-20 end-4 z-[69] flex items-center gap-2 md:bottom-5 md:end-5">
      {firstTime && !open && <span className="rounded-full bg-[var(--tv-brand)] px-3 py-1.5 text-xs font-bold text-white shadow-lg">مُراد — سكرتيرك الخاص</span>}
      <button type="button" onClick={toggle} aria-label="مُراد — سكرتيري الخاص"
        className="flex size-14 items-center justify-center rounded-full bg-[var(--tv-brand)] text-[13px] font-extrabold text-white shadow-lg ring-2 ring-white/60 transition-transform hover:scale-105">
        مُراد
      </button>
    </div>
  </>;
}
