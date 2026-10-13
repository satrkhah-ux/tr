import { redirect } from "next/navigation";
import { PartnerProfile } from "@/components/traveliun/partners/PartnerProfile";
import { getPartnerSession } from "@/lib/partners/session";
import { describeTerms } from "@/lib/partners/pricing";
import { listMyTeam } from "@/lib/partners/registration";

export const dynamic = "force-dynamic";

export const metadata = { title: "الملف الشخصي — بوابة الشركات" };

/** «الملف الشخصي» — a partner only. Anyone else is sent back to the door. */
export default async function PartnerProfilePage() {
  const partner = await getPartnerSession();
  if (!partner) redirect("/b2b");

  // the team is the owner's to manage; a salesperson sees the company, not its logins
  const team = partner.role === "owner" ? await listMyTeam() : null;
  return <PartnerProfile email={partner.email} terms={describeTerms(partner.terms)} team={team} />;
}
