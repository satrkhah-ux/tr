import { notFound, redirect } from "next/navigation";
import { SupplierAccountView } from "@/components/traveliun/operations/SupplierAccount";
import { getSupplierAccount } from "@/lib/data/supplier-work";
import { gateManager } from "@/lib/operations/access";

export const dynamic = "force-dynamic";

/** One supplier's account. Money: pricing.internal (the loader checks). */
export default async function SupplierAccountPage({ params }: { params: Promise<{ id: string }> }) {
  // the reports across every case are the manager's: an own-files holder goes back to their board
  if (await gateManager()) redirect("/operations");
  const { id } = await params;
  const account = await getSupplierAccount(id);
  if (!account) notFound();
  return <SupplierAccountView account={account} />;
}
