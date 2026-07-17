"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  Calculator,
  Columns3,
  Contact,
  FilePlus2,
  FileText,
  FileUp,
  Globe2,
  Hotel,
  LayoutGrid,
  RotateCcw,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useRole } from "@/lib/roles/RoleContext";
import type { Permission } from "@/lib/roles/roles";
import type { TranslationKey } from "@/lib/i18n";
import { useTraveliunUI } from "./TraveliunUIProvider";

/**
 * Mobile bottom tab bar (app idiom) — 4 USER-PICKED shortcuts + a "more" button
 * that opens a bottom sheet where the user customizes which destinations appear.
 * Selection persists in localStorage; destinations are permission-filtered.
 */

type TabDest = { id: string; labelKey: TranslationKey; href: string; icon: LucideIcon; perm?: Permission };

const DESTINATIONS: TabDest[] = [
  { id: "dashboard", labelKey: "nav.dashboard", href: "/dashboard", icon: BarChart3 },
  { id: "kanban", labelKey: "nav.kanban", href: "/kanban-board", icon: Columns3 },
  { id: "generator", labelKey: "nav.packageGenerator", href: "/package-generator", icon: FilePlus2 },
  { id: "repackage", labelKey: "nav.repackage", href: "/repackage", icon: FileUp, perm: "repackage.write" },
  { id: "offers", labelKey: "nav.packages", href: "/offers", icon: FileText },
  { id: "customers", labelKey: "nav.customers", href: "/customers", icon: Contact },
  { id: "hotels", labelKey: "nav.hotels", href: "/hotels", icon: Hotel },
  { id: "countries", labelKey: "nav.countries", href: "/countries", icon: Globe2 },
  { id: "intelligence", labelKey: "nav.intelligenceHub", href: "/travel-intelligence", icon: Calculator },
  { id: "employees", labelKey: "nav.employees", href: "/employees", icon: Users, perm: "employees.manage" },
];

const STORAGE_KEY = "traveliun-mobile-tabs";
const DEFAULT_TABS = ["dashboard", "kanban", "generator", "repackage"];
const MAX_TABS = 4;

function loadTabs(): string[] {
  if (typeof window === "undefined") return DEFAULT_TABS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_TABS;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_TABS;
    const known = new Set(DESTINATIONS.map((d) => d.id));
    const ids = parsed.filter((v): v is string => typeof v === "string" && known.has(v));
    return ids.length > 0 ? ids.slice(0, MAX_TABS) : DEFAULT_TABS;
  } catch {
    return DEFAULT_TABS;
  }
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MobileTabBar({ pathname }: { pathname: string }) {
  const { t } = useTraveliunUI();
  const { can } = useRole();
  const [tabs, setTabs] = useState<string[]>(DEFAULT_TABS);
  const [customizing, setCustomizing] = useState(false);

  // hydrate the persisted selection after mount (SSR-safe).
  useEffect(() => {
    setTabs(loadTabs());
  }, []);

  const allowed = useMemo(() => DESTINATIONS.filter((d) => !d.perm || can(d.perm)), [can]);
  const allowedById = useMemo(() => new Map(allowed.map((d) => [d.id, d])), [allowed]);
  const shown = tabs.map((id) => allowedById.get(id)).filter((d): d is TabDest => Boolean(d)).slice(0, MAX_TABS);

  function persist(next: string[]) {
    setTabs(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  /** Toggle a destination; when already at the max, the oldest pick makes room. */
  function toggle(id: string) {
    if (tabs.includes(id)) {
      persist(tabs.filter((v) => v !== id));
      return;
    }
    const next = [...tabs, id];
    persist(next.length > MAX_TABS ? next.slice(next.length - MAX_TABS) : next);
  }

  return (
    <>
      <nav
        aria-label={t("tabbar.aria")}
        className="fixed inset-x-0 bottom-0 z-40 border-t border-[#dbe6e1] bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_12px_rgba(0,60,58,0.07)] backdrop-blur lg:hidden dark:border-[#294039] dark:bg-[#0f1f1b]/95"
      >
        <div className="grid h-[62px] grid-cols-5">
          {shown.map((d) => {
            const active = isActive(pathname, d.href);
            return (
              <Link
                key={d.id}
                href={d.href}
                className={`relative flex flex-col items-center justify-center gap-1 ${
                  active ? "text-[#185045] dark:text-[#7fd0b2]" : "text-[#7d968f] dark:text-[#7d968f]"
                }`}
              >
                <span
                  className={`absolute top-0 h-[3px] w-8 rounded-b-full bg-[#185045] transition-opacity dark:bg-[#7fd0b2] ${
                    active ? "opacity-100" : "opacity-0"
                  }`}
                />
                <d.icon className="size-[22px]" strokeWidth={active ? 2.4 : 2} />
                <span className={`max-w-full truncate px-1 text-[10px] leading-none ${active ? "font-extrabold" : "font-semibold"}`}>
                  {t(d.labelKey)}
                </span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setCustomizing(true)}
            className="flex flex-col items-center justify-center gap-1 text-[#7d968f]"
          >
            <LayoutGrid className="size-[22px]" />
            <span className="text-[10px] font-semibold leading-none">{t("tabbar.more")}</span>
          </button>
        </div>
      </nav>

      <Sheet open={customizing} onOpenChange={setCustomizing}>
        <SheetContent side="bottom" className="lg:hidden">
          <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-[#dbe6e1] dark:bg-[#294039]" />
          <div className="flex items-center justify-between px-5 pb-1 pt-3">
            <h3 className="text-[15px] font-extrabold text-[#003c3a] dark:text-[#eaf3ef]">{t("tabbar.customize")}</h3>
            <button
              type="button"
              onClick={() => persist(DEFAULT_TABS)}
              className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-xs font-bold text-[#557d78] hover:text-[#185045]"
            >
              <RotateCcw className="size-3.5" /> {t("dash.resetDefault")}
            </button>
          </div>
          <p className="px-5 pb-3 text-[12px] font-semibold text-[#8aa29b]">{t("tabbar.hint")}</p>
          <div className="space-y-1.5 overflow-y-auto px-4 pb-3">
            {allowed.map((d) => {
              const order = tabs.indexOf(d.id);
              const selected = order >= 0;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => toggle(d.id)}
                  className={`flex h-12 w-full items-center gap-3 rounded-[12px] border px-3 text-start transition-colors ${
                    selected
                      ? "border-[#185045] bg-[#eef4f1] dark:border-[#7fd0b2] dark:bg-[#12352c]"
                      : "border-[#e2ebe7] bg-white dark:border-[#294039] dark:bg-transparent"
                  }`}
                >
                  <d.icon className={`size-5 shrink-0 ${selected ? "text-[#185045] dark:text-[#7fd0b2]" : "text-[#7d968f]"}`} />
                  <span className={`flex-1 truncate text-[13.5px] ${selected ? "font-extrabold text-[#0f3d38] dark:text-[#eaf3ef]" : "font-semibold text-[#557d78]"}`}>
                    {t(d.labelKey)}
                  </span>
                  {selected ? (
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#185045] text-[11.5px] font-extrabold text-white dark:bg-[#7fd0b2] dark:text-[#0f1f1b]">
                      {order + 1}
                    </span>
                  ) : (
                    <span className="size-6 shrink-0 rounded-full border-2 border-[#d5e0db] dark:border-[#3a544b]" />
                  )}
                </button>
              );
            })}
          </div>
          <div className="border-t border-[#eef2f0] p-4 dark:border-[#294039]">
            <button
              type="button"
              onClick={() => setCustomizing(false)}
              className="h-11 w-full rounded-[11px] bg-[#185045] text-sm font-bold text-white transition-colors hover:bg-[#0f4439]"
            >
              {t("done")}
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
