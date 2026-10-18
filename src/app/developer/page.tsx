import { Suspense } from "react";
import { redirect } from "next/navigation";
import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { ConnectionsPanel, ConnectionsSkeleton } from "@/components/traveliun/developer/ConnectionsPanel";
import { ServiceSwitches } from "@/components/traveliun/developer/ServiceSwitches";
import { MuradPanel } from "@/components/traveliun/developer/MuradPanel";
import { currentCan } from "@/lib/roles/current";
import { getFeatureFlags } from "@/lib/features-server";
import { FEATURES_SETTING_KEY } from "@/lib/features";
import { listEntityAudit } from "@/lib/data/audit";
import { runAllChecks, serverInfo } from "@/lib/developer/checks";
import { muradPanel } from "@/lib/murad/run";

export const dynamic = "force-dynamic";

/**
 * «المطوّر» (owner's order, 2026-10-17): every external connection's health,
 * the switches that stop and restore system services, and «مُراد» (his model,
 * his auto-reply numbers, what he did last). developer.access
 * only — checked here, not just in the menu, because a URL can be typed.
 */
export default async function DeveloperPage() {
  if (!(await currentCan("developer.access"))) redirect("/dashboard");

  const [flags, log, murad] = await Promise.all([getFeatureFlags(), listEntityAudit("app_settings", FEATURES_SETTING_KEY, 10), muradPanel()]);
  const changes = log.map((row) => ({
    id: row.id,
    at: row.created_at,
    who: row.actor_email,
    feature: String(row.meta.feature ?? ""),
    on: row.meta.on === true,
  }));

  return (
    <TraveliunShell title="dev.title">
      <div className="grid gap-5">
        {/* the checks stream in behind the switches — a slow service never holds the page */}
        <Suspense fallback={<ConnectionsSkeleton />}>
          <LiveConnections />
        </Suspense>
        <ServiceSwitches flags={flags} changes={changes} />
        <MuradPanel data={murad} flags={{ suggest: flags.murad_suggest, auto: flags.murad_auto }} />
      </div>
    </TraveliunShell>
  );
}

async function LiveConnections() {
  const results = await runAllChecks();
  // keyed by the round, so a router.refresh() (after a switch) shows the new round, not the old state
  return <ConnectionsPanel key={results[0]?.checkedAt} initial={results} server={serverInfo()} />;
}
