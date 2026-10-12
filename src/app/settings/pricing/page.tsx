import { redirect } from "next/navigation";
import { ProfitSettingsAdmin } from "@/components/traveliun/ProfitSettingsAdmin";
import { getProfitSettings } from "@/lib/data/app-settings";
import { currentCan } from "@/lib/roles/current";

/** Admin-only: who puts the profit on a package, and the margin a file starts with. */
export default async function ProfitSettingsPage() {
  if (!(await currentCan("settings.manage"))) redirect("/dashboard");
  return <ProfitSettingsAdmin initial={await getProfitSettings()} />;
}
