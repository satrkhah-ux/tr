import { topCountriesToday } from "@/lib/office-screens/server";
import { TopToday } from "@/components/traveliun/TopToday";

export const dynamic = "force-dynamic";

/**
 * The office screens' «الأكثر طلباً اليوم» bulletin (framed by office-screens/page.ts).
 * Open like every /screen path: country names and their photos only, no counts.
 */
export default async function ScreenTopPage() {
  const top = await topCountriesToday().catch(() => []);
  return <TopToday screen countries={top.map(({ country, src }) => ({ country, src }))} />;
}
