"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { ArrowLeftRight, BarChart3, BookOpen, CalendarClock, FileSpreadsheet, FileText, Landmark, LayoutDashboard, Lock, Moon, Receipt, Sun, Truck } from "lucide-react";
import { lockFinanceNow, touchFinanceUnlock } from "@/lib/data/finance";
import { useTraveliunUI } from "../TraveliunUIProvider";

/**
 * «الحسابات»' own frame — no Traveliun menu: an indigo side rail (a strip on the phone), a top bar with
 * the page's name, and the way back to Traveliun always in reach (the owner, 2026-10-30/31). Its colours
 * are accounts.css (.acc-app).
 */

const NAV: [string, string, typeof Landmark][] = [
  ["/accounts", "الرئيسية", LayoutDashboard],
  ["/accounts/dues", "المستحقات", CalendarClock],
  ["/accounts/invoices", "الفواتير", FileText],
  ["/accounts/reports", "التقارير", BarChart3],
  ["/accounts/expenses", "المصروفات", Receipt],
  ["/accounts/suppliers", "الموردون", Truck],
  ["/accounts/quotes", "عروض الأسعار", FileSpreadsheet],
  ["/accounts/journal", "القيود", BookOpen],
];

/** renew the unlock while someone works; when it has run out, the page shows the door again */
function KeepOpen() {
  const router = useRouter();
  const active = useRef(0);
  useEffect(() => {
    const mark = () => { active.current = Date.now(); };
    mark();
    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    const timer = window.setInterval(() => {
      // only when there was use in the last two minutes — idle time is what lets it lock
      if (Date.now() - active.current > 120_000) return;
      void touchFinanceUnlock().then((open) => { if (!open) router.refresh(); });
    }, 120_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, mark));
      window.clearInterval(timer);
    };
  }, [router]);
  return null;
}

const iconButton = "flex size-10 items-center justify-center rounded-full bg-tv-surface-raised text-tv-text-muted shadow-[var(--acc-shadow)] hover:text-tv-text-brand";

export function AccountsShell({ open, children }: { open: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTraveliunUI();
  // the saved choice only: reading the system's preference here would differ between server and browser
  const dark = theme === "Dark";
  const current = (href: string) => (href === "/accounts" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));
  const title = open ? (NAV.find(([href]) => current(href))?.[1] ?? "الحسابات") : "الحسابات";

  return (
    <div dir="rtl" className="acc-app min-h-dvh lg:flex lg:gap-5 lg:p-4">
      {open && <KeepOpen />}
      <aside className="z-30 bg-gradient-to-b from-[var(--acc-rail-from)] to-[var(--acc-rail-to)] text-white print:hidden lg:sticky lg:top-4 lg:flex lg:h-[calc(100dvh-2rem)] lg:w-60 lg:shrink-0 lg:flex-col lg:rounded-[28px] lg:p-4 lg:shadow-[0_24px_48px_-24px_rgba(63,55,201,0.6)]">
        <Link href="/accounts" className="flex items-center gap-3 px-4 pt-3 lg:px-1 lg:pt-1">
          <span className="flex size-11 items-center justify-center rounded-full bg-[#ffffff] text-[#3f37c9] shadow-lg"><Landmark className="size-5" /></span>
          <span className="leading-tight">
            <span className="block text-[16px] font-extrabold">الحسابات</span>
            <span className="block text-[10px] font-bold tracking-[0.18em] text-white/65">TRAVELIUN FINANCE</span>
          </span>
        </Link>
        {open && (
          <nav aria-label="أقسام الحسابات" className="flex gap-1 overflow-x-auto px-3 py-3 lg:mt-7 lg:flex-col lg:overflow-visible lg:p-0">
            {NAV.map(([href, label, Icon]) => {
              const on = current(href);
              return (
                <Link key={href} href={href} aria-current={on ? "page" : undefined}
                  className={`flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-2xl px-3 py-2 text-[13px] font-bold transition-colors lg:py-2.5 ${on ? "bg-[#ffffff] text-[#3f37c9] shadow-md" : "text-white/75 hover:bg-white/10 hover:text-white"}`}>
                  <Icon className="size-[18px]" />
                  {label}
                </Link>
              );
            })}
          </nav>
        )}
        <Link href="/dashboard" className="mt-auto hidden items-center gap-2.5 rounded-2xl px-3 py-2.5 text-[13px] font-bold text-white/75 hover:bg-white/10 hover:text-white lg:flex">
          <ArrowLeftRight className="size-[18px]" />
          العودة إلى ترافليون ون
        </Link>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="flex items-center gap-2 px-4 pb-1 pt-4 print:hidden lg:px-1 lg:pt-1">
          {/* the home names itself here; every other page carries its own heading, so this is only the trail */}
          {open && pathname === "/accounts" ? (
            <h1 className="text-[20px] font-extrabold text-tv-text-strong sm:text-[22px]">لوحة الحسابات</h1>
          ) : (
            <p className="text-[13px] font-bold text-tv-text-faint">الحسابات{title !== "الحسابات" && <span className="text-tv-text-muted"> ‹ {title}</span>}</p>
          )}
          <div className="ms-auto flex items-center gap-2">
            <button type="button" onClick={() => setTheme(dark ? "Light" : "Dark")} aria-label={dark ? "الوضع الفاتح" : "الوضع الداكن"} className={iconButton}>
              {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
            </button>
            {open && (
              <button type="button" onClick={() => void lockFinanceNow().then(() => router.refresh())} aria-label="قفل الآن" title="قفل الآن" className={iconButton}>
                <Lock className="size-[18px]" />
              </button>
            )}
            <Link href="/dashboard" className="inline-flex min-h-10 items-center gap-2 rounded-full bg-tv-action-primary px-4 text-[12.5px] font-bold text-tv-action-on-primary shadow-[var(--acc-shadow)] hover:bg-tv-action-primary-hover lg:hidden">
              <ArrowLeftRight className="size-4" />
              <span>ترافليون ون</span>
            </Link>
          </div>
        </header>
        <main className="px-4 py-4 lg:px-1 print:p-0">{children}</main>
      </div>
    </div>
  );
}
