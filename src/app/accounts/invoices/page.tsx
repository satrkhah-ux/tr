import { redirect } from "next/navigation";
import { InvoicesList } from "@/components/traveliun/accounts/Invoices";
import { listInvoices } from "@/lib/data/accounts";

export const dynamic = "force-dynamic";

/** «الفواتير» — the internal invoices (finance.accounts; the loader checks). */
export default async function InvoicesPage() {
  const data = await listInvoices();
  if (!data) redirect("/dashboard");
  return <InvoicesList rows={data.rows} counts={data.counts} />;
}
