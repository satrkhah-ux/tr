/**
 * «قسم البيانات» and «قسم الإدارة» from fifty links to eighteen (the owner,
 * 2026-10-19). Nothing is dropped: a page that goes leaves the menu and its
 * route lands on the page that took its place; its table stays where it is
 * (backed up in data-import/backups/nav-consolidation-2026-10-19).
 *
 * Pure — the menu (TraveliunShell), the catch-all route and the tests read it.
 */

/**
 * Where an old link lands. A key ending in «/*» covers the route and
 * everything under it. The static pages here kept their edits in the browser
 * only (lost on reload, with made-up serials); the tables nothing else reads
 * (profits, statuses, supervisors, guide_informations, ports, drivers,
 * room_types, care_tickets) are kept, unlisted.
 */
const MOVED: Record<string, string> = {
  // static pages, nothing behind them
  "/cars": "/cars-types",
  "/visas-types": "/visas",
  "/companies": "/partner-companies",
  "/companies-visits/*": "/dashboard",
  "/companies-visits-statuses": "/dashboard",
  "/customers_care/*": "/clients",
  "/customers-care": "/clients",
  "/setting/statuses-groups": "/dashboard",
  "/setting/currencies": "/settings/pricing",
  "/settings": "/settings/pricing",
  "/setting/suppliers": "/company-suppliers",
  "/setting/suppliers-preferences": "/company-suppliers",
  "/guide/categories": "/web-guide",
  // tables nothing reads but their own page — the data stays
  "/setting/profits": "/settings/pricing",
  "/setting/statuses": "/dashboard",
  "/setting/supervisors": "/sla",
  "/guide/informations": "/web-guide",
  // /ports and /drivers rejoined the transport tabs (the owner's transport order, 2026-10-26)
  "/rooms-types": "/hotels",
};

/** The page an old route now lands on, or null when the route is current. */
export function movedTo(path: string): string | null {
  const route = path.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (MOVED[route]) return MOVED[route];
  for (const [key, to] of Object.entries(MOVED)) {
    if (key.endsWith("/*") && (route === key.slice(0, -2) || route.startsWith(key.slice(0, -1)))) return to;
  }
  return null;
}

export type SectionTab = { href: string; labelKey: string };

/**
 * Pages merged into one: a row of tabs over each of them, the menu holding
 * the first. Each tab is still its own route — an old link opens its tab.
 */
export const TAB_GROUPS: SectionTab[][] = [
  [
    { href: "/employees", labelKey: "nav.employees" },
    { href: "/employees/accounts", labelKey: "nav.employeeAccounts" },
    { href: "/employees/roles", labelKey: "nav.roles" },
  ],
  [
    { href: "/settings/pricing", labelKey: "nav.profitPolicy" },
    { href: "/markup-rules", labelKey: "nav.markupRules" },
  ],
  [
    { href: "/offers/offer-includes", labelKey: "nav.offerIncludes" },
    { href: "/offers/offer-not-includes", labelKey: "nav.offerExcludes" },
    { href: "/offers/terms-and-conditions", labelKey: "nav.terms" },
    { href: "/offers/payment-terms", labelKey: "nav.paymentTerms" },
    { href: "/offers/bank-accounts", labelKey: "nav.bankAccounts" },
  ],
  // «قسم المواصلات» as one family of tabs (the owner's transport order, 2026-10-26)
  [
    { href: "/transport-prices", labelKey: "nav.transportPrices" },
    { href: "/cars-types", labelKey: "nav.carTypes" },
    { href: "/cars-capacities", labelKey: "nav.carCapacities" },
    { href: "/cars/transfers", labelKey: "nav.transfers" },
    { href: "/cars/tours", labelKey: "nav.tours" },
    { href: "/tour-programs", labelKey: "nav.tourPrograms" },
    { href: "/drivers", labelKey: "nav.drivers" },
    { href: "/ports", labelKey: "nav.ports" },
    { href: "/price-grid", labelKey: "data.model.grid.title" },
  ],
  [
    { href: "/services-types", labelKey: "nav.serviceTypes" },
    { href: "/services", labelKey: "nav.servicesByCountry" },
  ],
  [
    { href: "/data-quality", labelKey: "data.quality.title" },
    { href: "/data-additions", labelKey: "nav.dataAdditions" },
    { href: "/price-review", labelKey: "nav.priceReview" },
  ],
  // «الأشخاص» (the issued files' clients) inside «العملاء» — each tab keeps its own gate
  [
    { href: "/clients", labelKey: "nav.customers" },
    { href: "/customers", labelKey: "nav.people" },
  ],
  // «التأشيرات»: the board and a new file, one tap apart on a phone (the price list keeps its own page under «البيانات»)
  [
    { href: "/visa-files", labelKey: "nav.visaBoard" },
    { href: "/visa-files/new", labelKey: "nav.visaNew" },
  ],
  // the flight-card tool sits beside the supplier-PDF redesign it serves
  [
    { href: "/repackage", labelKey: "nav.repackage" },
    { href: "/repackage/flight-card", labelKey: "fc.title" },
  ],
  // the hotel suppliers' API vault and the data transfer belong with the developer's tools
  [
    { href: "/developer", labelKey: "nav.developer" },
    // everything the system leans on outside itself, with its health and end dates (the owner, 2026-10-19)
    { href: "/settings/integrations", labelKey: "nav.integrations" },
    { href: "/settings/suppliers", labelKey: "nav.hotelSuppliers" },
    { href: "/settings/data-transfer", labelKey: "nav.dataTransfer" },
  ],
];

/** Pages that draw their own row — «العملاء» holds its analyses and «الأشخاص» in one (LeadsBoard). */
const OWN_TABS = new Set(["/clients"]);

/** The tabs over this page — the group whose tab matches it best — or null. */
export function tabsFor(pathname: string): { tabs: SectionTab[]; active: string } | null {
  if (OWN_TABS.has(pathname)) return null;
  let best: { tabs: SectionTab[]; active: string } | null = null;
  for (const tabs of TAB_GROUPS) {
    for (const tab of tabs) {
      if ((pathname === tab.href || pathname.startsWith(`${tab.href}/`)) && (!best || tab.href.length > best.active.length)) best = { tabs, active: tab.href };
    }
  }
  return best;
}
