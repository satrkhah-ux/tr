import { redirect } from "next/navigation";
import { PartnerCustomers } from "@/components/traveliun/partners/PartnerCustomers";
import { listPartnerCustomers } from "@/lib/partners/customers";
import { getPartnerSession } from "@/lib/partners/session";

export const dynamic = "force-dynamic";

export const metadata = { title: "عملائي — بوابة الشركات" };

/** «عملائي» — a partner only. Anyone else is sent back to the door. */
export default async function PartnerCustomersPage() {
  if (!(await getPartnerSession())) redirect("/b2b");
  return <PartnerCustomers customers={await listPartnerCustomers()} />;
}
