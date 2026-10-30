import { redirect } from "next/navigation";
import { DuesPage } from "@/components/traveliun/accounts/Dues";
import { getDues } from "@/lib/data/accounts";

export const dynamic = "force-dynamic";

/** «المستحقات» — when money is due, to suppliers and from clients, and what came in (the section's door; the loader checks). */
export default async function AccountsDuesPage() {
  const d = await getDues();
  if (!d) redirect("/dashboard");
  return <DuesPage d={d} />;
}
