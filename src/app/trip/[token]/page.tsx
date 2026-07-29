import { notFound } from "next/navigation";
import { COMPANY } from "@/components/offer-doc/labels";
import { getClientHub } from "@/lib/data/operation-hub";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

const DOC_LABEL: Record<string, string> = {
  hotel_voucher: "قسيمة إقامة فندقية",
  flight_ticket: "تذكرة الطيران",
  itinerary: "الجدول السياحي",
  booking_summary: "ملخص الحجوزات",
};

const KIND_LABEL: Record<string, string> = {
  hotel: "الفندق",
  flight: "الطيران",
  visa: "التأشيرة",
  transport: "المواصلات",
  service: "خدمة",
};

/**
 * The client's folder — one link that lists every document issued so far and
 * says plainly what is still being worked on.
 *
 * Carries no prices, no supplier names and no passport data: a client forwards
 * this to their family, and everything on it has to survive that.
 */
export default async function TripHubPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const hub = await getClientHub(token);
  if (!hub) notFound();

  return (
    <main dir="rtl" className="min-h-screen bg-[#f4f8f6] px-4 py-10 text-[#0f3d38]">
      <div className="mx-auto w-full max-w-[680px]">
        <header className="rounded-2xl bg-[#135549] px-6 py-7 text-white shadow-[0_10px_30px_rgba(19,85,73,0.25)]">
          <p className="text-[13px] font-bold opacity-80">{COMPANY.nameAr}</p>
          <h1 className="mt-1 text-[24px] font-extrabold">{hub.destination || "رحلتك"}</h1>
          <p className="mt-2 text-[13.5px] font-semibold opacity-90">
            {hub.customer_name ? `${hub.customer_name} · ` : ""}
            <bdi dir="ltr">{hub.serial}</bdi>
          </p>
          {hub.travel_start ? (
            <p className="mt-3 inline-block rounded-full bg-white/15 px-3 py-1 text-[12.5px] font-bold">
              <bdi dir="ltr">{`${hub.travel_start} → ${hub.travel_end ?? "—"}`}</bdi>
            </p>
          ) : null}
        </header>

        <section className="mt-4 rounded-2xl border border-[#e2ebe7] bg-white p-6 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
          <h2 className="text-[15px] font-extrabold">مستنداتك</h2>
          {hub.documents.length === 0 ? (
            <p className="mt-3 rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-6 text-center text-[13.5px] text-[#93aaa3]">
              لم تصدر المستندات بعد. ستظهر هنا فور إصدارها — احتفظ بهذا الرابط.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {hub.documents.map((d) => (
                <li key={d.token}>
                  <a
                    href={`/voucher/${d.token}/pdf`}
                    target="_blank"
                    rel="noopener"
                    className="flex items-center justify-between gap-3 rounded-[12px] border border-[#e2ebe7] px-4 py-3.5 transition-colors hover:bg-[#f4f8f6]"
                  >
                    <span>
                      <span className="block text-[14px] font-extrabold">{DOC_LABEL[d.kind] ?? d.kind}</span>
                      <span className="mt-0.5 block text-[11.5px] font-semibold text-[#93aaa3]">
                        <bdi dir="ltr">{d.issued_at}</bdi>
                      </span>
                    </span>
                    <span className="shrink-0 rounded-[9px] bg-[#185045] px-3.5 py-2 text-[12.5px] font-bold text-white">
                      فتح PDF
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        {hub.pending.length > 0 ? (
          <section className="mt-4 rounded-2xl border border-[#f2e2b4] bg-[#fff8e8] p-6">
            <h2 className="text-[14px] font-extrabold text-[#a86a10]">قيد الإنجاز</h2>
            <ul className="mt-2 space-y-1.5">
              {hub.pending.map((p, i) => (
                <li key={i} className="text-[13px] font-bold text-[#8a5a0c]">
                  {KIND_LABEL[p.kind] ?? p.kind} — {p.title}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12px] font-semibold text-[#a86a10]">
              نعمل على تأكيدها الآن، وستظهر مستنداتها هنا فور صدورها.
            </p>
          </section>
        ) : null}

        <footer className="mt-5 text-center text-[12px] font-semibold text-[#93aaa3]">
          {COMPANY.nameAr} · <bdi dir="ltr">{COMPANY.phone}</bdi> · <bdi dir="ltr">{COMPANY.website}</bdi>
        </footer>
      </div>
    </main>
  );
}
