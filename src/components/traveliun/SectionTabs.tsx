"use client";

import Link from "next/link";
import type { TranslationKey } from "@/lib/i18n";
import { tabsFor } from "@/lib/nav/consolidated";
import { useCanOpen } from "@/lib/roles/useCanOpen";
import { cn } from "@/lib/utils";
import { useTraveliunUI } from "./TraveliunUIProvider";

/**
 * The tabs over a merged page («الموظفين»: the record, the logins, the roles…)
 * — the menu holds one link, the tabs the rest (lib/nav/consolidated.ts). Each
 * tab is its own route and keeps its own gate: a tab the role cannot open is
 * not shown, and one tab alone is no row.
 */
export function SectionTabs({ pathname }: { pathname: string }) {
  const { t } = useTraveliunUI();
  const opens = useCanOpen();
  const found = tabsFor(pathname);
  if (!found) return null;
  const tabs = found.tabs.filter((tab) => opens({ href: tab.href }));
  if (tabs.length < 2) return null;
  return (
    <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-[#dbe6e1]" aria-label={t(tabs[0].labelKey as TranslationKey)}>
      {tabs.map((tab) => {
        const active = tab.href === found.active;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-bold transition-colors",
              active ? "border-[var(--tv-brand)] text-[var(--tv-brand)]" : "border-transparent text-tv-text-faint hover:text-[var(--tv-brand)]",
            )}
          >
            {t(tab.labelKey as TranslationKey)}
          </Link>
        );
      })}
    </nav>
  );
}
