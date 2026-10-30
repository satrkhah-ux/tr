import { redirect } from "next/navigation";
import { QuotesPage } from "@/components/traveliun/accounts/Stage4";
import { listQuotes } from "@/lib/data/accounts";

export const dynamic = "force-dynamic";

/** «عروض الأسعار» — the offers as the sales pipeline in money (finance.accounts; the loader checks). */
export default async function AccountsQuotesPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const q = await listQuotes((await searchParams).month);
  if (!q) redirect("/dashboard");
  return <QuotesPage q={q} />;
}
