"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { forwardRef, useEffect, useMemo, useState, type ComponentProps, type FormEvent } from "react";
import { DirectionProvider } from "@base-ui/react/direction-provider";
import { Dialog as PaletteDialog } from "@base-ui/react/dialog";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { DirText } from "@/components/DirText";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  AlertTriangle,
  Badge,
  BarChart3,
  BookOpen,
  Calculator,
  Car,
  ChevronDown,
  ChevronLeft,
  Columns3,
  Contact,
  FileText,
  Globe2,
  Handshake,
  Headphones,
  Hotel,
  Languages,
  Loader2,
  LogOut,
  Menu,
  NotebookText,
  Plane,
  Search,
  Settings,
  Ship,
  Table2,
  UserCircle,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { getRates } from "@/lib/data/rates-actions";
import type { TranslationKey } from "@/lib/i18n";
import { useRole } from "@/lib/roles/RoleContext";
import { ROLE_LABEL_KEYS, ROLES, type Permission } from "@/lib/roles/roles";
import { useTraveliunUI } from "./TraveliunUIProvider";
import { MobileTabBar } from "./MobileTabBar";
import { TraveliunLogo } from "./TraveliunLogo";

type TraveliunShellProps = {
  /** i18n key for the page title. */
  title: TranslationKey;
  children: React.ReactNode;
};

type NavLink = {
  labelKey: TranslationKey;
  href: string;
};

type NavGroup = {
  labelKey: TranslationKey;
  href: string;
  icon: LucideIcon;
  children?: NavLink[];
  /** hides the group unless the effective role holds this permission. */
  perm?: Permission;
};

const navGroups: NavGroup[] = [
  { labelKey: "nav.dashboard", href: "/dashboard", icon: BarChart3 },
  { labelKey: "nav.intelligenceHub", href: "/travel-intelligence", icon: Calculator },
  { labelKey: "nav.kanban", href: "/kanban-board", icon: Columns3 },
  {
    labelKey: "nav.customers",
    href: "/customers",
    icon: Contact,
    children: [
      { labelKey: "nav.people", href: "/customers" },
      { labelKey: "nav.companies", href: "/companies" },
      { labelKey: "nav.companiesVisits", href: "/companies-visits" },
      { labelKey: "nav.visitStatuses", href: "/companies-visits-statuses" },
    ],
  },
  {
    labelKey: "nav.employees",
    href: "/employees",
    icon: Users,
    perm: "employees.manage",
    children: [
      { labelKey: "nav.employees", href: "/employees" },
      { labelKey: "nav.roles", href: "/employees/roles" },
    ],
  },
  {
    labelKey: "nav.packages",
    href: "/offers",
    icon: FileText,
    children: [
      { labelKey: "nav.readyOffers", href: "/ready-offers" },
      { labelKey: "nav.packages", href: "/offers" },
      { labelKey: "nav.packageGenerator", href: "/package-generator" },
      { labelKey: "nav.repackage", href: "/repackage" },
      { labelKey: "nav.markupRules", href: "/markup-rules" },
      { labelKey: "nav.hotelSuppliers", href: "/settings/suppliers" },
      { labelKey: "nav.terms", href: "/offers/terms-and-conditions" },
      { labelKey: "nav.offerIncludes", href: "/offers/offer-includes" },
      { labelKey: "nav.offerExcludes", href: "/offers/offer-not-includes" },
    ],
  },
  {
    labelKey: "nav.countries",
    href: "/countries",
    icon: Globe2,
    children: [
      { labelKey: "nav.countries", href: "/countries" },
      { labelKey: "nav.cities", href: "/cities" },
    ],
  },
  {
    labelKey: "nav.hotels",
    href: "/hotels",
    icon: Hotel,
    children: [
      { labelKey: "nav.hotels", href: "/hotels" },
      { labelKey: "nav.roomTypes", href: "/rooms-types" },
    ],
  },
  {
    labelKey: "nav.airlines",
    href: "/airlines",
    icon: Plane,
    children: [
      { labelKey: "nav.airlines", href: "/airlines" },
      { labelKey: "nav.airports", href: "/airports" },
    ],
  },
  { labelKey: "nav.seaTravels", href: "/ports", icon: Ship, children: [{ labelKey: "nav.ports", href: "/ports" }] },
  {
    labelKey: "nav.transportation",
    href: "/cars",
    icon: Car,
    children: [
      { labelKey: "nav.carTypes", href: "/cars-types" },
      { labelKey: "nav.cars", href: "/cars" },
      { labelKey: "nav.transfers", href: "/cars/transfers" },
      { labelKey: "nav.tours", href: "/cars/tours" },
      { labelKey: "nav.drivers", href: "/drivers" },
    ],
  },
  {
    labelKey: "nav.services",
    href: "/services",
    icon: Handshake,
    children: [
      { labelKey: "nav.serviceTypes", href: "/services-types" },
      { labelKey: "nav.servicesByCountry", href: "/services" },
    ],
  },
  {
    labelKey: "nav.visas",
    href: "/visas",
    icon: Badge,
    children: [
      { labelKey: "nav.visaTypes", href: "/visas-types" },
      { labelKey: "nav.visas", href: "/visas" },
    ],
  },
  {
    labelKey: "nav.settings",
    href: "/setting/currencies",
    icon: Settings,
    perm: "settings.manage",
    children: [
      { labelKey: "nav.profits", href: "/setting/profits" },
      { labelKey: "nav.statusGroups", href: "/setting/statuses-groups" },
      { labelKey: "nav.statuses", href: "/setting/statuses" },
      { labelKey: "nav.currencies", href: "/setting/currencies" },
      { labelKey: "nav.suppliers", href: "/setting/suppliers" },
      { labelKey: "nav.supplierPreferences", href: "/setting/suppliers-preferences" },
      { labelKey: "nav.supervisors", href: "/setting/supervisors" },
      { labelKey: "nav.climate", href: "/setting/climate" },
    ],
  },
  {
    labelKey: "nav.customerCare",
    href: "/customers_care",
    icon: Headphones,
    children: [
      { labelKey: "nav.careDashboard", href: "/customers_care/dashboard" },
      { labelKey: "nav.customerCare", href: "/customers_care" },
      { labelKey: "nav.careServiceType", href: "/customers_care/services" },
    ],
  },
  {
    labelKey: "nav.traveliunGuide",
    href: "/web-guide",
    icon: BookOpen,
    children: [
      { labelKey: "nav.guide", href: "/web-guide" },
      { labelKey: "nav.guideCategories", href: "/guide/categories" },
      { labelKey: "nav.guideInfo", href: "/guide/informations" },
    ],
  },
];

function isGroupActive(pathname: string, group: NavGroup) {
  if (pathname === group.href) return true;
  return group.children?.some((child) => pathname === child.href || pathname.startsWith(`${child.href}/`)) ?? false;
}

export function TraveliunShell({ title, children }: TraveliunShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuPinned, setMenuPinned] = useState(false);
  const [menuHovered, setMenuHovered] = useState(false);
  const [activeMenu, setActiveMenu] = useState<TranslationKey>(() => {
    return navGroups.find((group) => isGroupActive(pathname, group))?.labelKey ?? navGroups[0].labelKey;
  });
  const [panel, setPanel] = useState<"guide" | "calculator" | "view" | "settings" | "profile" | null>(null);
  const { language, setLanguage, view, setView, theme, setTheme, dir, t } = useTraveliunUI();
  const { viewAs, resetViewAs, effectiveRole, can } = useRole();
  const visibleNavGroups = navGroups.filter((group) => !group.perm || can(group.perm));
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);

  // Opening a modal surface (palette / mobile drawer) closes any header panel —
  // "never two at once". The primitives own Escape/outside-click themselves.
  const openPalette = () => {
    setPanel(null);
    setMobileOpen(false);
    setPaletteOpen(true);
  };

  useEffect(() => {
    const matchingGroup = navGroups.find((group) => isGroupActive(pathname, group));

    if (matchingGroup) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing the active nav group to the URL is a legitimate route→state sync
      setActiveMenu(matchingGroup.labelKey);
    }
  }, [pathname]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // ⌘K / Ctrl-K toggles the palette. Escape is handled by each overlay
      // primitive (topmost only), so we don't intercept it globally.
      if ((event.metaKey || event.ctrlKey) && (event.key === "k" || event.key === "K")) {
        event.preventDefault();
        setPaletteOpen((value) => {
          if (!value) {
            setPanel(null);
            setMobileOpen(false);
          }
          return !value;
        });
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Route change closes EVERY overlay (a legitimate route→state sync).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setPaletteOpen(false);
    setPanel(null);
    setMobileOpen(false);
  }, [pathname]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const activeGroup = useMemo(
    () => navGroups.find((group) => group.labelKey === activeMenu) ?? navGroups[0],
    [activeMenu],
  );
  const menuOpen = menuPinned || menuHovered;
  const displayTitle = t(title);

  return (
    <DirectionProvider direction={dir}>
    <div className="tv-app min-h-screen bg-[#eef3f1] font-sans text-[#0f3d38]" dir={dir}>
      <div
        className={`fixed start-0 top-0 z-[90] hidden h-screen transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:block ${
          menuOpen ? "w-[260px]" : "w-[74px]"
        }`}
        onMouseEnter={() => setMenuHovered(true)}
        onMouseLeave={() => {
          if (!menuPinned) {
            setMenuHovered(false);
          }
        }}
      >
        <button
          type="button"
          className="absolute -end-4 top-5 z-[120] flex size-8 items-center justify-center rounded-full border border-[#dce3df] bg-white text-[#185045] shadow-[0_2px_8px_rgba(24,80,69,0.16)] transition-colors duration-200 hover:bg-[#f4f8f6]"
          aria-label={menuPinned ? t("aria.unpinSidebar") : t("aria.pinSidebar")}
          onClick={() => {
            setMenuPinned((value) => !value);
            setMenuHovered(true);
          }}
        >
          <ChevronLeft className={`size-5 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] ${menuOpen ? "rotate-180" : ""}`} />
        </button>

        <aside className="absolute start-0 top-0 z-10 h-screen w-[74px] border-e border-[#c8d2cd] bg-white">
          <Link href="/dashboard" className="flex h-[74px] items-center justify-center bg-[#185045]">
            <img src="/traveliun/logo-en.svg" alt="Traveliun" className="h-12 w-12 object-contain brightness-0 invert" />
          </Link>
          <nav className="flex max-h-[calc(100vh-74px)] flex-col overflow-hidden py-2">
            {visibleNavGroups.map((group) => {
              const Icon = group.icon;
              const active = isGroupActive(pathname, group);
              return (
                <button
                  key={group.labelKey}
                  type="button"
                  title={t(group.labelKey)}
                  className={`relative flex h-[44px] items-center justify-center transition-colors duration-200 ${
                    active ? "bg-[#eef4f1] font-extrabold text-[#185045]" : "text-[#6f8f88] hover:bg-[#f4f8f6] hover:text-[#185045]"
                  }`}
                  onClick={() => {
                    setActiveMenu(group.labelKey);
                    setMenuHovered(true);
                  }}
                >
                  <span
                    className={`absolute end-0 top-1/2 w-[3px] -translate-y-1/2 rounded-s-[3px] bg-[#185045] transition-[height] duration-150 ${
                      active ? "h-[22px]" : "h-0"
                    }`}
                  />
                  <Icon className="size-[21px]" />
                </button>
              );
            })}
          </nav>
        </aside>

        {menuOpen ? (
          <SideMenu
            activeGroup={activeGroup}
            pathname={pathname}
            setActiveMenu={setActiveMenu}
            close={() => {
              if (!menuPinned) {
                setMenuHovered(false);
              }
            }}
          />
        ) : null}
      </div>

      <header
        className={`fixed start-0 end-0 top-0 z-30 flex h-[60px] items-center gap-3 border-b border-[#dbe6e1] bg-white px-3 shadow-[0_1px_3px_rgba(0,60,58,0.05)] transition-[inset-inline-start] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:h-[74px] lg:px-5 ${
          menuOpen ? "lg:start-[260px]" : "lg:start-[74px]"
        }`}
      >
        <button
          type="button"
          className="flex size-9 shrink-0 items-center justify-center rounded-md text-[#557d78] lg:hidden"
          onClick={() => setMobileOpen(true)}
          aria-label={t("aria.openMenu")}
        >
          <Menu className="size-6" />
        </button>
        <div className="hidden min-w-[140px] shrink-0 lg:block">
          <div className="truncate text-lg font-extrabold leading-tight text-[#003c3a]">{displayTitle}</div>
          <div className="mt-0.5 text-[11.5px] font-semibold text-[#8aa29b]">{t("brand")}</div>
        </div>
        {/* phones: compact app-style title; the trial pill shows from lg up. */}
        <div className="min-w-0 flex-1 truncate text-center text-[15px] font-extrabold text-[#003c3a] lg:hidden">
          {displayTitle}
        </div>
        <div className="mx-auto hidden min-w-0 max-w-[520px] shrink items-center gap-2 rounded-full border border-[#f2e2b4] bg-[#fff8e8] px-4 py-2 text-[#a86a10] lg:flex">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="truncate text-[12.5px] font-bold leading-tight">{t("notice.trial")}</span>
        </div>
        <div className="flex h-full shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={openPalette}
            className="hidden h-10 items-center gap-2 rounded-[10px] border border-[#dbe6e1] bg-[#f5f8f7] pe-3 ps-2 text-[13px] font-semibold text-[#6f8f88] transition-colors hover:border-[#b7d0c7] hover:bg-[#eef4f1] sm:flex"
          >
            <Search className="size-[18px]" />
            <span className="hidden lg:inline">{t("quickSearch")}</span>
            <kbd className="hidden items-center gap-px rounded-md border border-[#dbe6e1] bg-white px-1.5 py-0.5 text-[11px] font-bold text-[#8aa29b] md:inline-flex">
              ⌘K
            </kbd>
          </button>

          <div className="hidden sm:block">
            <Popover open={panel === "guide"} onOpenChange={(o) => setPanel(o ? "guide" : null)}>
              <PopoverTrigger render={<HeaderIcon label={t("header.guide")} icon={NotebookText} active={panel === "guide"} />} />
              <PopoverContent className="w-[min(300px,calc(100vw-24px))]">
                <GuidePanel close={() => setPanel(null)} />
              </PopoverContent>
            </Popover>
          </div>

          <div className="hidden sm:block">
            <Popover open={panel === "calculator"} onOpenChange={(o) => setPanel(o ? "calculator" : null)}>
              <PopoverTrigger render={<HeaderIcon label={t("header.calculator")} icon={Calculator} active={panel === "calculator"} />} />
              <PopoverContent>
                <CalculatorPanel />
              </PopoverContent>
            </Popover>
          </div>

          <div className="hidden sm:block">
            <Popover open={panel === "view"} onOpenChange={(o) => setPanel(o ? "view" : null)}>
              <PopoverTrigger render={<HeaderIcon label={t("view")} icon={Table2} active={panel === "view"} />} />
              <PopoverContent className="w-[min(300px,calc(100vw-24px))]">
                <ViewPanel view={view} setView={setView} close={() => setPanel(null)} />
              </PopoverContent>
            </Popover>
          </div>

          <Popover open={panel === "settings"} onOpenChange={(o) => setPanel(o ? "settings" : null)}>
            <PopoverTrigger render={<HeaderIcon label={t("settings")} icon={Settings} active={panel === "settings"} />} />
            <PopoverContent className="w-[min(320px,calc(100vw-24px))]">
              <SettingsPanel language={language} setLanguage={setLanguage} theme={theme} setTheme={setTheme} close={() => setPanel(null)} />
            </PopoverContent>
          </Popover>

          <Popover open={panel === "profile"} onOpenChange={(o) => setPanel(o ? "profile" : null)}>
            <PopoverTrigger render={<HeaderIcon label={t("account")} icon={UserCircle} muted active={panel === "profile"} />} />
            <PopoverContent className="w-[min(320px,calc(100vw-24px))]">
              <ProfilePanel
                close={() => setPanel(null)}
                onChangePassword={() => {
                  setPanel(null);
                  setChangeOpen(true);
                }}
              />
            </PopoverContent>
          </Popover>
        </div>
      </header>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="inline-start" className="lg:hidden">
          <MobileMenu pathname={pathname} close={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <main
        className={`pt-[60px] transition-[margin] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:pt-[74px] ${
          menuOpen ? "lg:ms-[260px]" : "lg:ms-[74px]"
        }`}
      >
        {/* bottom padding on phones clears the fixed tab bar (+ safe area). */}
        <div className="px-4 py-4 pb-[calc(84px+env(safe-area-inset-bottom))] sm:px-5 lg:px-[30px] lg:pb-4">
          {viewAs ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[11px] border border-[#f2c94c] bg-[#fff8e8] px-4 py-3 text-[#8a6a00]">
              <span className="text-[13px] font-bold">
                {t("viewas.banner", { role: t(ROLE_LABEL_KEYS[effectiveRole]) })}
              </span>
              <button type="button" onClick={resetViewAs} className="inline-flex h-9 items-center gap-2 rounded-md bg-[#8a6a00] px-3 text-xs font-bold text-white hover:bg-[#6f5500]">
                {t("viewas.return")}
              </button>
            </div>
          ) : null}
          {children}
        </div>
      </main>

      <MobileTabBar pathname={pathname} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} pathname={pathname} />
      <ChangePasswordDialog open={changeOpen} onOpenChange={setChangeOpen} />
    </div>
    </DirectionProvider>
  );
}

type PaletteItem = {
  labelKey: TranslationKey;
  href: string;
  icon: LucideIcon;
};

function CommandPalette({ open, onOpenChange, pathname }: { open: boolean; onOpenChange: (open: boolean) => void; pathname: string }) {
  const { t } = useTraveliunUI();
  const [query, setQuery] = useState("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the search box when the palette closes
    if (!open) setQuery("");
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const seen = new Set<string>();
    const list: PaletteItem[] = [];
    for (const group of navGroups) {
      if (!seen.has(group.href)) {
        seen.add(group.href);
        list.push({ labelKey: group.labelKey, href: group.href, icon: group.icon });
      }
      for (const child of group.children ?? []) {
        if (!seen.has(child.href)) {
          seen.add(child.href);
          list.push({ labelKey: child.labelKey, href: child.href, icon: group.icon });
        }
      }
    }
    return list;
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const results = normalizedQuery
    ? items.filter((item) => t(item.labelKey).toLowerCase().includes(normalizedQuery))
    : items;

  return (
    <PaletteDialog.Root open={open} onOpenChange={onOpenChange}>
      <PaletteDialog.Portal>
        <PaletteDialog.Backdrop
          className="fixed inset-0 z-[160] backdrop-blur-[2px] transition-opacity duration-150 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0"
          style={{ background: "rgba(4,30,27,0.42)" }}
        />
        <PaletteDialog.Popup className="tv-pop fixed left-1/2 top-[12vh] z-[170] h-fit w-[min(560px,92vw)] -translate-x-1/2 overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(0,40,36,0.4)] outline-none transition-[opacity,transform] duration-150 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 dark:bg-[#14231f]">
          <div className="flex items-center gap-[11px] border-b border-[#eef2f0] px-[18px] py-[15px] dark:border-[#294039]">
            <Search className="size-[18px] text-[#93aaa3]" />
            <input
              autoFocus
              dir="auto"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("palettePlaceholder")}
              className="flex-1 bg-transparent text-[15px] text-[#0f3d38] outline-none placeholder:text-[#9cafaa] dark:text-[#eaf3ef]"
            />
            <kbd className="rounded-md border border-[#e2ebe7] bg-[#f1f5f3] px-2 py-[3px] text-[11px] font-bold text-[#8aa29b] dark:border-[#294039] dark:bg-[#1b2d27]">
              ESC
            </kbd>
          </div>
          <div className="max-h-[340px] overflow-y-auto p-2">
            {results.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => onOpenChange(false)}
                  className="flex w-full items-center gap-3 rounded-[10px] px-3 py-[11px] text-start text-[#0f3d38] transition-colors hover:bg-[#f2f7f5] dark:text-[#eaf3ef] dark:hover:bg-[#1b2d27]"
                >
                  <span className="flex size-[34px] shrink-0 items-center justify-center rounded-[9px] bg-[#eff5f2] text-[#185045] dark:bg-[#1b2d27]">
                    <Icon className="size-[18px]" />
                  </span>
                  <span className="flex-1 text-sm font-semibold">{t(item.labelKey)}</span>
                  {isActive ? (
                    <span className="rounded-full bg-[#e4f6ef] px-2 py-0.5 text-[10.5px] font-bold text-[#2aa87a]">{t("current")}</span>
                  ) : null}
                </Link>
              );
            })}
            {results.length === 0 ? (
              <div className="px-3 py-8 text-center text-[13px] text-[#93aaa3]">{t("paletteEmpty")}</div>
            ) : null}
          </div>
        </PaletteDialog.Popup>
      </PaletteDialog.Portal>
    </PaletteDialog.Root>
  );
}

function SideMenu({
  activeGroup,
  pathname,
  setActiveMenu,
  close,
}: {
  activeGroup: NavGroup;
  pathname: string;
  setActiveMenu: (key: TranslationKey) => void;
  close: () => void;
}) {
  const { t } = useTraveliunUI();
  const { can } = useRole();
  return (
    <aside className="traveliun-side-menu absolute start-0 top-0 z-30 h-screen w-[260px] overflow-hidden border-e border-[#d9e0dc] bg-white shadow-[0_8px_28px_rgba(0,0,0,0.12)]">
      <div className="flex h-[96px] items-center justify-center bg-[#185045] px-6">
        <img src="/traveliun/logo-en.svg" alt="Traveliun" className="max-h-[68px] w-[170px] object-contain brightness-0 invert" />
      </div>
      <nav className="h-[calc(100vh-96px)] overflow-y-auto py-2 text-[#185045]">
        {navGroups.filter((group) => !group.perm || can(group.perm)).map((group) => {
          const Icon = group.icon;
          const active = group.labelKey === activeGroup.labelKey;
          const hasChildren = Boolean(group.children?.length);
          return (
            <div key={group.labelKey}>
              {hasChildren ? (
                <button
                  type="button"
                  onClick={() => setActiveMenu(group.labelKey)}
                  className={`flex w-full items-center gap-3 px-4 py-[11px] text-start text-[13px] font-bold transition-colors duration-200 ${
                    active ? "bg-[#185045] text-white" : "text-[#185045] hover:bg-[#eef4f1]"
                  }`}
                >
                  <Icon className="size-5" />
                  <span className="flex-1">{t(group.labelKey)}</span>
                  <ChevronDown className={`size-4 transition-transform duration-200 ${active ? "" : "rotate-90"}`} />
                </button>
              ) : (
                <Link
                  href={group.href}
                  onClick={close}
                  className={`flex w-full items-center gap-3 px-4 py-[11px] text-start text-[13px] font-bold transition-colors duration-200 ${
                    active ? "bg-[#185045] text-white" : "text-[#185045] hover:bg-[#eef4f1]"
                  }`}
                >
                  <Icon className="size-5" />
                  <span className="flex-1">{t(group.labelKey)}</span>
                  <ChevronDown className="size-4 rotate-90" />
                </Link>
              )}
              {active && group.children ? (
                <div className="py-1">
                  {group.children.map((child) => {
                    const childActive = pathname === child.href;
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        onClick={close}
                        className={`relative mx-[10px] block rounded-[7px] px-6 py-[10px] text-[13px] transition-colors duration-200 ${
                          childActive
                            ? "bg-[#eef4f1] font-extrabold text-[#185045]"
                            : "font-medium text-[#557d78] hover:bg-[#f4f8f6] hover:text-[#185045]"
                        }`}
                      >
                        <span
                          className={`absolute end-0 top-1/2 w-[3px] -translate-y-1/2 rounded-s-[3px] bg-[#185045] transition-[height] duration-150 ${
                            childActive ? "h-[18px]" : "h-0"
                          }`}
                        />
                        <span className="ms-2">•</span>
                        {t(child.labelKey)}
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function MobileMenu({ pathname, close }: { pathname: string; close: () => void }) {
  const { t } = useTraveliunUI();
  const { can } = useRole();
  return (
    <>
      <div className="flex h-[76px] items-center justify-between border-b border-[#d9e0dc] px-5">
        <TraveliunLogo />
        <button
          type="button"
          className="flex size-9 items-center justify-center rounded-md text-[#185045]"
          onClick={close}
          aria-label={t("aria.closeMenu")}
        >
          <X className="size-5" />
        </button>
      </div>
      <nav className="p-3">
        {navGroups.filter((group) => !group.perm || can(group.perm)).map((group) => {
          const Icon = group.icon;
          const active = isGroupActive(pathname, group);
          return (
            <div key={group.labelKey} className="mb-1">
              <Link
                href={group.href}
                className={`flex items-center gap-3 rounded-md px-3 py-3 text-sm ${
                  active ? "bg-[#e8f1ed] font-semibold text-[#185045]" : "text-[#557d78]"
                }`}
                onClick={close}
              >
                <Icon className="size-5" />
                <span>{t(group.labelKey)}</span>
              </Link>
            </div>
          );
        })}
      </nav>
    </>
  );
}

const HeaderIcon = forwardRef<
  HTMLButtonElement,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    muted?: boolean;
    active?: boolean;
  } & ComponentProps<"button">
>(function HeaderIcon({ label, icon: Icon, muted = false, active = false, className, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={cn(
        "flex h-full min-w-[66px] items-center justify-center border-e border-[#eef2f0] outline-none transition-colors hover:bg-[#f5f8f6] focus-visible:bg-[#e8f1ed]",
        active ? "bg-[#e8f1ed] text-[#185045]" : muted ? "bg-[#f0f2f2] text-[#b2b7bc]" : "text-[#185045]",
        className,
      )}
      {...props}
    >
      <Icon className="size-6" />
    </button>
  );
});

function GuidePanel({ close }: { close: () => void }) {
  const { t } = useTraveliunUI();
  return (
    <div>
      <h3 className="mb-3 text-sm font-bold text-[#185045]">{t("guideTitle")}</h3>
      <div className="grid gap-2">
        {([
          ["nav.guide", "/web-guide"],
          ["nav.guideCategories", "/guide/categories"],
          ["nav.guideInfo", "/guide/informations"],
          ["nav.customerCare", "/customers_care"],
        ] as const).map(([labelKey, href]) => (
          <Link
            key={href}
            href={href}
            onClick={close}
            className="rounded-md border border-[#e3ebe7] px-3 py-2 text-sm text-[#557d78] hover:bg-[#f7faf8]"
          >
            {t(labelKey)}
          </Link>
        ))}
      </div>
    </div>
  );
}

function CalculatorPanel() {
  const { t } = useTraveliunUI();
  const [sarPer, setSarPer] = useState<Record<string, number>>({});
  const [source, setSource] = useState<"live" | "fallback" | null>(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState("100");
  const [from, setFrom] = useState("SAR");
  const [to, setTo] = useState("USD");

  useEffect(() => {
    let active = true;
    getRates()
      .then((r) => {
        if (!active) return;
        setSarPer(r.sarPer);
        setSource(r.source);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const codes = Object.keys(sarPer);
  const amt = Number(amount);
  const rateFrom = sarPer[from];
  const rateTo = sarPer[to];
  const converted = Number.isFinite(amt) && rateFrom && rateTo ? amt * (rateFrom / rateTo) : null;
  const unitRate = rateFrom && rateTo ? rateFrom / rateTo : null;

  return (
    <div>
      <h3 className="mb-3 text-sm font-bold text-[#185045]">{t("calcTitle")}</h3>
      {loading ? (
        <div className="tv-shimmer h-24 rounded-md" />
      ) : (
        <div className="space-y-3">
          <input
            type="number"
            dir="ltr"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="tv-tnum h-10 w-full rounded-md border border-[#ddd4d3] px-3 text-start text-sm outline-none focus:border-[#185045]"
          />
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <select value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 rounded-md border border-[#ddd4d3] bg-white px-2 text-sm outline-none">
              {codes.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
            <button
              type="button"
              onClick={() => { setFrom(to); setTo(from); }}
              className="flex size-8 items-center justify-center rounded-md border border-[#ddd4d3] text-[#185045] hover:bg-[#f4f8f6]"
              aria-label={t("aria.swap")}
            >
              ⇄
            </button>
            <select value={to} onChange={(e) => setTo(e.target.value)} className="h-10 rounded-md border border-[#ddd4d3] bg-white px-2 text-sm outline-none">
              {codes.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
          </div>
          <div className="rounded-md bg-[#edf3f0] p-3 text-sm text-[#185045]">
            {converted != null ? (
              <span className="tv-tnum font-bold">
                <DirText dir="ltr">{new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(converted)}</DirText> {to}
              </span>
            ) : (
              "—"
            )}
            {unitRate != null ? (
              <p className="tv-tnum mt-1 text-[11px] font-semibold text-[#6f8f88]">
                <DirText dir="ltr">{`1 ${from} = ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 }).format(unitRate)} ${to}`}</DirText>
              </p>
            ) : null}
          </div>
          <p className="text-[11px] font-semibold text-[#93aaa3]">
            {source === "live" ? t("calc.live") : t("calc.fallback")}
          </p>
        </div>
      )}
    </div>
  );
}

function ViewPanel({
  view,
  setView,
  close,
}: {
  view: "table" | "cards";
  setView: (view: "table" | "cards") => void;
  close: () => void;
}) {
  const { t } = useTraveliunUI();
  return (
    <div>
      <h3 className="mb-3 text-sm font-bold text-[#185045] dark:text-[#d6e5df]">{t("view")}</h3>
      <div className="grid grid-cols-2 gap-2">
        {(["table", "cards"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => {
              setView(item);
              close();
            }}
            className={`rounded-md border px-3 py-3 text-sm font-semibold ${
              view === item ? "border-[#185045] bg-[#185045] text-white" : "border-[#dfe8e4] text-[#557d78]"
            }`}
          >
            {item === "table" ? t("viewTable") : t("viewCards")}
          </button>
        ))}
      </div>
    </div>
  );
}

function SettingsPanel({
  language,
  setLanguage,
  theme,
  setTheme,
  close,
}: {
  language: "en" | "ar";
  setLanguage: (language: "en" | "ar") => void;
  theme: "Light" | "Dark" | "System";
  setTheme: (theme: "Light" | "Dark" | "System") => void;
  close: () => void;
}) {
  const { t } = useTraveliunUI();
  const themeLabel: Record<"Light" | "Dark" | "System", string> = { Light: t("light"), Dark: t("dark"), System: t("system") };
  // Single-select = terminal action → close. Closing BEFORE the language change
  // flips `dir` avoids leaving the panel stranded on the now-wrong side.
  const pickLanguage = (lang: "en" | "ar") => {
    close();
    setLanguage(lang);
  };
  const pickTheme = (next: "Light" | "Dark" | "System") => {
    close();
    setTheme(next);
  };
  return (
    <div>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-[#185045] dark:text-[#d6e5df]">
        <Languages className="size-4" />
        {t("settings")}
      </h3>
      <p className="mb-2 text-xs font-semibold text-[#8ba09b]">{t("language")}</p>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => pickLanguage("en")} className={panelButton(language === "en")}>
          English
        </button>
        <button type="button" onClick={() => pickLanguage("ar")} className={panelButton(language === "ar")}>
          العربية
        </button>
      </div>
      <p className="mb-2 text-xs font-semibold text-[#8ba09b]">{t("theme")}</p>
      <div className="grid grid-cols-3 gap-2">
        {(["Light", "Dark", "System"] as const).map((item) => (
          <button key={item} type="button" onClick={() => pickTheme(item)} className={panelButton(theme === item)}>
            {themeLabel[item]}
          </button>
        ))}
      </div>
    </div>
  );
}

function ProfilePanel({ close, onChangePassword }: { close: () => void; onChangePassword: () => void }) {
  const router = useRouter();
  const { t } = useTraveliunUI();
  const { devMode, realRole, effectiveRole, viewAs, setViewAs, resetViewAs } = useRole();
  const [email, setEmail] = useState<string>("");
  const [signingOut, setSigningOut] = useState(false);
  const [showViewAs, setShowViewAs] = useState(false);

  useEffect(() => {
    let active = true;
    try {
      createSupabaseBrowserClient()
        .auth.getUser()
        .then(({ data }) => {
          if (active) setEmail(data.user?.email ?? "");
        })
        .catch(() => {
          /* unauthenticated — keep placeholder */
        });
    } catch {
      /* env missing — keep placeholder */
    }
    return () => {
      active = false;
    };
  }, []);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await createSupabaseBrowserClient().auth.signOut();
    } catch {
      /* ignore — clear client state regardless */
    }
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => devMode && setShowViewAs((v) => !v)}
        className={`mb-4 flex w-full items-center gap-3 rounded-md px-1 py-1 text-start ${devMode ? "hover:bg-[#f4f8f6]" : "cursor-default"}`}
      >
        <UserCircle className="size-10 text-[#b2b7bc]" />
        <div className="min-w-0 flex-1">
          <p className="font-bold text-[#185045]">{t("account")} · {t(ROLE_LABEL_KEYS[effectiveRole])}</p>
          <p dir="ltr" className="truncate text-start text-xs text-[#8ba09b]">{email || "—"}</p>
        </div>
        {devMode ? <ChevronDown className={`size-4 text-[#9caaa6] transition-transform ${showViewAs ? "rotate-180" : ""}`} /> : null}
      </button>

      {devMode && showViewAs ? (
        <div className="mb-3 rounded-md border border-[#f2e2b4] bg-[#fffdf5] p-2">
          <p className="mb-2 px-1 text-[11px] font-bold text-[#a86a10]">{t("viewas.title")}</p>
          <div className="grid grid-cols-2 gap-1.5">
            {ROLES.map((role) => {
              const active = (viewAs ?? realRole) === role;
              return (
                <button
                  key={role}
                  type="button"
                  onClick={() => {
                    if (role === realRole) resetViewAs();
                    else setViewAs(role);
                    close();
                  }}
                  className={`rounded-md px-2 py-2 text-xs font-bold transition-colors ${active ? "bg-[#185045] text-white" : "border border-[#e2d8d4] text-[#185045] hover:bg-[#f4f8f6]"}`}
                >
                  {t("viewas.as", { role: t(ROLE_LABEL_KEYS[role]) })}
                </button>
              );
            })}
          </div>
          {viewAs ? (
            <button
              type="button"
              onClick={() => {
                resetViewAs();
                close();
              }}
              className="mt-2 w-full rounded-md bg-[#8a6a00] px-2 py-1.5 text-xs font-bold text-white hover:bg-[#6f5500]"
            >
              {t("viewas.returnWithRole", { role: t(ROLE_LABEL_KEYS[realRole]) })}
            </button>
          ) : null}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onChangePassword}
        className="mb-2 w-full rounded-md border border-[#dfe8e4] px-3 py-2 text-start text-sm text-[#557d78] transition-colors hover:bg-[#f4f8f6] dark:border-[#294039] dark:hover:bg-[#1b2d27]"
      >
        {t("changePassword")}
      </button>
      <button
        type="button"
        onClick={signOut}
        disabled={signingOut}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-[#185045] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0f4439] disabled:opacity-70"
      >
        {signingOut ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
        {signingOut ? t("signingOut") : t("signOut")}
      </button>
    </div>
  );
}

function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTraveliunUI();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const close = () => onOpenChange(false);

  // Reset the form whenever the dialog is closed so it opens clean next time.
  useEffect(() => {
    if (!open) {
      setPassword("");
      setConfirm("");
      setError(null);
      setDone(false);
      setLoading(false);
    }
  }, [open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setError(null);

    if (password.length < 6) {
      setError(t("pwd.tooShort"));
      return;
    }
    if (password !== confirm) {
      setError(t("pwd.mismatch"));
      return;
    }

    setLoading(true);
    try {
      const { error: updateError } = await createSupabaseBrowserClient().auth.updateUser({ password });
      if (updateError) {
        setError(t("pwd.failed"));
        return;
      }
      setDone(true);
    } catch {
      setError(t("pwd.connection"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px]" showClose={false}>
        <form onSubmit={submit}>
        <div className="mb-5 flex items-center justify-between border-b border-[#e1e9e5] pb-4 dark:border-[#294039]">
          <h2 className="text-lg font-extrabold">{t("pwd.title")}</h2>
          <button type="button" onClick={close} className="rounded-md p-2 text-[#557d78] hover:bg-[#edf3f0] dark:hover:bg-[#1b2d27]" aria-label={t("close")}>
            <X className="size-5" />
          </button>
        </div>

        {done ? (
          <div className="space-y-4 text-center">
            <p className="rounded-[10px] border border-[#bfe5d4] bg-[#e9f7f0] px-4 py-3 text-sm font-bold text-[#0f7a52]">
              {t("pwd.success")}
            </p>
            <button
              type="button"
              onClick={close}
              className="h-11 w-full rounded-[10px] bg-[#185045] text-sm font-bold text-white transition-colors hover:bg-[#0f4439]"
            >
              {t("done")}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <label className="grid gap-2 text-[13px] font-bold">
              {t("pwd.new")}
              <input
                type="password"
                dir="ltr"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={loading}
                autoComplete="new-password"
                className="h-11 rounded-[10px] border border-[#d9e3df] bg-white px-3 text-start text-sm font-normal outline-none transition-colors focus:border-[#2aa87a]"
              />
            </label>
            <label className="grid gap-2 text-[13px] font-bold">
              {t("pwd.confirm")}
              <input
                type="password"
                dir="ltr"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                disabled={loading}
                autoComplete="new-password"
                className="h-11 rounded-[10px] border border-[#d9e3df] bg-white px-3 text-start text-sm font-normal outline-none transition-colors focus:border-[#2aa87a]"
              />
            </label>

            {error ? (
              <p role="alert" className="rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] px-4 py-2.5 text-[13px] font-semibold text-[#c22850]">
                {error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={close}
                className="h-11 rounded-[10px] border border-[#d8e3de] px-5 text-sm font-bold text-[#185045] transition-colors hover:bg-[#f4f8f6]"
              >
                {t("cancel")}
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex h-11 items-center justify-center gap-2 rounded-[10px] bg-[#185045] px-6 text-sm font-bold text-white transition-colors hover:bg-[#0f4439] disabled:opacity-70"
              >
                {loading ? <Loader2 className="size-4 animate-spin" /> : null}
                {loading ? t("saving") : t("save")}
              </button>
            </div>
          </div>
        )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

function panelButton(active: boolean) {
  return `rounded-md border px-3 py-2 text-sm font-semibold ${
    active ? "border-[#185045] bg-[#185045] text-white" : "border-[#dfe8e4] text-[#557d78]"
  }`;
}
