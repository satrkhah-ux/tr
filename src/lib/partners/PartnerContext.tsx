"use client";

import { createContext, useContext } from "react";

/**
 * Who the shell is wearing.
 *
 * Resolved once on the server (the layout already knows the session) and handed
 * down, because the alternative is every client component asking the database
 * who it is drawing for. Null means staff or nobody — the normal case, and the
 * one the shell has always drawn.
 */
export type PartnerBrand = {
  name: string;
  nameLatin: string | null;
  logoUrl: string | null;
  brandColor: string;
  accentColor: string;
  address: string | null;
};

const PartnerContext = createContext<PartnerBrand | null>(null);

export function PartnerProvider({
  brand,
  children,
}: {
  brand: PartnerBrand | null;
  children: React.ReactNode;
}) {
  return <PartnerContext.Provider value={brand}>{children}</PartnerContext.Provider>;
}

/** The signed-in partner company, or null for staff. */
export function usePartnerBrand(): PartnerBrand | null {
  return useContext(PartnerContext);
}
