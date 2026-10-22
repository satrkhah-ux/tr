import { redirect } from "next/navigation";
import { ExternalTripsBoard } from "@/components/traveliun/basic/ExternalTripsBoard";
import { listExternalTrips } from "@/lib/data/external-trips";
import { guardPath } from "@/lib/roles/current";

export const dynamic = "force-dynamic";

/** «نظام البكجات ← المؤكدون خارج النظام» — confirmed clients from before the system, by hand (offers.write). */
export default async function ConfirmedTripsPage() {
  await guardPath("/confirmed-trips");
  const data = await listExternalTrips();
  if (!data) redirect("/dashboard");
  return <ExternalTripsBoard initial={data} />;
}
