"use client";

import { forwardRef, useEffect, useState, useSyncExternalStore, type ComponentProps } from "react";
import Link from "next/link";
import { BotMessageSquare, Loader2, X } from "lucide-react";
import { getSecretaryBoard, type SecretaryBoard } from "@/lib/data/my-followups";
import { SecretaryChat } from "./SecretaryChat";
import { SecretaryDayBoard } from "./SecretaryDayBoard";

/**
 * «مُراد — سكرتيري الخاص» lives in the top bar, not floating over the page (the owner, 2026-10-26: «الزر العائم لمراد يعيق
 * الاستخدام في بعض الاماكن، لا تجعله امام زر اطلاقا او ادخال بيانات»): a pill beside the bell opens this panel under the bar.
 * The panel opens on the day board («خطتي») with a chat tab beside it.
 */

// the bell (NotificationBell) announces the unread count; مُراد's pill wears the same number
let notifCount = 0;
const subscribeNotif = (cb: () => void) => {
  const on = (e: Event) => { notifCount = Number((e as CustomEvent<{ count?: number }>).detail?.count ?? 0) || 0; cb(); };
  window.addEventListener("tv-notifications", on);
  return () => window.removeEventListener("tv-notifications", on);
};
const readNotif = () => notifCount;

export const SecretaryTrigger = forwardRef<HTMLButtonElement, { active?: boolean } & ComponentProps<"button">>(function SecretaryTrigger({ active = false, className, ...props }, ref) {
  const unread = useSyncExternalStore(subscribeNotif, readNotif, () => 0);
  return (
    <button
      ref={ref}
      type="button"
      aria-label="مُراد — سكرتيري الخاص"
      title="مُراد — سكرتيري الخاص"
      className={`relative flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-extrabold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#b7d0c7] ${active ? "bg-[#0f4439] text-white" : "bg-[var(--tv-brand)] text-white hover:bg-[#0f4439]"} ${className ?? ""}`}
      {...props}
    >
      <BotMessageSquare className="size-[18px]" />
      <span className="max-sm:hidden">مُراد</span>
      {unread > 0 && <span className="absolute -top-1.5 -end-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#b3261e] px-1 text-[11px] font-extrabold tabular-nums text-white ring-2 ring-white">{unread > 99 ? "99+" : unread}</span>}
    </button>
  );
});

export function SecretaryPanel({ close }: { close: () => void }) {
  const [tab, setTab] = useState<"plan" | "chat">("plan");
  const [board, setBoard] = useState<SecretaryBoard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;
    getSecretaryBoard().then((b) => live && setBoard(b)).catch(() => null).finally(() => live && setLoading(false));
    return () => { live = false; };
  }, []);

  return (
    <div dir="rtl" className="flex max-h-[78vh] flex-col overflow-hidden">
      <div className="flex items-center gap-2 bg-[var(--tv-brand)] px-4 py-2.5 text-white">
        <span className="flex size-8 items-center justify-center rounded-full bg-white/15 text-[13px] font-extrabold">مُراد</span>
        <strong className="flex-1 text-sm">سكرتيرك الخاص</strong>
        <Link href="/secretary" onClick={close} className="text-xs underline">الصفحة الكاملة</Link>
        <button type="button" onClick={close} aria-label="أغلق" className="rounded p-1 hover:bg-white/10"><X className="size-4" /></button>
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
    </div>
  );
}
