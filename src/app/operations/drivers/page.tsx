import { DriverSchedule } from "@/components/traveliun/operations/DriverSchedule";
import { listDriverSchedule } from "@/lib/data/operation-drivers";

export const dynamic = "force-dynamic";

/**
 * «جدول السائقين» — one day's drives and tours across every case. The day
 * defaults to the company's (Riyadh) today, not the server's UTC one.
 */
export default async function DriverSchedulePage({ searchParams }: { searchParams: Promise<{ date?: string; city?: string }> }) {
  const { date: asked, city } = await searchParams;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
  const date = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : today;
  const rows = await listDriverSchedule(date);
  return <DriverSchedule key={date} date={date} city={city ?? ""} rows={rows} />;
}
