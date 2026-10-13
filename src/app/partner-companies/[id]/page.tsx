import { notFound } from "next/navigation";
import { PartnerCompanyDetailView } from "@/components/traveliun/partners/PartnerCompanyDetail";
import { getPartnerCompanyDetail } from "@/lib/data/partner-companies";

export const dynamic = "force-dynamic";

export default async function PartnerCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getPartnerCompanyDetail(id);
  if (!detail) notFound();
  return <PartnerCompanyDetailView detail={detail} />;
}
