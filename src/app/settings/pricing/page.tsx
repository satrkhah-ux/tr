import { redirect } from "next/navigation";
import { ProfitSettingsAdmin } from "@/components/traveliun/ProfitSettingsAdmin";
import { getPaymentFees, getProfitSettings, getUsdRate } from "@/lib/data/app-settings";
import { currentCan } from "@/lib/roles/current";

/** Admin-only: who puts the profit on a package, and the margin a file starts with. */
export default async function ProfitSettingsPage() {
  if (!(await currentCan("settings.manage"))) redirect("/dashboard");
  const [initial, usd, fees] = await Promise.all([getProfitSettings(), getUsdRate(), getPaymentFees()]);
  return <ProfitSettingsAdmin initial={initial} usd={usd} fees={fees} />;
}
