import { redirect } from "next/navigation";
import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { LoginsPanel } from "@/components/traveliun/logins/LoginsPanel";
import { listLogins } from "@/lib/logins/actions";

export const dynamic = "force-dynamic";

/** «حسابات الدخول» — every employee adds their own; the administration (logins.manage) sees all */
export default async function LoginsPage() {
  const data = await listLogins();
  if (!data) redirect("/sign-in");
  return <TraveliunShell title="nav.logins"><LoginsPanel {...data} /></TraveliunShell>;
}
