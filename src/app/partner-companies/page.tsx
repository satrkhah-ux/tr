import { PartnerCompanies } from "@/components/traveliun/PartnerCompanies";
import { listPartnerCompanies } from "@/lib/data/partner-companies";

export const dynamic = "force-dynamic";

export default async function PartnerCompaniesPage() {
  const companies = await listPartnerCompanies();
  return <PartnerCompanies companies={companies} />;
}
