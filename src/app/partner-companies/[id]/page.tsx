import { notFound } from "next/navigation";
import { PartnerCompanyDetailView } from "@/components/traveliun/partners/PartnerCompanyDetail";
import { getPartnerCompanyDetail } from "@/lib/data/partner-companies";
import { getPartnerStatement } from "@/lib/partners/ledger";
import { listTiers } from "@/lib/partners/tiers-admin";

export const dynamic = "force-dynamic";

export default async function PartnerCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [detail, statement, tiers] = await Promise.all([getPartnerCompanyDetail(id), getPartnerStatement(id), listTiers(id)]);
  if (!detail) notFound();
  return <PartnerCompanyDetailView detail={detail} statement={statement} tiers={tiers} />;
}
