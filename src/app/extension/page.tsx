import { redirect } from "next/navigation";
import { ExtensionLinkPage } from "@/components/traveliun/extension/ExtensionLinkPage";
import { listMyExtensionLinks } from "@/lib/data/extension-links";
import { getCurrentEmployeeId } from "@/lib/data/metrics";
import { getPartnerSession } from "@/lib/partners/session";

/** «إضافة المتصفح» — link this browser's extension, see the linked devices, revoke one. Staff only. */
export default async function ExtensionPage() {
  if ((await getPartnerSession()) || !(await getCurrentEmployeeId())) redirect("/dashboard");
  return <ExtensionLinkPage initial={await listMyExtensionLinks()} />;
}
