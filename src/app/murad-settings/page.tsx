import { redirect } from "next/navigation";
import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { MuradSettings } from "@/components/traveliun/settings/MuradSettings";
import { ReceptionRoutes } from "@/components/traveliun/operations/ReceptionRoutes";
import { getMuradControl } from "@/lib/data/murad-control";
import { AutoOffers } from "@/components/traveliun/operations/AutoOffers";
import { MuradPolicies } from "@/components/traveliun/operations/MuradPolicies";
import { getMuradPolicies, getReceptionSetup } from "@/lib/data/app-settings";

export default async function MuradSettingsPage() {
  const setup = await getMuradControl();
  if (!setup) redirect("/dashboard");
  const [reception, policies, visaFaq] = await Promise.all([getReceptionSetup(), getMuradPolicies(), getMuradPolicies("murad_visa_faq")]);
  return <TraveliunShell title="nav.muradSettings"><div className="space-y-5"><MuradSettings setup={setup} /><ReceptionRoutes setup={reception} />{reception && <AutoOffers initial={reception.offers} usd={reception.usd} />}<MuradPolicies initial={visaFaq} setting="murad_visa_faq" /><MuradPolicies initial={policies} /></div></TraveliunShell>;
}
