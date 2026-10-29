import { redirect } from "next/navigation";
import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { SecretsPanel } from "@/components/traveliun/developer/SecretsPanel";
import { listSecrets } from "@/lib/secrets/actions";
import { guardPath } from "@/lib/roles/current";

export const dynamic = "force-dynamic";

/** «المفاتيح والتوكنات» — «المطوّر» and the administration (section-access /developer/secrets) */
export default async function DeveloperSecretsPage() {
  await guardPath("/developer/secrets");
  const data = await listSecrets();
  if (!data) redirect("/dashboard");
  return <TraveliunShell title="nav.secrets"><SecretsPanel initial={data} /></TraveliunShell>;
}
