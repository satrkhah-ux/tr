"use client";

import { usePartnerBrand } from "@/lib/partners/PartnerContext";
import { useRole } from "./RoleContext";
import type { Permission } from "./roles";
import { canOpenLink, partnerFeatures } from "./section-access";

/**
 * section-access.ts canOpenLink with this session's permissions and switches —
 * what the menus, the mobile tab bar, ⌘K and every shortcut list filter by, so
 * a link shows exactly when its page (guardPath) would open.
 */
export function useCanOpen(): (link: { href: string; perm?: Permission }) => boolean {
  const { can, featureOn } = useRole();
  const partner = usePartnerBrand();
  const features = partner ? partnerFeatures(featureOn) : featureOn;
  return (link) => canOpenLink(link, can, features);
}
