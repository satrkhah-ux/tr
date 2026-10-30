import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { CouponScanner } from "@/components/traveliun/discounts/CouponScanner";
import { guardPath } from "@/lib/roles/current";

export const dynamic = "force-dynamic";
export default async function CouponScanPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  await guardPath("/discounts/scan");
  const { t } = await searchParams;
  return <TraveliunShell title="nav.discountScan"><CouponScanner initial={t?.slice(0, 120) ?? null} /></TraveliunShell>;
}
