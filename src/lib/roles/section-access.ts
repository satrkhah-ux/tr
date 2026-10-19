import type { Permission } from "./roles";
import { featureForPath, type Feature } from "@/lib/features";

/**
 * Which permission opens which part of the app — the one list both the menus
 * (hide the link) and the pages (refuse the typed URL, current.ts guardPath)
 * read, so a section cannot be hidden in one place and open in the other.
 *
 * An entry names one permission or several, any of which opens it: «العمليات»
 * is every file for operations.write and the files you issued for
 * operations.own — the same screens, scoped inside.
 *
 * Anything not listed is open to every signed-in employee; the screen's own
 * gate (offers.write on the generator, repackage.write…) still applies.
 *
 * The owner's order of 2026-10-17: sales see «الرئيسية», «النظام بيسك»,
 * «العمليات» and «البيانات», nothing else. So «البيانات» is data.write — sales
 * view, add and edit the reference tables — while deleting, merging and
 * importing stay settings.manage inside those screens (data/actions.ts,
 * data/hotel-tools.ts, migration 0079). «قسم الإدارة» is settings.manage whole,
 * except the team, which stays employees.manage.
 *
 * First match wins, and a prefix is a whole path segment (/cars does not open
 * /cars-types), so the order only matters for a prefix inside another.
 */
const SECTIONS: readonly (readonly [prefix: string, permission: Permission | readonly Permission[]])[] = [
  // «البيانات» — the reference tables the generator reads
  ["/data-quality", "data.write"],
  ["/hotels", "data.write"],
  ["/rooms-types", "data.write"],
  ["/countries", "data.write"],
  ["/cities", "data.write"],
  ["/airlines", "data.write"],
  ["/airports", "data.write"],
  ["/ports", "data.write"],
  ["/cars-types", "data.write"],
  ["/cars", "data.write"],
  ["/price-grid", "data.write"],
  // «مراجعة الأسعار»: the provisional and missing prices, with who changed what
  ["/price-review", "data.write"],
  ["/tour-programs", "data.write"],
  ["/drivers", "data.write"],
  ["/services-types", "data.write"],
  ["/services", "data.write"],
  ["/visas-types", "data.write"],
  ["/visas", "data.write"],
  ["/company-suppliers", "data.write"],
  ["/offers/offer-includes", "data.write"],
  ["/offers/offer-not-includes", "data.write"],
  ["/offers/terms-and-conditions", "data.write"],
  // listed with the data, kept by the administration: the margin policy, and
  // the supplier credential vault (/settings/suppliers, under /settings below)
  ["/markup-rules", "settings.manage"],
  // the settings, under both of their historical prefixes — data transfer
  // (import / export of the whole catalogue) included
  ["/settings", "settings.manage"],
  ["/setting", "settings.manage"],
  // «قسم الإدارة» — clients, companies, customer care, the guide
  ["/customers", "settings.manage"],
  ["/companies", "settings.manage"],
  ["/companies-visits", "settings.manage"],
  ["/companies-visits-statuses", "settings.manage"],
  ["/customers_care", "settings.manage"],
  ["/customers-care", "settings.manage"],
  ["/web-guide", "settings.manage"],
  ["/guide", "settings.manage"],
  ["/partner-companies", "settings.manage"],
  // «حجوزات المطار» (0100): operations confirm, the administration sets the margin and the login
  ["/almatar-bookings", ["operations.write", "settings.manage"]],
  // «العملاء» (0107): a section like the others, so it can be taken from a role or a colleague
  ["/clients", "clients.view"],
  // the team and its roles
  ["/employees", "employees.manage"],
  // «مركز التشغيل الذكي»: company-wide revenue, conversion and average offer —
  // the executive dashboard's numbers, so the executive dashboard's permission
  ["/travel-intelligence", "dashboard.admin"],
  // «العمليات»: every file, or the files you issued
  // company-wide money and supplier accounts: every case, so all-files only —
  // listed before /operations, the first matching prefix wins
  ["/operations/cashflow", "operations.write"],
  ["/operations/profitability", "operations.write"],
  ["/operations/suppliers", "operations.write"],
  ["/operations", ["operations.write", "operations.own"]],
  // «العمولات» (0092): the month for everyone and its policy are the administration's;
  // «عمولتي» is each holder's own — listed before /commissions, the first match wins
  ["/commissions/cycles", ["commissions.manage", "commissions.approve"]],
  ["/commissions/policy", ["commissions.manage", "commissions.approve"]],
  ["/commissions", ["commissions.view", "commissions.manage", "commissions.approve"]],
  // «المطوّر»: service switches and external links' health
  ["/developer", "developer.access"],
  // «SLA»: the administration and the developer only (the owner, 2026-10-17);
  // a follow-up's own page (/followups) opens to its assignee too (data/sla.ts)
  ["/sla", ["dashboard.admin", "developer.access"]],
];

/** The permissions a path needs (any one opens it), or null when any employee may open it. Query and hash are ignored. */
export function permissionsForPath(href: string): readonly Permission[] | null {
  const path = href.split(/[?#]/)[0];
  const entry = SECTIONS.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))?.[1];
  if (entry === undefined) return null;
  return typeof entry === "string" ? [entry] : entry;
}

/**
 * Is this service switched on (features.ts)? Optional everywhere below: a
 * caller checking a path no service owns (/settings/suppliers…) need not pass it,
 * but a menu or a shortcut list must, or a switched-off service keeps its link.
 */
export type FeatureCheck = (feature: Feature) => boolean;

export function canOpenPath(href: string, can: (permission: Permission) => boolean, featureOn?: FeatureCheck): boolean {
  const feature = featureForPath(href);
  if (feature && featureOn && !featureOn(feature)) return false;
  const permissions = permissionsForPath(href);
  return permissions === null || permissions.some(can);
}

/** A menu entry: its own `perm`, when it has one, its route's section and its service must all pass. */
export function canOpenLink(
  link: { href: string; perm?: Permission },
  can: (permission: Permission) => boolean,
  featureOn?: FeatureCheck,
): boolean {
  return (!link.perm || can(link.perm)) && canOpenPath(link.href, can, featureOn);
}

/**
 * The switches as a partner company meets them. /package-generator is their
 * «ملفاتي», not our legacy generator, so turning the legacy generator off never
 * closes it for them (the pages say the same: app/package-generator).
 */
export function partnerFeatures(featureOn: FeatureCheck): FeatureCheck {
  return (feature) => feature === "legacy_generator" || featureOn(feature);
}
