import type { Permission } from "./roles";

/**
 * Which permission opens which part of the app — the one list both the menus
 * (hide the link) and the pages (refuse the typed URL, current.ts guardPath)
 * read, so a section cannot be hidden in one place and open in the other.
 *
 * Anything not listed is open to every signed-in employee; the screen's own
 * gate (offers.write on the generator, repackage.write…) still applies.
 * «قسم البيانات» is settings.manage, not data.write, on purpose: sales keep
 * data.write because the generator and the customers/companies tables write
 * through the data engine with it — they just do not maintain the catalogue.
 */
const SECTIONS: readonly (readonly [prefix: string, permission: Permission])[] = [
  // «قسم البيانات» — the reference tables the generator reads
  ["/data-quality", "settings.manage"],
  ["/hotels", "settings.manage"],
  ["/rooms-types", "settings.manage"],
  ["/countries", "settings.manage"],
  ["/cities", "settings.manage"],
  ["/airlines", "settings.manage"],
  ["/airports", "settings.manage"],
  ["/ports", "settings.manage"],
  ["/cars-types", "settings.manage"],
  ["/cars", "settings.manage"],
  ["/price-grid", "settings.manage"],
  ["/tour-programs", "settings.manage"],
  ["/drivers", "settings.manage"],
  ["/services-types", "settings.manage"],
  ["/services", "settings.manage"],
  ["/visas-types", "settings.manage"],
  ["/visas", "settings.manage"],
  ["/company-suppliers", "settings.manage"],
  ["/markup-rules", "settings.manage"],
  ["/offers/offer-includes", "settings.manage"],
  ["/offers/offer-not-includes", "settings.manage"],
  ["/offers/terms-and-conditions", "settings.manage"],
  // the settings, under both of their historical prefixes
  ["/settings", "settings.manage"],
  ["/setting", "settings.manage"],
  // the team and its roles
  ["/employees", "employees.manage"],
  // «مركز التشغيل»
  ["/operations", "operations.write"],
];

/** The permission a path needs, or null when any employee may open it. Query and hash are ignored. */
export function permissionForPath(href: string): Permission | null {
  const path = href.split(/[?#]/)[0];
  return SECTIONS.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))?.[1] ?? null;
}

export function canOpenPath(href: string, can: (permission: Permission) => boolean): boolean {
  const permission = permissionForPath(href);
  return permission === null || can(permission);
}

/** A menu entry: its own `perm`, when it has one, and its route's section must both pass. */
export function canOpenLink(link: { href: string; perm?: Permission }, can: (permission: Permission) => boolean): boolean {
  return (!link.perm || can(link.perm)) && canOpenPath(link.href, can);
}
