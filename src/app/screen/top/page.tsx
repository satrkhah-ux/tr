import { topCountriesToday } from "@/lib/office-screens/server";
import { TopToday, type WallParams } from "@/components/traveliun/TopToday";

export const dynamic = "force-dynamic";

/**
 * The office screens' «الأكثر طلباً اليوم» bulletin, framed by office-screens/page.ts
 * with this screen's place on the wall (?pos=0…&of=4) and when the pass began on
 * the screen's server clock (?start=&now=). Open like every /screen path: country
 * names and their photos only, no counts.
 */
export default async function ScreenTopPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  const [pos, of, start, now] = [q.pos, q.of, q.start, q.now].map((v) => Number(v));
  const wall: WallParams | null =
    Number.isInteger(pos) && Number.isInteger(of) && of >= 1 && pos >= 0 && pos < of && Number.isFinite(start) && Number.isFinite(now)
      ? { pos, of, start, now }
      : null;
  const top = await topCountriesToday().catch(() => []);
  return <TopToday countries={top.map(({ country, src }) => ({ country, src }))} wall={wall} />;
}
