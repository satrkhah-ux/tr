import { redirect } from "next/navigation";
import { AccountsHome } from "@/components/traveliun/accounts/AccountsHome";
import { getAccountsHome } from "@/lib/data/accounts";

export const dynamic = "force-dynamic";

/** «الحسابات» — the financial section's home (finance.accounts; the loader checks). */
export default async function AccountsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const home = await getAccountsHome((await searchParams).month);
  if (!home) redirect("/dashboard");
  return <AccountsHome home={home} />;
}
