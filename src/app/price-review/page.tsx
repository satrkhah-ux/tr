import { redirect } from "next/navigation";
import { PriceReview } from "@/components/traveliun/PriceReview";
import { getPriceReview } from "@/lib/data/price-review";
import { guardPath } from "@/lib/roles/current";

/** «مراجعة الأسعار» — the provisional, conflicting and missing prices, for everyone who keeps the data. */
export default async function PriceReviewPage() {
  await guardPath("/price-review");
  const page = await getPriceReview();
  if (!("rows" in page)) redirect("/dashboard");
  return <PriceReview {...page} />;
}
