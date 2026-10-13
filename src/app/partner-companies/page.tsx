import { PartnerCompanies } from "@/components/traveliun/PartnerCompanies";
import { listPartnerCompanies } from "@/lib/data/partner-companies";
import { listTiers } from "@/lib/partners/tiers-admin";

export const dynamic = "force-dynamic";

export default async function PartnerCompaniesPage() {
  const [companies, defaultTiers] = await Promise.all([listPartnerCompanies(), listTiers(null)]);
  return <PartnerCompanies companies={companies} defaultTiers={defaultTiers} />;
}
