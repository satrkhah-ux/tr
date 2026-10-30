import { notFound, redirect } from "next/navigation";
import { SupplierAccountView } from "@/components/traveliun/operations/SupplierAccount";
import { getSupplierAccount } from "@/lib/data/supplier-work";
import { currentCan } from "@/lib/roles/current";

export const dynamic = "force-dynamic";

/** One supplier's account in «الحسابات» — its bookings, payments and balance; pay it from here (finance.accounts). */
export default async function AccountsSupplierPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await currentCan("finance.accounts"))) redirect("/dashboard");
  const account = await getSupplierAccount((await params).id);
  if (!account) notFound();
  return <SupplierAccountView account={account} base="/accounts/suppliers" />;
}
