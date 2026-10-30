import { redirect } from "next/navigation";
import { SupplierAccountsList } from "@/components/traveliun/operations/SupplierAccount";
import { listSupplierAccounts } from "@/lib/data/supplier-work";
import { currentCan } from "@/lib/roles/current";

export const dynamic = "force-dynamic";

/** «الموردون» in «الحسابات» — the same suppliers' accounts as /operations/suppliers, for finance.accounts. */
export default async function AccountsSuppliersPage() {
  if (!(await currentCan("finance.accounts"))) redirect("/dashboard");
  const [list, canManage] = await Promise.all([listSupplierAccounts(), currentCan("settings.manage")]);
  if (!list) redirect("/dashboard");
  return <SupplierAccountsList suppliers={list.suppliers} replyHours={list.replyHours} canManage={canManage} base="/accounts/suppliers" />;
}
