import { topCountriesToday } from "@/lib/office-screens/server";
import { TopToday } from "@/components/traveliun/TopToday";

export const dynamic = "force-dynamic";

/** «الأكثر طلباً اليوم» — today's most-asked countries on a line of polaroids, in Traveliun's colours (the user, 2026-10-23). */
export default async function TopTodayPage() {
  const top = await topCountriesToday().catch(() => []);
  return <TopToday countries={top.map(({ country, src }) => ({ country, src }))} />;
}
