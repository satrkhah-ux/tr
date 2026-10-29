import { redirect } from "next/navigation";
import { ProfitSettingsAdmin } from "@/components/traveliun/ProfitSettingsAdmin";
import { getPaymentFees, getProfitSettings, getSettlementRule, getUsdRate } from "@/lib/data/app-settings";
import { currentCan } from "@/lib/roles/current";

/** Admin-only: who puts the profit on a package, and the margin a file starts with. */
export default async function ProfitSettingsPage() {
  if (!(await currentCan("settings.manage"))) redirect("/dashboard");
  const [initial, usd, fees, settlement] = await Promise.all([getProfitSettings(), getUsdRate(), getPaymentFees(), getSettlementRule()]);
  return <ProfitSettingsAdmin initial={initial} usd={usd} fees={fees} settlement={settlement} />;
}
