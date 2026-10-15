import { TraveliunTablePage } from "@/components/traveliun/TraveliunTablePage";
import { guardPath } from "@/lib/roles/current";

/** `?q=` opens the table searched — the link «يوجد فندق مشابه» gives to the match. */
export default async function HotelsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await guardPath("/hotels");
  const { q } = await searchParams;
  return <TraveliunTablePage route="/hotels" initialSearch={typeof q === "string" ? q.slice(0, 120) : undefined} />;
}
