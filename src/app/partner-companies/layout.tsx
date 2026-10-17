import { guardPath } from "@/lib/roles/current";

/** «الشركات المتعاونة» is the administration's (section-access.ts) — the list and each company. */
export default async function PartnerCompaniesLayout({ children }: { children: React.ReactNode }) {
  await guardPath("/partner-companies");
  return children;
}
