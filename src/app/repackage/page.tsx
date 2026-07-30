import { redirect } from "next/navigation";
import { listRepackages } from "@/lib/data/repackage";
import { RepackageList } from "@/components/traveliun/repackage/RepackageList";
import { currentCan } from "@/lib/roles/current";

export default async function RepackagePage() {
  if (!await currentCan("repackage.write")) redirect("/dashboard");
  const imports = await listRepackages();
  return <RepackageList imports={imports} />;
}
