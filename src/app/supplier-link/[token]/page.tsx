import { notFound } from "next/navigation";
import { getSupplierLinkView } from "@/lib/data/public-links";
import { SupplierLinkForm } from "@/components/traveliun/operations/SupplierLinkForm";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

const riyadh = (iso: string) => new Date(iso).toLocaleString("sv-SE", { timeZone: "Asia/Riyadh" }).slice(0, 16);

/**
 * «رابط المورد» (operations order 11): the request we sent the supplier, and
 * the form he confirms it with. The token is the gate (public-links.ts); the
 * page shows the request text and nothing else of ours. Written in the
 * supplier's request language.
 */
export default async function SupplierLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await getSupplierLinkView(token);
  if (!view) notFound();
  const en = view.lang === "en";

  return (
    <main dir={en ? "ltr" : "rtl"} className="min-h-screen bg-[#f4f8f6] px-4 py-6 text-[#0f3d38] sm:py-10">
      <div className="mx-auto w-full max-w-[640px] space-y-4">
        <header className="rounded-2xl bg-[#135549] px-5 py-5 text-white">
          <p className="text-[13px] font-bold opacity-80">{en ? "Traveliun — booking request" : "ترافليون — طلب حجز"}</p>
          <h1 className="mt-1 break-words text-[19px] font-extrabold">{view.subject}</h1>
          <p className="mt-2 text-[12px] font-semibold opacity-80">
            {en ? "Link valid until" : "الرابط صالح حتى"} <bdi dir="ltr">{riyadh(view.expires_at)}</bdi>
          </p>
        </header>

        <section className="rounded-2xl border border-[#e2ebe7] bg-white p-5">
          <pre dir="auto" className="whitespace-pre-wrap break-words font-sans text-[13.5px] font-semibold leading-relaxed">
            {view.body}
          </pre>
        </section>

        <section className="rounded-2xl border border-[#e2ebe7] bg-white p-5">
          {view.confirmed ? (
            <p className="rounded-[12px] bg-[#e9f7f0] px-4 py-3 text-[14px] font-bold text-[#0f7a52]">
              {en ? "Confirmed — thank you." : "تم التأكيد — شكراً لكم."}
              {view.confirmed.ref ? (
                <>
                  {" "}
                  {en ? "Ref." : "الرقم"} <bdi dir="ltr">{view.confirmed.ref}</bdi>
                </>
              ) : null}
            </p>
          ) : (
            <SupplierLinkForm token={token} en={en} driverKind={view.service !== null} initial={view.driver} />
          )}
        </section>
      </div>
    </main>
  );
}
