import { notFound } from "next/navigation";
import { InvoicePage } from "@/components/traveliun/accounts/Invoices";
import { getInvoice } from "@/lib/data/accounts";

export const dynamic = "force-dynamic";

/** One internal invoice (finance.accounts; the loader checks). */
export default async function InvoiceRoute({ params }: { params: Promise<{ id: string }> }) {
  const inv = await getInvoice((await params).id);
  if (!inv) notFound();
  return <InvoicePage inv={inv} />;
}
