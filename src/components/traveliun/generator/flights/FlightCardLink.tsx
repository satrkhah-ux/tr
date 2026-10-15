"use client";

import Link from "next/link";
import { Plane } from "lucide-react";
import { usePartnerBrand } from "@/lib/partners/PartnerContext";
import { useRole } from "@/lib/roles/RoleContext";
import { useTraveliunUI } from "../../TraveliunUIProvider";

/**
 * «تصميم بطاقة الطيران» (/repackage/flight-card) in a new tab, beside the
 * flights — for staff with repackage.write, the page's own gate. Never for a
 * partner company: it uses the generator and Basic through the b2b portal.
 */
export function FlightCardLink({ className = "" }: { className?: string }) {
  const { t } = useTraveliunUI();
  const { can } = useRole();
  const partner = usePartnerBrand();
  if (partner || !can("repackage.write")) return null;
  return (
    <Link
      href="/repackage/flight-card"
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#cfe0d9] bg-white px-3 text-[12px] font-bold text-[#185045] hover:bg-[#f0f7f4] ${className}`}
    >
      <Plane className="size-3.5" />
      {t("fc.open")}
    </Link>
  );
}
