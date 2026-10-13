import { notFound } from "next/navigation";
import { SupplierAccountView } from "@/components/traveliun/operations/SupplierAccount";
import { getSupplierAccount } from "@/lib/data/supplier-work";

export const dynamic = "force-dynamic";

/** One supplier's account. Money: pricing.internal (the loader checks). */
export default async function SupplierAccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const account = await getSupplierAccount(id);
  if (!account) notFound();
  return <SupplierAccountView account={account} />;
}
