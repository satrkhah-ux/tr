import { notFound } from "next/navigation";
import { InvoicePrint } from "@/components/traveliun/accounts/InvoicePrint";
import { getInvoice } from "@/lib/data/accounts";

export const dynamic = "force-dynamic";

/** «المشاركة كـ PDF» — the invoice alone on an A4 page; the browser saves it as PDF (finance.accounts). */
export default async function InvoicePrintRoute({ params }: { params: Promise<{ id: string }> }) {
  const inv = await getInvoice((await params).id);
  if (!inv) notFound();
  return <InvoicePrint inv={inv} />;
}
