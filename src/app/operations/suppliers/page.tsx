import { notFound } from "next/navigation";
import { SupplierAccountsList } from "@/components/traveliun/operations/SupplierAccount";
import { listSupplierAccounts } from "@/lib/data/supplier-work";
import { currentCan } from "@/lib/roles/current";

export const dynamic = "force-dynamic";

/** «حسابات الموردين» — what we owe each supplier. Money: pricing.internal (the loader checks). */
export default async function SupplierAccountsPage() {
  const [list, canManage] = await Promise.all([listSupplierAccounts(), currentCan("settings.manage")]);
  if (!list) notFound();
  return <SupplierAccountsList suppliers={list.suppliers} replyHours={list.replyHours} canManage={canManage} />;
}
