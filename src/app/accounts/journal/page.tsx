import { redirect } from "next/navigation";
import { JournalPage } from "@/components/traveliun/accounts/Stage4";
import { getJournal } from "@/lib/data/accounts";

export const dynamic = "force-dynamic";

/** «القيود اليومية» — the month's journal written from what the system records (finance.accounts; the loader checks). */
export default async function AccountsJournalPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const j = await getJournal((await searchParams).month);
  if (!j) redirect("/dashboard");
  return <JournalPage j={j} />;
}
