import { redirect } from "next/navigation";
import { BasicHome } from "@/components/traveliun/basic/BasicHome";
import { listDrafts } from "@/lib/data/drafts";
import { currentCan } from "@/lib/roles/current";

/** «النظام بيسك» — the one-page entry over the same drafts as the package generator. */
export default async function BasicPage() {
  if (!(await currentCan("offers.write"))) redirect("/dashboard");
  return <BasicHome drafts={await listDrafts()} />;
}
