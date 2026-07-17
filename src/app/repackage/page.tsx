import { redirect } from "next/navigation";
import { listRepackages } from "@/lib/data/repackage";
import { getCurrentRole } from "@/lib/data/metrics";
import { can } from "@/lib/roles/roles";
import { RepackageList } from "@/components/traveliun/repackage/RepackageList";

export default async function RepackagePage() {
  const role = await getCurrentRole();
  if (!can(role, "repackage.write")) redirect("/dashboard");
  const imports = await listRepackages();
  return <RepackageList imports={imports} />;
}
