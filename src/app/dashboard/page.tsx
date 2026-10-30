import { TraveliunDashboardClient } from "@/components/traveliun/TraveliunDashboardClient";
import { getOperationsSummary } from "@/lib/data/operations-work";
import { getMyDashboard } from "@/lib/data/my-dashboard";
import { getMySalesCard } from "@/lib/data/commissions";
import { getLatestOffer } from "@/lib/data/offers";
import { getVisaBoard } from "@/lib/data/visa-files";
import { currentCan } from "@/lib/roles/current";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // Fetched on the server so the operations numbers are already on screen at
  // first paint, and so "travel is approaching" is measured against the server's
  // clock rather than the visitor's laptop. «لوحتي» likewise: the employee is
  // read from the session here, so the browser never names whose numbers to show.
  // the latest offer, its smart check and client link (the old «مركز التشغيل الذكي») — the administration's
  const [opsSummary, mine, latest, visaBoard, salesCard] = await Promise.all([
    getOperationsSummary(),
    getMyDashboard(),
    currentCan("dashboard.admin").then((on) => (on ? getLatestOffer() : null)),
    // «رئيسية التأشيرات»: the board's counters for a visa colleague (the board itself scopes a worker to their own files)
    Promise.all([currentCan("visas.work"), currentCan("visas.manage")]).then(async ([w, m]) => {
      if (!w && !m) return null;
      const r = await getVisaBoard();
      return r.ok ? r.board : null;
    }),
    // «مبيعاتك / هدفك / عمولتك» — the signed-in employee's own month (commissions.view), never a colleague's
    getMySalesCard().catch(() => null),
  ]);
  return <TraveliunDashboardClient opsSummary={opsSummary} mine={mine} latest={latest} visaBoard={visaBoard} salesCard={salesCard} />;
}
