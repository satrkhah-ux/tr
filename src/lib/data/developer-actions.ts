"use server";

import { currentCan } from "@/lib/roles/current";
import { runAllChecks, runCheck, serverInfo, testFlightApi, type ServerInfo } from "@/lib/developer/checks";
import type { CheckResult } from "@/lib/developer/health";

/**
 * /developer's buttons. Each one re-checks developer.access itself: the page's
 * redirect does not protect a server action, which any signed-in tab can call.
 */

export async function recheckConnection(id: string): Promise<CheckResult | null> {
  if (typeof id !== "string" || !(await currentCan("developer.access"))) return null;
  return runCheck(id);
}

export async function recheckAllConnections(): Promise<{ results: CheckResult[]; server: ServerInfo } | null> {
  if (!(await currentCan("developer.access"))) return null;
  return { results: await runAllChecks(), server: serverInfo() };
}

/** The only path that spends AviationStack quota — one request, on the developer's click. */
export async function testFlightLookupApi(): Promise<CheckResult | null> {
  if (!(await currentCan("developer.access"))) return null;
  return testFlightApi();
}
