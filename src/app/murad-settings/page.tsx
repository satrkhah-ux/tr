import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { MuradSettings } from "@/components/traveliun/settings/MuradSettings";
import { ReceptionRoutes } from "@/components/traveliun/operations/ReceptionRoutes";
import { getMuradControl, muradTeaching } from "@/lib/data/murad-control";
import { MuradInstructions } from "@/components/traveliun/settings/MuradInstructions";
import { AutoOffers } from "@/components/traveliun/operations/AutoOffers";
import { MuradPolicies } from "@/components/traveliun/operations/MuradPolicies";
import { MuradPanel } from "@/components/traveliun/developer/MuradPanel";
import { ReceptionPanel } from "@/components/traveliun/developer/ReceptionPanel";
import { getMuradPolicies, getReceptionSetup } from "@/lib/data/app-settings";
import { getFeatureFlags } from "@/lib/features-server";
import { currentCan } from "@/lib/roles/current";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { muradPanel } from "@/lib/murad/run";
import { readReceptionSettings, receptionToday, webhookToken } from "@/lib/murad/reception-run";

export default async function MuradSettingsPage() {
  const setup = await getMuradControl();
  if (!setup) redirect("/dashboard");
  const dev = await currentCan("developer.access");
  const [reception, policies, visaFaq, teaching, live] = await Promise.all([
    getReceptionSetup(),
    getMuradPolicies(),
    getMuradPolicies("murad_visa_faq"),
    muradTeaching(),
    // every Murad setting on one page (the owner, 2026-10-24) — the switches that let a model write to clients stay the developer's
    dev ? Promise.all([getFeatureFlags(), muradPanel(), readReceptionSettings(createSupabaseServiceClient() as unknown as SupabaseClient), receptionToday()]) : null,
  ]);
  const token = webhookToken();
  const site = (process.env["NEXT_PUBLIC_SITE_URL"] ?? "https://pkg.traveliun.com").replace(/\/$/, "");
  return <TraveliunShell title="nav.muradSettings">
    <MuradSettings
      setup={setup}
      routingDefaults={<ReceptionRoutes setup={reception} />}
      knowledge={<>
        {teaching ? <MuradInstructions data={teaching} /> : null}
        <details className="rounded-2xl border border-[#dbe6e1] bg-white p-4 sm:p-6 dark:border-[#294039] dark:bg-[#12241f]">
          <summary className="cursor-pointer font-bold">أسئلة وأجوبة التأشيرات</summary>
          <div className="mt-4"><MuradPolicies initial={visaFaq} setting="murad_visa_faq" /></div>
        </details>
        <details className="rounded-2xl border border-[#dbe6e1] bg-white p-4 sm:p-6 dark:border-[#294039] dark:bg-[#12241f]">
          <summary className="cursor-pointer font-bold">سياسات الشركة والردود</summary>
          <div className="mt-4"><MuradPolicies initial={policies} /></div>
        </details>
      </>}
      offers={reception ? <AutoOffers initial={reception.offers} usd={reception.usd} /> : undefined}
      monitoring={live ? <>
        <ReceptionPanel data={{ on: live[0].murad_reception, scope: live[2].scope, webhookUrl: token ? `${site}/api/teletel/webhook?token=${token}` : null, today: live[3] }} />
        <MuradPanel data={live[1]} flags={{ suggest: live[0].murad_suggest, auto: live[0].murad_auto }} />
      </> : undefined}
    />
  </TraveliunShell>;
}
