"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BotMessageSquare, X } from "lucide-react";
import { SecretaryChat } from "./SecretaryChat";

/**
 * «سكرتيري الخاص» — the floating button beside the employee on every page
 * (the owner, 2026-10-24: «زر عائم بجانبه في النظام»). Opens a chat panel;
 * the full page lives at /secretary. The thread loads when opened, not before.
 */
export function SecretaryFab() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  if (pathname?.startsWith("/secretary")) return null;

  return <>
    {open && <div dir="rtl" className="fixed inset-x-3 bottom-24 z-[70] mx-auto flex max-h-[75vh] w-auto max-w-md flex-col overflow-hidden rounded-2xl border border-[#dfe8e4] bg-[#fbfdfc] shadow-2xl md:inset-x-auto md:end-5 md:bottom-20">
      <div className="flex items-center gap-2 border-b border-[#dfe8e4] bg-[var(--tv-brand)] px-4 py-2.5 text-white">
        <BotMessageSquare className="size-5" />
        <strong className="flex-1 text-sm">سكرتيري الخاص</strong>
        <Link href="/secretary" className="text-xs underline">الصفحة الكاملة</Link>
        <button type="button" onClick={() => setOpen(false)} aria-label="أغلق" className="rounded p-1 hover:bg-white/10"><X className="size-4" /></button>
      </div>
      <SecretaryChat tall />
    </div>}
    <button type="button" onClick={() => setOpen((v) => !v)} aria-label="سكرتيري الخاص"
      className="fixed bottom-20 end-4 z-[69] flex size-13 items-center justify-center rounded-full bg-[var(--tv-brand)] p-3.5 text-white shadow-lg transition-transform hover:scale-105 md:bottom-5 md:end-5">
      <BotMessageSquare className="size-6" />
    </button>
  </>;
}
