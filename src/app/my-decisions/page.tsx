import { redirect } from "next/navigation";
import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { MyDecisions } from "@/components/traveliun/decisions/MyDecisions";
import { getMyDecisions } from "@/lib/data/admin-decisions";

export const dynamic = "force-dynamic";

/** «قراراتي وخطاباتي» — every signed-in employee, their own only (the bell's «قرار إداري» opens it with ?d=<id>). */
export default async function MyDecisionsPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>;
}) {
  const { d } = await searchParams;
  const open = d && /^[0-9a-f-]{36}$/i.test(d) ? d : undefined;
  const view = await getMyDecisions(open);
  if (!view) redirect("/dashboard");
  return (
    <TraveliunShell title="nav.myDecisions">
      <MyDecisions name={view.name} items={view.items} open={open} />
    </TraveliunShell>
  );
}
