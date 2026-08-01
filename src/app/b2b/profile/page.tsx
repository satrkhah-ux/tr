import { redirect } from "next/navigation";
import { PartnerProfile } from "@/components/traveliun/partners/PartnerProfile";
import { getPartnerSession } from "@/lib/partners/session";
import { describeTerms } from "@/lib/partners/pricing";

export const dynamic = "force-dynamic";

export const metadata = { title: "الملف الشخصي — بوابة الشركات" };

/** «الملف الشخصي» — a partner only. Anyone else is sent back to the door. */
export default async function PartnerProfilePage() {
  const partner = await getPartnerSession();
  if (!partner) redirect("/b2b");

  return <PartnerProfile email={partner.email} terms={describeTerms(partner.terms)} />;
}
