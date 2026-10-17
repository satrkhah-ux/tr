import { notFound, redirect } from "next/navigation";
import { SupplierAccountsList } from "@/components/traveliun/operations/SupplierAccount";
import { listSupplierAccounts } from "@/lib/data/supplier-work";
import { currentCan } from "@/lib/roles/current";
import { gateManager } from "@/lib/operations/access";

export const dynamic = "force-dynamic";

/** «حسابات الموردين» — what we owe each supplier. Money: pricing.internal (the loader checks). */
export default async function SupplierAccountsPage() {
  // the reports across every case are the manager's: an own-files holder goes back to their board
  if (await gateManager()) redirect("/operations");
  const [list, canManage] = await Promise.all([listSupplierAccounts(), currentCan("settings.manage")]);
  if (!list) notFound();
  return <SupplierAccountsList suppliers={list.suppliers} replyHours={list.replyHours} canManage={canManage} />;
}
