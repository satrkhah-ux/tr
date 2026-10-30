"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { ArrowLeftRight, Landmark, Lock, Moon, Sun } from "lucide-react";
import { lockFinanceNow, touchFinanceUnlock } from "@/lib/data/finance";
import { useTraveliunUI } from "../TraveliunUIProvider";

/**
 * «الحسابات»' own frame — no Traveliun menu, a financial system's header and navigation, the way back
 * to Traveliun always in reach (the owner, 2026-10-30). Its colours are accounts.css (.acc-app).
 */

const NAV: [string, string][] = [
  ["/accounts", "الرئيسية"],
  ["/accounts/dues", "المستحقات"],
  ["/accounts/invoices", "الفواتير"],
  ["/accounts/reports", "التقارير"],
  ["/accounts/expenses", "المصروفات"],
  ["/accounts/suppliers", "الموردون"],
  ["/accounts/quotes", "عروض الأسعار"],
  ["/accounts/journal", "القيود"],
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

export function AccountsShell({ open, children }: { open: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTraveliunUI();
  // the saved choice only: reading the system's preference here would differ between server and browser
  const dark = theme === "Dark";
  const current = (href: string) => (href === "/accounts" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`));

  return (
    <div dir="rtl" className="acc-app min-h-dvh">
      {open && <KeepOpen />}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[var(--acc-header)] text-[var(--acc-header-text)] print:hidden">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Link href="/accounts" className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-lg bg-[var(--acc-gold)] text-[#0b1b33]"><Landmark className="size-5" /></span>
            <span className="leading-tight">
              <span className="block text-[15px] font-extrabold">الحسابات</span>
              <span className="block text-[10.5px] font-semibold tracking-wide text-[var(--acc-header-muted)]">TRAVELIUN FINANCE</span>
            </span>
          </Link>
          <div className="ms-auto flex items-center gap-1.5">
            <button type="button" onClick={() => setTheme(dark ? "Light" : "Dark")} aria-label={dark ? "الوضع الفاتح" : "الوضع الداكن"}
              className="flex size-10 items-center justify-center rounded-lg text-[var(--acc-header-muted)] hover:bg-white/10 hover:text-white">
              {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
            </button>
            {open && (
              <button type="button" onClick={() => void lockFinanceNow().then(() => router.refresh())} aria-label="قفل الآن"
                className="flex size-10 items-center justify-center rounded-lg text-[var(--acc-header-muted)] hover:bg-white/10 hover:text-white">
                <Lock className="size-5" />
              </button>
            )}
            <Link href="/dashboard" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-white/20 px-3 text-[12.5px] font-bold hover:bg-white/10">
              <ArrowLeftRight className="size-4" />
              <span>العودة إلى ترافليون ون</span>
            </Link>
          </div>
          {open && (
            <nav aria-label="أقسام الحسابات" className="-mx-1 flex w-full gap-1 overflow-x-auto pb-0.5">
              {NAV.map(([href, label]) => (
                <Link key={href} href={href} aria-current={current(href) ? "page" : undefined}
                  className={`whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] font-bold ${current(href) ? "bg-white/15 text-white shadow-[inset_0_-2px_0_var(--acc-gold)]" : "text-[var(--acc-header-muted)] hover:bg-white/10 hover:text-white"}`}>
                  {label}
                </Link>
              ))}
            </nav>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-5 print:max-w-none print:p-0">{children}</main>
    </div>
  );
}
