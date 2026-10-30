import { notFound } from "next/navigation";
import { TripRatingForm } from "@/components/traveliun/operations/TripRatingForm";
import { getTripRating } from "@/lib/data/trip-rating";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

/** «كيف كانت رحلتكم؟» — the traveller's rating, reached from the trip link. */
export default async function TripRatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const state = await getTripRating(token);
  if (!state.found) notFound();
  return (
    <main dir="rtl" className="min-h-screen bg-[#f4f8f6] px-4 py-10 text-[#0f3d38]">
      <div className="tv-card mx-auto w-full max-w-[520px] rounded-2xl border p-6 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
        <h1 className="text-[20px] font-extrabold">كيف كانت رحلتكم؟</h1>
        <p className="mt-1 text-[13px] font-semibold text-[#557d78]">رأيكم يساعدنا أن نجعل الرحلة القادمة أفضل.</p>
        <TripRatingForm token={token} rated={state.score} />
      </div>
    </main>
  );
}
