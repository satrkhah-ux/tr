"use client";

import { FollowupBadge } from "./followups/FollowupEntry";
import { MyFollowupBadge } from "./mine/MyFollowupBadge";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentProps,
} from "react";
import { DirectionProvider } from "@base-ui/react/direction-provider";
import { Dialog as PaletteDialog } from "@base-ui/react/dialog";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { touchPresence } from "@/lib/data/metrics";
import { cn } from "@/lib/utils";
import { DirText } from "@/components/DirText";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { SecretaryFab } from "@/components/traveliun/secretary/SecretaryFab";
import { NotificationBell } from "@/components/traveliun/notifications/NotificationBell";
import {
  AlertTriangle,
  BarChart3,
  BotMessageSquare,
  Building2,
  BadgePercent,
  Car,
  Calculator,
  ChevronDown,
  ChevronLeft,
  ClipboardCheck,
  Database,
  FileText,
  Gavel,
  Languages,
  Loader2,
  Lock,
  LogOut,
  Menu,
  NotebookText,
  Search,
  Settings,
  UserRound,
  Users,
  Settings2,
  Stamp,
  Table2,
  UserCircle,
  Timer,
  Wrench,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { getRates } from "@/lib/data/rates-actions";
import type { TranslationKey } from "@/lib/i18n";
import { useRole } from "@/lib/roles/RoleContext";
import { usePartnerBrand } from "@/lib/partners/PartnerContext";
import { ROLE_LABEL_KEYS, type Permission } from "@/lib/roles/roles";
import { canOpenLink, type FeatureCheck } from "@/lib/roles/section-access";
import { useCanOpen } from "@/lib/roles/useCanOpen";
import { TAB_GROUPS } from "@/lib/nav/consolidated";
import { useTraveliunUI } from "./TraveliunUIProvider";
import { MobileTabBar } from "./MobileTabBar";
import { SectionTabs } from "./SectionTabs";
import { ChangePasswordDialog } from "./ChangePasswordDialog";
import { ViewAsBanner, ViewAsSwitcher } from "./ViewAsSwitcher";
import { TraveliunLogo } from "./TraveliunLogo";
import { clearPendingDrafts } from "./generator/useDraftState";
import { SERVER_LOST_EVENT } from "./useSafeTransition";

type TraveliunShellProps = {
  /** i18n key for the page title. */
  title: TranslationKey;
  /**
   * Hide the sidebar and the app header, and give the page the whole screen.
   *
   * For the one screen where navigating away mid-task is the mistake: building
   * a package is twenty minutes of connected decisions, and a rail of twenty
   * other destinations beside it is an invitation to lose the thread. The page
   * owning this mode provides its own way out.
   */
  focus?: boolean;
  children: React.ReactNode;
};

type NavLink = {
  labelKey: TranslationKey;
  href: string;
  /**
   * Small caption printed above this link inside a drawer, to keep the two big
   * sections readable: «قسم البيانات» carries seventeen links and «قسم الإدارة»
   * twenty, so they are grouped under the names the sections used to have rather
   * than listed as one wall of items.
   */
  captionKey?: TranslationKey;
  /** hides the link unless the role holds this permission. */
  perm?: Permission;
  /** hides the link unless this other route opens too (section-access.ts) — a page that lives under another section's gate. */
  alsoNeeds?: string;
};

export type NavGroup = {
  labelKey: TranslationKey;
  href: string;
  icon: LucideIcon;
  children?: NavLink[];
  /** hides a link-less section unless the role holds this permission; a section with links is decided by its links. */
  perm?: Permission;
};

/**
 * The single source of truth for what sections exist. Exported so the dashboard
 * can derive its «الأقسام السابقة» list from it — a hand-written second copy
 * would go stale the first time a route is added here.
 */
/**
 * Whether the sidebar is open, remembered across page loads. It opens only on a
 * click — an icon in the rail, or the arrow — and stays until the arrow folds it
 * back to the rail of icons. It used to slide out on hover and push the page
 * whenever the pointer crossed it (the owner, 2026-10-18: «عند مرور الماوس تفتح
 * وتسبب اشكالية … عند الضغط على اي مكان تبقى ثابتة»).
 *
 * useSyncExternalStore rather than the hydrate-in-an-effect the theme provider
 * uses: localStorage does not exist on the server, so that version renders the
 * wrong state once and React flags the mismatch. getServerSnapshot answers
 * "not pinned" for the server, and the first client read corrects it with no
 * extra render pass.
 */
const PIN_KEY = "tv.sidebar.pinned";
const PIN_EVENT = "tv:sidebar-pin";

function subscribePin(onChange: () => void) {
  // `storage` covers another tab; the custom event covers this one, which the
  // browser never notifies about its own writes.
  window.addEventListener("storage", onChange);
  window.addEventListener(PIN_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(PIN_EVENT, onChange);
  };
}

function readPin(): boolean {
  try {
    return window.localStorage.getItem(PIN_KEY) === "1";
  } catch {
    // private window, or site data blocked — an unpinned menu still works
    return false;
  }
}

function usePinnedSidebar(): [boolean, (next: boolean) => void] {
  const pinned = useSyncExternalStore(subscribePin, readPin, () => false);
  const setPinned = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(PIN_KEY, next ? "1" : "0");
    } catch {
      /* ignore — the pin just won't survive the next load */
    }
    window.dispatchEvent(new Event(PIN_EVENT));
  }, []);
  return [pinned, setPinned];
}

export const navGroups: NavGroup[] = [
  { labelKey: "nav.dashboard", href: "/dashboard", icon: BarChart3 },
  // «النظام بيسك» — the company's one-page entry, and since the owner's order of
  // 2026-10-17 the home of everything «البكجات السياحية» held: same routes, same
  // pages, only the menu moved. The doing comes first, then what to do it from,
  // then what came out of it; the legacy generator last, and only while the
  // developer has it switched on (features.ts legacy_generator — its pages send
  // staff to the same draft in /basic when it is off).
  {
    labelKey: "nav.basic",
    href: "/basic",
    icon: Zap,
    children: [
      // straight into a new file (the owner, 2026-10-25: «عندما يضغط على بكج جديد مباشرة يدخله على نظام البكج»)
      { labelKey: "nav.newPackage", href: "/basic?new=1", perm: "offers.write" },
      // the issued files, to review and edit (the owner, 2026-10-25: «اضف ايضا العروض المرسلة كي يمكن الموظف ان
      // يراجع العروض ويعدلها»)
      { labelKey: "nav.sentOffers", href: "/basic?files=issued", perm: "offers.write" },
      { labelKey: "nav.readyOffers", href: "/ready-offers", perm: "offers.write" },
      // confirmed clients from before the system, by hand — no offer (the user, 2026-10-22)
      { labelKey: "nav.externalTrips", href: "/confirmed-trips", perm: "offers.write" },
      // the offers by stage; the issued list and the supplier-PDF redesign live on /basic itself (the user, 2026-10-23)
      { labelKey: "nav.kanban", href: "/kanban-board" },
      // their buttons sat on /basic's home, which «بكج جديد» now skips (the owner, 2026-10-25: «اعادة تصميم تذكرة
      // الطيران، اعادة تصميم بكج مورد — لم تظهر في القائمة؟»); each follows its own switch (features.ts)
      { labelKey: "nav.repackage", href: "/repackage", perm: "repackage.write" },
      { labelKey: "nav.flightCard", href: "/repackage/flight-card", perm: "repackage.write" },
      { labelKey: "nav.legacyGenerator", href: "/package-generator", perm: "offers.write" },
    ],
  },
  // «العملاء» — every client conversation (the sheet pulled in), for every employee
  { labelKey: "nav.customers", href: "/clients", icon: Users },
  // «متابعتي»: each seller's own conversations to follow today (the owner, 2026-10-25)
  { labelKey: "nav.myFollowups", href: "/my-followups", icon: UserRound },
  { labelKey: "nav.followups", href: "/followups", icon: Users },
  // «سكرتيري الخاص» — each employee's own assistant (secretary/*); open to every signed-in employee
  { labelKey: "nav.secretary", href: "/secretary", icon: BotMessageSquare },
  // «التأشيرات» — the visa department's files and board (the owner, 2026-10-26). The price list stays under «البيانات»
  // and is linked here too, but only to whoever opens the board: its own gate (data.write) alone would show sales a
  // «التأشيرات» section holding that one link.
  {
    labelKey: "nav.visaFiles",
    href: "/visa-files",
    icon: Stamp,
    children: [
      { labelKey: "nav.visaBoard", href: "/visa-files" },
      { labelKey: "nav.visaNew", href: "/visa-files/new" },
      { labelKey: "nav.visaCatalogue", href: "/visas", alsoNeeds: "/visa-files" },
    ],
  },
  { labelKey: "nav.partnerCompanies", href: "/partner-companies", icon: Building2 },
  // «المطار»: a transport-only partner's bookings (section-access.ts)
  { labelKey: "nav.almatar", href: "/almatar-bookings", icon: Car },
  // Operations stays at the top level on purpose: it is the screen an ops agent
  // lives in all day. No `perm` of its own — section-access.ts opens it to
  // operations.write (every file) or operations.own (the files you issued).
  { labelKey: "nav.operations", href: "/operations", icon: ClipboardCheck },
  // «العمولات» — each employee's own commission; the month and the policy inside (section-access.ts)
  { labelKey: "nav.commissions", href: "/commissions", icon: BadgePercent },

  // ---------- «قسم البيانات» — the reference tables the generator reads ----------
  // Fifty links of «البيانات» and «الإدارة» down to eighteen (the owner, 2026-10-19):
  // merged pages hold the rest as tabs (lib/nav/consolidated.ts TAB_GROUPS), and a
  // page that went sends its old link where it went (movedTo). No table dropped.
  {
    labelKey: "nav.dataSection",
    href: "/hotels",
    icon: Database,
    // grouped under captions (the owner, 2026-10-26: «قسم البيانات يحتاج تنظيم») — the same links, by what they are about
    children: [
      // a country, a city or a service — what the data holds for it, each figure a link (2026-10-22)
      { labelKey: "nav.dataSearch", href: "/data-search", captionKey: "nav.dataCap.find" },
      // «جودة البيانات» + «مراجعة الأسعار»
      { labelKey: "nav.dataReview", href: "/data-quality" },
      { labelKey: "nav.countries", href: "/countries", captionKey: "nav.dataCap.places" },
      { labelKey: "nav.cities", href: "/cities" },
      { labelKey: "nav.hotels", href: "/hotels" },
      { labelKey: "nav.climate", href: "/setting/climate" },
      { labelKey: "nav.airlines", href: "/airlines", captionKey: "nav.dataCap.air" },
      { labelKey: "nav.airports", href: "/airports" },
      { labelKey: "nav.carTypes", href: "/cars-types", captionKey: "nav.dataCap.transport" },
      // the step-by-step price screen (the owner's transport details order, 2026-10-26)
      { labelKey: "nav.transportPrices", href: "/transport-prices" },
      // the transfers, the tours and the grid they are typed in
      { labelKey: "nav.transfersTours", href: "/cars/transfers" },
      { labelKey: "nav.tourPrograms", href: "/tour-programs" },
      // the service types and the services by country
      { labelKey: "nav.services", href: "/services-types", captionKey: "nav.dataCap.services" },
      { labelKey: "nav.visas", href: "/visas" },
      { labelKey: "nav.companySuppliers", href: "/company-suppliers", captionKey: "nav.dataCap.company" },
      // «يشمل», «لا يشمل» and the terms — one table, by kind
      { labelKey: "nav.termsIncludes", href: "/offers/offer-includes" },
    ],
  },

  // ---------- «قسم الإدارة» — the team, the profit policy, what the client is sent, the guide ----------
  {
    labelKey: "nav.adminSection",
    href: "/employees",
    icon: Settings2,
    children: [
      // the record, the logins and the roles
      { labelKey: "nav.employees", href: "/employees" },
      // the policy and the markup rules
      { labelKey: "nav.profitPolicy", href: "/settings/pricing" },
      { labelKey: "nav.clientComms", href: "/settings/client-comms" },
      // the office screens and their monitor (the owner, 2026-10-19)
      { labelKey: "nav.screens", href: "/settings/screens" },
      // when Teletel conversations close on their own, and who closed what (the user, 2026-10-22)
      { labelKey: "nav.conversations", href: "/settings/conversations" },
      { labelKey: "nav.guide", href: "/web-guide" },
    ],
  },

  // «SLA» — how long Teletel conversations wait, and «المتابعة» (dashboard.admin / developer.access, section-access.ts)
  { labelKey: "nav.sla", href: "/sla", icon: Timer },
  // «المطوّر» — the service switches and the external links' health (developer.access, section-access.ts)
  { labelKey: "nav.managementDecisions", href: "/management-decisions", icon: Gavel },
  { labelKey: "nav.developer", href: "/developer", icon: Wrench },
];

/**
 * What a partner company sees instead.
 *
 * Not a filtered version of ours — a different job. They issue packages and
 * look at their own numbers; they do not maintain our reference tables, run
 * our operations, or administer our people. «إعادة تصميم بكج مورّد» is absent
 * for the same reason: it exists to take a supplier's PDF apart, which is our
 * work, not theirs.
 *
 * Every route here is one the database already scopes to their company, so the
 * menu and the policies say the same thing.
 */
export const partnerNavGroups: NavGroup[] = [
  { labelKey: "nav.dashboard", href: "/b2b", icon: BarChart3 },
  {
    labelKey: "nav.issuePackage",
    href: "/package-generator",
    icon: FileText,
    children: [
      { labelKey: "nav.myFiles", href: "/package-generator" },
      { labelKey: "nav.newPackage", href: "/basic?new=1" },
      { labelKey: "nav.readyOffers", href: "/ready-offers" },
    ],
  },
  { labelKey: "nav.myCustomers", href: "/b2b/customers", icon: Users },
  { labelKey: "nav.myProfile", href: "/b2b/profile", icon: Building2 },
];

/**
 * The menu this session should see: a partner's own, or ours filtered by what
 * the role holds. One hook so the rail, the drawer and the mobile sheet cannot
 * disagree about which sections exist.
 */
function useNavGroups(): NavGroup[] {
  const partner = usePartnerBrand();
  const opens = useCanOpen();
  // a partner's own menu goes through the same filter: a service the developer
  // switched off (ready offers…) leaves their menu too — but never «ملفاتي»
  return filterGroups(partner ? partnerNavGroups : navGroups, opens);
}

/**
 * Our sections, and the links inside them, that this permission check (and, when given, these
 * service switches) opens. A link's own `perm`, the route's section (section-access.ts — the same
 * list the pages refuse by) and its service must all pass, so «قسم الإدارة», the settings, the team
 * and a switched-off service vanish for whoever cannot open them. A section left empty goes.
 */
export function navGroupsFor(can: (permission: Permission) => boolean, featureOn?: FeatureCheck): NavGroup[] {
  return filterGroups(navGroups, (link) => canOpenLink(link, can, featureOn));
}

function filterGroups(groups: NavGroup[], openRaw: (link: { href: string; perm?: Permission }) => boolean): NavGroup[] {
  // a link to a merged page opens for whoever can open any of its tabs, and lands on their first one
  // («المطوّر» for an admin without developer.access: the hotel suppliers' vault — the walk of 94c84a7)
  const land = <T extends { href: string; perm?: Permission; alsoNeeds?: string }>(link: T): T | null => {
    if (link.alsoNeeds && !openRaw({ href: link.alsoNeeds })) return null;
    if (openRaw(link)) return link;
    const tab = TAB_GROUPS.find((g) => g.some((t) => t.href === link.href))?.find((t) => openRaw({ href: t.href }));
    return tab && !link.perm ? { ...link, href: tab.href } : null;
  };
  const opens = (link: { href: string; perm?: Permission; alsoNeeds?: string }) => land(link) !== null;
  return groups.flatMap((group) => {
    if (!group.children) {
      const landed = land(group);
      return landed ? [landed] : [];
    }
    // a hidden link's caption heads the next shown one, so a block whose first
    // link is closed (the supplier vault, for sales) keeps its heading
    const children: NavLink[] = [];
    let caption: TranslationKey | undefined;
    for (const child of group.children) {
      if (!opens(child)) {
        caption = child.captionKey ?? caption;
        continue;
      }
      const landed = land(child) ?? child;
      children.push(caption && !landed.captionKey ? { ...landed, captionKey: caption } : landed);
      caption = undefined;
    }
    if (children.length === 0) return [];
    // A section's own link goes where its first open link does when its home is
    // closed to this user: ops hold the kanban but not «بيسك» (offers.write), and
    // the mobile menu draws a section as that one link.
    const href = children.some((child) => child.href === group.href) ? group.href : children[0].href;
    return [{ ...group, href, children }];
  });
}

/**
 * The mark in the corner: their logo, or ours.
 *
 * A partner is approved before a logo is uploaded, so the no-logo case is the
 * normal first day rather than an error — it falls back to the first letter of
 * the company name instead of a broken image.
 */
function BrandMark({
  logoUrl,
  name,
  className,
  dark = false,
}: {
  logoUrl: string | null;
  name: string;
  className?: string;
  dark?: boolean;
}) {
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage URL, no loader
    return <img src={logoUrl} alt={name} className={cn("object-contain", className)} />;
  }
  if (name === "Traveliun") {
    // eslint-disable-next-line @next/next/no-img-element -- static asset
    return <img src="/traveliun/logo-en.svg" alt="Traveliun" className={cn("object-contain brightness-0 invert", className)} />;
  }
  return (
    <span
      className={cn(
        "flex items-center justify-center rounded-[10px] text-lg font-extrabold",
        dark ? "bg-[var(--tv-brand)] text-white" : "bg-white/15 text-white",
        className,
      )}
    >
      {name.trim().charAt(0)}
    </span>
  );
}

/** a link's page without its query («/basic?new=1» is /basic) */
const pageOf = (href: string) => href.split("?")[0];

function isGroupActive(pathname: string, group: NavGroup) {
  if (pathname === group.href) return true;
  return group.children?.some((child) => pathname === pageOf(child.href) || pathname.startsWith(`${pageOf(child.href)}/`)) ?? false;
}

/** module scope, not state: the first click navigates to /developer and remounts the shell, the count must survive it.
 * Counted by hand, not e.detail — a phone's taps never reach detail 3. */
let developerClicks: number[] = [];
/** «المطوّر» and its tabs: where the lock shows */
const DEVELOPER_PAGES = ["/developer", "/settings/integrations"];
function countDeveloperClick(): boolean {
  const now = Date.now();
  developerClicks = [...developerClicks.filter((t) => now - t < 1500), now];
  if (developerClicks.length < 3) return false;
  developerClicks = [];
  return true;
}

export function TraveliunShell({ title, focus = false, children }: TraveliunShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  // «الحسابات المالية» has no menu link: three clicks on the lock at the top of «المطوّر»'s pages, or on its menu item,
  // open it (the owner, 2026-10-24: «بالاعلى ضع زر قفل نضغط عليه 3 مرات»); the page checks developer.access itself
  const openFinance = (e: React.MouseEvent) => {
    if (!countDeveloperClick()) return;
    e.preventDefault();
    router.push("/finance");
  };
  const onDeveloperPage = DEVELOPER_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = usePinnedSidebar();
  const [panel, setPanel] = useState<"guide" | "calculator" | "view" | "settings" | "profile" | null>(null);
  const { language, setLanguage, view, setView, theme, setTheme, dir, t } = useTraveliunUI();
  const partner = usePartnerBrand();
  const visibleNavGroups = useNavGroups();
  const opens = useCanOpen();
  const guideLinks = GUIDE_LINKS.filter(opens);
  // the open section — null: all folded (the owner, 2026-10-19: a second click on the open one closes it)
  const [activeMenu, setActiveMenu] = useState<TranslationKey | null>(() => {
    return visibleNavGroups.find((group) => isGroupActive(pathname, group))?.labelKey ?? visibleNavGroups[0].labelKey;
  });
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
    const matchingGroup = visibleNavGroups.find((group) => isGroupActive(pathname, group));

    if (matchingGroup) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing the active nav group to the URL is a legitimate route→state sync
      setActiveMenu(matchingGroup.labelKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- visibleNavGroups is a fresh array each render; the URL is the only thing that should re-run this
  }, [pathname]);

  // «فاتح النظام = متصل» (the owner, 2026-10-24): ANY open page beats presence,
  // not just the dashboard — the beat is what counts someone online for the
  // screens and for routing, whatever they set in Teletel.
  useEffect(() => {
    void touchPresence();
    const id = window.setInterval(() => void touchPresence(), 30_000);
    return () => window.clearInterval(id);
  }, []);

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

  const activeGroup = activeMenu ? (visibleNavGroups.find((group) => group.labelKey === activeMenu) ?? null) : null;
  const displayTitle = t(title);

  return (
    <DirectionProvider direction={dir}>
    <div className="tv-app min-h-screen bg-[#eef3f1] font-sans text-[#0f3d38]" dir={dir}>
      {/* «مُراد — سكرتيري الخاص»: floating on the WHOLE system (the owner, 2026-10-26), focus mode included; partners are outside companies and never see it */}
      {partner ? null : <SecretaryFab />}
      {focus ? null : (
      <div
        className={`fixed start-0 top-0 z-[90] hidden h-screen transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:block ${
          menuOpen ? "w-[260px]" : "w-[74px]"
        }`}
      >
        <button
          type="button"
          className="absolute -end-4 top-5 z-[120] flex size-8 items-center justify-center rounded-full border border-[#dce3df] bg-white text-[var(--tv-brand)] shadow-[0_2px_8px_rgba(24,80,69,0.16)] transition-colors duration-200 hover:bg-[#f4f8f6]"
          aria-expanded={menuOpen}
          title={menuOpen ? t("aria.unpinSidebar") : t("aria.pinSidebar")}
          aria-label={menuOpen ? t("aria.unpinSidebar") : t("aria.pinSidebar")}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {/* points the way the menu will move: in when open, out when folded */}
          <ChevronLeft className={cn("size-4 transition-transform rtl:-scale-x-100", menuOpen ? "" : "rotate-180")} />
        </button>

        <aside className="absolute start-0 top-0 z-10 h-screen w-[74px] border-e border-[#c8d2cd] bg-white">
          <Link href={partner ? "/b2b" : "/dashboard"} className="flex h-[74px] items-center justify-center bg-[var(--tv-brand)]">
            <BrandMark
              logoUrl={partner?.logoUrl ?? null}
              name={partner?.name ?? "Traveliun"}
              className="h-12 w-12"
            />
          </Link>
          <nav className="flex max-h-[calc(100vh/var(--tv-zoom)_-_74px)] flex-col overflow-hidden py-2">
            {visibleNavGroups.map((group) => {
              const Icon = group.icon;
              const active = isGroupActive(pathname, group);
              return (
                <button
                  key={group.labelKey}
                  type="button"
                  title={t(group.labelKey)}
                  className={`relative flex h-[44px] items-center justify-center transition-colors duration-200 ${
                    active ? "bg-[#eef4f1] font-extrabold text-[var(--tv-brand)]" : "text-[#6f8f88] hover:bg-[#f4f8f6] hover:text-[var(--tv-brand)]"
                  }`}
                  onClick={() => {
                    setActiveMenu(group.labelKey);
                    setMenuOpen(true);
                  }}
                >
                  <span
                    className={`absolute end-0 top-1/2 w-[3px] -translate-y-1/2 rounded-s-[3px] bg-[var(--tv-brand)] transition-[height] duration-150 ${
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
          />
        ) : null}
      </div>
      )}

      {focus ? null : (
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
        {onDeveloperPage ? (
          <button type="button" onClick={openFinance} aria-label="قفل" className="flex size-9 shrink-0 touch-manipulation select-none items-center justify-center rounded-md text-[#557d78] hover:bg-[#eef4f1]">
            <Lock className="size-5" />
          </button>
        ) : null}
        <div title={t("notice.trial")} className="hidden shrink-0 items-center gap-1.5 rounded-full border border-[#f2e2b4] bg-[#fff8e8] px-3 py-1.5 text-[#a86a10] lg:flex">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="text-[12px] font-bold leading-tight">{t("notice.trialShort")}</span>
        </div>
        <div className="flex-1" />
        <div className="flex shrink-0 items-center gap-3">
          {/* what you reach for first: the quick search and the bell */}
          <div className="flex items-center gap-1.5">
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

          {/* «مركز الإشعارات»: the bell and its unread count (notifications/NotificationBell.tsx) */}
          {partner ? null : <NotificationBell />}
          </div>
          {/* the guide, the calculator and the table view are our tools, together — a partner keeps settings and account */}
          {partner ? null : (
          <div className="hidden items-center gap-0.5 rounded-[12px] border border-[#e4ece8] bg-[#f7faf9] p-0.5 sm:flex">
          {guideLinks.length > 0 ? (
          <div className="hidden sm:block">
            <Popover open={panel === "guide"} onOpenChange={(o) => setPanel(o ? "guide" : null)}>
              <PopoverTrigger render={<HeaderIcon label={t("header.guide")} icon={NotebookText} active={panel === "guide"} />} />
              <PopoverContent className="w-[min(300px,calc(100vw/var(--tv-zoom)_-_24px))]">
                <GuidePanel links={guideLinks} close={() => setPanel(null)} />
              </PopoverContent>
            </Popover>
          </div>
          ) : null}

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
              <PopoverContent className="w-[min(300px,calc(100vw/var(--tv-zoom)_-_24px))]">
                <ViewPanel view={view} setView={setView} close={() => setPanel(null)} />
              </PopoverContent>
            </Popover>
          </div>
          </div>
          )}
          {/* the settings and the account, set apart at the edge */}
          <div className="flex items-center gap-1 border-s border-[#e4ece8] ps-3">
          <Popover open={panel === "settings"} onOpenChange={(o) => setPanel(o ? "settings" : null)}>
            <PopoverTrigger render={<HeaderIcon label={t("settings")} icon={Settings} active={panel === "settings"} />} />
            <PopoverContent className="w-[min(320px,calc(100vw/var(--tv-zoom)_-_24px))]">
              <SettingsPanel language={language} setLanguage={setLanguage} theme={theme} setTheme={setTheme} close={() => setPanel(null)} />
            </PopoverContent>
          </Popover>

          <Popover open={panel === "profile"} onOpenChange={(o) => setPanel(o ? "profile" : null)}>
            <PopoverTrigger render={<HeaderIcon label={t("account")} icon={UserCircle} muted active={panel === "profile"} />} />
            <PopoverContent className="w-[min(320px,calc(100vw/var(--tv-zoom)_-_24px))]">
              <ProfilePanel
                onChangePassword={() => {
                  setPanel(null);
                  setChangeOpen(true);
                }}
              />
            </PopoverContent>
          </Popover>
          </div>
        </div>
      </header>
      )}

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="inline-start" className="lg:hidden">
          <MobileMenu pathname={pathname} close={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <main
        className={
          focus
            ? ""
            : `pt-[60px] transition-[margin] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:pt-[74px] ${
                menuOpen ? "lg:ms-[260px]" : "lg:ms-[74px]"
              }`
        }
      >
        {/* bottom padding on phones clears the fixed tab bar (+ safe area). */}
        <div className="px-4 py-4 pb-[calc(84px+env(safe-area-inset-bottom))] sm:px-5 lg:px-[30px] lg:pb-4">
          <ViewAsBanner />
          <ServerLostBanner />
          <SectionTabs pathname={pathname} />
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
  // ⌘K searches the same menu the sidebar draws — otherwise a partner could jump
  // to a staff screen by typing its name.
  const paletteGroups = useNavGroups();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the search box when the palette closes
    if (!open) setQuery("");
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const seen = new Set<string>();
    const list: PaletteItem[] = [];
    for (const group of paletteGroups) {
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
  }, [paletteGroups]);

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
        <PaletteDialog.Popup className="tv-pop fixed left-1/2 top-[calc(12vh/var(--tv-zoom))] z-[170] h-fit w-[min(560px,calc(92vw/var(--tv-zoom)))] -translate-x-1/2 overflow-hidden rounded-2xl bg-white shadow-[0_24px_60px_rgba(0,40,36,0.4)] outline-none transition-[opacity,transform] duration-150 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 dark:bg-[#14231f]">
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
                  <span className="flex size-[34px] shrink-0 items-center justify-center rounded-[9px] bg-[#eff5f2] text-[var(--tv-brand)] dark:bg-[#1b2d27]">
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
}: {
  activeGroup: NavGroup | null;
  pathname: string;
  setActiveMenu: (key: TranslationKey | null) => void;
}) {
  const { t } = useTraveliunUI();
  const partner = usePartnerBrand();
  const groups = useNavGroups();
  const router = useRouter();
  const openFinance = (e: React.MouseEvent) => {
    if (!countDeveloperClick()) return;
    e.preventDefault();
    router.push("/finance");
  };
  return (
    <aside className="traveliun-side-menu absolute start-0 top-0 z-30 h-screen w-[260px] overflow-hidden border-e border-[#d9e0dc] bg-white shadow-[0_8px_28px_rgba(0,0,0,0.12)]">
      <div className="flex h-[96px] items-center justify-center bg-[var(--tv-brand)] px-6">
        <BrandMark
          logoUrl={partner?.logoUrl ?? null}
          name={partner?.name ?? "Traveliun"}
          className="max-h-[68px] w-[170px]"
        />
      </div>
      <nav className="h-[calc(100vh/var(--tv-zoom)_-_96px)] overflow-y-auto py-2 text-[var(--tv-brand)]">
        {groups.map((group) => {
          const Icon = group.icon;
          const active = group.labelKey === activeGroup?.labelKey;
          const hasChildren = Boolean(group.children?.length);
          return (
            <div key={group.labelKey}>
              {hasChildren ? (
                <button
                  type="button"
                  onClick={() => setActiveMenu(active ? null : group.labelKey)}
                  aria-expanded={active}
                  className={`flex w-full items-center gap-3 px-4 py-[11px] text-start text-[13px] font-bold transition-colors duration-200 ${
                    active ? "bg-[var(--tv-brand)] text-white" : "text-[var(--tv-brand)] hover:bg-[#eef4f1]"
                  }`}
                >
                  <Icon className="size-5" />
                  <span className="flex-1">{t(group.labelKey)}</span>{group.href === "/followups" && <FollowupBadge />}{group.href === "/my-followups" && <MyFollowupBadge />}
                  <ChevronDown className={`size-4 transition-transform duration-200 ${active ? "" : "rotate-90"}`} />
                </button>
              ) : (
                <Link
                  href={group.href}
                  onClick={group.href === "/developer" ? openFinance : undefined}
                  className={`flex w-full items-center gap-3 px-4 py-[11px] text-start text-[13px] font-bold transition-colors duration-200 ${
                    active ? "bg-[var(--tv-brand)] text-white" : "text-[var(--tv-brand)] hover:bg-[#eef4f1]"
                  }`}
                >
                  <Icon className="size-5" />
                  <span className="flex-1">{t(group.labelKey)}</span>{group.href === "/followups" && <FollowupBadge />}{group.href === "/my-followups" && <MyFollowupBadge />}
                  <ChevronDown className="size-4 rotate-90" />
                </Link>
              )}
              {active && group.children ? (
                <div className="py-1">
                  {group.children.map((child) => {
                    // «بكج جديد» makes a file and moves on — /basic itself is the files list, never «new»
                    const childActive = pathname === pageOf(child.href) && !child.href.includes("new=1");
                    return (
                      <div key={child.href}>
                      {child.captionKey ? (
                        <p className="mt-2 px-6 pb-1 text-[10.5px] font-extrabold uppercase tracking-[0.04em] text-[#9cafaa] first:mt-0">
                          {t(child.captionKey)}
                        </p>
                      ) : null}
                      <Link
                        key={child.href}
                        href={child.href}
                        className={`relative mx-[10px] block rounded-[7px] px-6 py-[10px] text-[13px] transition-colors duration-200 ${
                          childActive
                            ? "bg-[#eef4f1] font-extrabold text-[var(--tv-brand)]"
                            : "font-medium text-[#557d78] hover:bg-[#f4f8f6] hover:text-[var(--tv-brand)]"
                        }`}
                      >
                        <span
                          className={`absolute end-0 top-1/2 w-[3px] -translate-y-1/2 rounded-s-[3px] bg-[var(--tv-brand)] transition-[height] duration-150 ${
                            childActive ? "h-[18px]" : "h-0"
                          }`}
                        />
                        <span className="ms-2">•</span>
                        {t(child.labelKey)}
                      </Link>
                      </div>
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
  const partner = usePartnerBrand();
  const groups = useNavGroups();
  // the section the page belongs to starts open
  const [openKey, setOpenKey] = useState<string | null>(() => groups.find((g) => (g.children?.length ?? 0) > 1 && isGroupActive(pathname, g))?.labelKey ?? null);
  return (
    <>
      <div className="flex h-[76px] items-center justify-between border-b border-[#d9e0dc] px-5">
        {partner ? (
          <span className="flex items-center gap-2">
            <BrandMark logoUrl={partner.logoUrl} name={partner.name} className="size-9" dark />
            <span className="text-[13px] font-extrabold text-[var(--tv-brand)]">{partner.name}</span>
          </span>
        ) : (
          <TraveliunLogo />
        )}
        <button
          type="button"
          className="flex size-9 items-center justify-center rounded-md text-[var(--tv-brand)]"
          onClick={close}
          aria-label={t("aria.closeMenu")}
        >
          <X className="size-5" />
        </button>
      </div>
      {/* a section with pages opens as a list under its row (the owner, 2026-10-26: «الأقسام في الموبايل لا تظهر كاملة») —
          the bottom padding keeps the last row above the phone browser's toolbar */}
      <nav className="p-3 pb-28">
        {groups.map((group) => {
          const Icon = group.icon;
          const active = isGroupActive(pathname, group);
          const rowClass = `flex w-full items-center gap-3 rounded-md px-3 py-3 text-sm ${active ? "bg-[#e8f1ed] font-semibold text-[var(--tv-brand)]" : "text-[#557d78]"}`;
          const badges = <>{group.href === "/followups" && <FollowupBadge />}{group.href === "/my-followups" && <MyFollowupBadge />}</>;
          if (!group.children || group.children.length < 2) {
            return (
              <div key={group.labelKey} className="mb-1">
                <Link href={group.href} className={rowClass} onClick={close}>
                  <Icon className="size-5" />
                  <span>{t(group.labelKey)}</span>{badges}
                </Link>
              </div>
            );
          }
          const open = openKey === group.labelKey;
          return (
            <div key={group.labelKey} className="mb-1">
              <button type="button" className={rowClass} aria-expanded={open} onClick={() => setOpenKey(open ? null : group.labelKey)}>
                <Icon className="size-5" />
                <span className="flex-1 text-start">{t(group.labelKey)}</span>
                <ChevronDown className={`size-4 transition-transform duration-200 ${open ? "" : "rotate-90 rtl:-rotate-90"}`} />
              </button>
              {open ? (
                <div className="py-1">
                  {group.children.map((child) => {
                    const here = pathname === pageOf(child.href);
                    return (
                      <div key={child.href}>
                        {child.captionKey ? <p className="mt-2 px-6 pb-1 text-[10.5px] font-extrabold text-[#9cafaa]">{t(child.captionKey)}</p> : null}
                        <Link
                          href={child.href}
                          onClick={close}
                          className={`block rounded-md px-6 py-2.5 text-[13.5px] ${here ? "bg-[#eef4f1] font-extrabold text-[var(--tv-brand)]" : "font-medium text-[#557d78]"}`}
                        >
                          {t(child.labelKey)}
                        </Link>
                      </div>
                    );
                  })}
                </div>
              ) : null}
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
      title={label}
      className={cn(
        "flex size-10 items-center justify-center rounded-[10px] outline-none transition-colors hover:bg-[#eef4f1] focus-visible:ring-2 focus-visible:ring-[#b7d0c7]",
        active ? "bg-[#e8f1ed] text-[var(--tv-brand)]" : muted ? "rounded-full bg-[#e8f1ed] text-[var(--tv-brand)]" : "text-[var(--tv-brand)]",
        className,
      )}
      {...props}
    >
      <Icon className="size-[22px]" />
    </button>
  );
});

/** The header's guide shortcut — a «قسم الإدارة» page, so it shows only to whoever can open it. */
const GUIDE_LINKS: { labelKey: TranslationKey; href: string }[] = [{ labelKey: "nav.guide", href: "/web-guide" }];

function GuidePanel({ links, close }: { links: typeof GUIDE_LINKS; close: () => void }) {
  const { t } = useTraveliunUI();
  return (
    <div>
      <h3 className="mb-3 text-sm font-bold text-[var(--tv-brand)]">{t("guideTitle")}</h3>
      <div className="grid gap-2">
        {links.map(({ labelKey, href }) => (
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
      <h3 className="mb-3 text-sm font-bold text-[var(--tv-brand)]">{t("calcTitle")}</h3>
      {loading ? (
        <div className="tv-shimmer h-24 rounded-md" />
      ) : (
        <div className="space-y-3">
          <input
            type="number"
            dir="ltr"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="tv-tnum h-10 w-full rounded-md border border-[#ddd4d3] px-3 text-start text-sm outline-none focus:border-[var(--tv-brand)]"
          />
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <select value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 rounded-md border border-[#ddd4d3] bg-white px-2 text-sm outline-none">
              {codes.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
            <button
              type="button"
              onClick={() => { setFrom(to); setTo(from); }}
              className="flex size-8 items-center justify-center rounded-md border border-[#ddd4d3] text-[var(--tv-brand)] hover:bg-[#f4f8f6]"
              aria-label={t("aria.swap")}
            >
              ⇄
            </button>
            <select value={to} onChange={(e) => setTo(e.target.value)} className="h-10 rounded-md border border-[#ddd4d3] bg-white px-2 text-sm outline-none">
              {codes.map((c) => (<option key={c} value={c}>{c}</option>))}
            </select>
          </div>
          <div className="rounded-md bg-[#edf3f0] p-3 text-sm text-[var(--tv-brand)]">
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
      <h3 className="mb-3 text-sm font-bold text-[var(--tv-brand)] dark:text-[#d6e5df]">{t("view")}</h3>
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
              view === item ? "border-[var(--tv-brand)] bg-[var(--tv-brand)] text-white" : "border-[#dfe8e4] text-[#557d78]"
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
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-[var(--tv-brand)] dark:text-[#d6e5df]">
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

function ProfilePanel({ onChangePassword }: { onChangePassword: () => void }) {
  const router = useRouter();
  const { t } = useTraveliunUI();
  const { effectiveRole, viewAs } = useRole();
  const [email, setEmail] = useState<string>("");
  const [signingOut, setSigningOut] = useState(false);

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
      clearPendingDrafts();
      await createSupabaseBrowserClient().auth.signOut();
    } catch {
      /* ignore — clear client state regardless */
    }
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <div>
      <div className="mb-4 flex w-full items-center gap-3 px-1 py-1">
        <UserCircle className="size-10 text-[#b2b7bc]" />
        <div className="min-w-0 flex-1">
          {/* while looking through another role, the label says which */}
          <p className="font-bold text-[var(--tv-brand)]">{t("account")} · {viewAs ? viewAs.name : t(ROLE_LABEL_KEYS[effectiveRole])}</p>
          <p dir="ltr" className="truncate text-start text-xs text-[#8ba09b]">{email || "—"}</p>
        </div>
      </div>

      <ViewAsSwitcher />

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
        className="flex w-full items-center justify-center gap-2 rounded-md bg-[var(--tv-brand)] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0f4439] disabled:opacity-70"
      >
        {signingOut ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
        {signingOut ? t("signingOut") : t("signOut")}
      </button>
    </div>
  );
}

function panelButton(active: boolean) {
  return `rounded-md border px-3 py-2 text-sm font-semibold ${
    active ? "border-[var(--tv-brand)] bg-[var(--tv-brand)] text-white" : "border-[#dfe8e4] text-[#557d78]"
  }`;
}

/**
 * A call to the server failed — almost always a new version deployed while this
 * page was open. Said once, plainly: nothing typed is lost, reload and send again.
 */
function ServerLostBanner() {
  const { t } = useTraveliunUI();
  const [lost, setLost] = useState(false);
  useEffect(() => {
    const on = () => setLost(true);
    window.addEventListener(SERVER_LOST_EVENT, on);
    return () => window.removeEventListener(SERVER_LOST_EVENT, on);
  }, []);
  if (!lost) return null;
  return (
    <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 rounded-[12px] border border-[#f2d39a] bg-[#fff8e8] px-3 py-2 text-[12.5px] font-bold text-[#8a5a0c]">
      <span className="min-w-0 flex-1">{t("shell.serverLost")}</span>
      <button type="button" onClick={() => window.location.reload()} className="inline-flex h-8 items-center rounded-[8px] bg-[#8a5a0c] px-3 text-[12px] font-bold text-white">
        {t("shell.reload")}
      </button>
    </div>
  );
}
