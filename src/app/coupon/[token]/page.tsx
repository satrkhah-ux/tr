import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { couponWith, db, site } from "@/lib/data/discounts";
import { arabicDate, couponState, scopeLabel } from "@/lib/discounts/rules";
import { TRAVELIUN_BRAND } from "@/components/offer-doc/brand";
import { waNumber } from "@/lib/operations/drivers";

export const dynamic = "force-dynamic";
export const metadata = { title: "كوبون خصم ترافليون", robots: { index: false, follow: false } };

/**
 * The client's coupon (the owner, 2026-10-31), in our documents' identity: white with the world map,
 * the logo, the landscape card itself (card/route.tsx — the same picture WhatsApp carried), then the QR
 * large enough to scan from a phone held up at the desk. The first open of a sent coupon is noted.
 */
export default async function CouponPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) notFound();
  const found = await couponWith({ token });
  if (!found || found.coupon.excluded) notFound();
  const { coupon, campaign } = found;
  // only a sent coupon counts as opened — the manager's preview before sending is not the client
  if (coupon.sent_at && !coupon.opened_at) await db().from("discount_coupons").update({ opened_at: new Date().toISOString() }).eq("id", coupon.id).is("opened_at", null);

  const state = couponState(coupon);
  const qr = await QRCode.toString(`${site()}/coupon/${token}`, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#263633", light: "#00000000" } });
  const amount = campaign.kind === "percent" ? `${campaign.value}%` : `${campaign.value} ريال`;
  const wa = `https://wa.me/${waNumber(TRAVELIUN_BRAND.whatsapp || TRAVELIUN_BRAND.phone)}?text=${encodeURIComponent(`السلام عليكم، لدي كوبون خصم ${coupon.code} وأرغب في طلب باقة سياحية`)}`;

  return (
    <main dir="rtl" className="relative min-h-dvh bg-white px-4 py-6 text-[#263633]">
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-[url('/traveliun/world-map.png')] bg-cover bg-center opacity-50" />
      <div className="tv-rise relative mx-auto w-full max-w-[640px]">
        <header className="flex items-center justify-between border-b-2 border-[#135549] pb-3">
          <p className="flex items-center gap-2 text-[17px] font-extrabold text-[#135549]">
            <span aria-hidden className="h-6 w-1.5 rounded bg-[#f0ad22]" />كوبون خصم خاص
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- the brand mark */}
          <img src="/traveliun/offer-logo.png" alt="Traveliun" className="h-12 w-auto" />
        </header>

        {/* eslint-disable-next-line @next/next/no-img-element -- the card is drawn per coupon by card/route.tsx */}
        <img src={`/coupon/${token}/card`} alt={`كوبون خصم ${amount} باسم ${coupon.client_name ?? "العميل"}`} width={1200} height={630}
          className={`mt-5 h-auto w-full rounded-2xl border border-[#d7e4e0] shadow-[0_12px_28px_rgba(20,54,48,.10)] ${state === "valid" ? "" : "grayscale"}`} />

        <section className="mt-5 rounded-2xl border border-[#d7e4e0] bg-[rgba(246,250,248,.94)] p-5 text-center">
          {state === "valid" ? (
            <>
              <p className="text-[15px] font-bold text-[#135549]">اعرض هذا الرمز على موظفنا عند طلب باقتك</p>
              <div className="mx-auto mt-4 size-56 rounded-2xl border border-[#d7e4e0] bg-white p-4 [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: qr }} />
              <p className="mt-3 font-mono text-[24px] font-black tracking-[0.15em]" dir="ltr">{coupon.code}</p>
              <p className="mt-2 text-[13.5px] font-semibold text-[#6b7c78]">
                خصم {amount} {scopeLabel(campaign.applies_to)} · صالح حتى {arabicDate(coupon.expires_at)}
              </p>
              <a href={wa} className="mt-5 flex min-h-12 items-center justify-center rounded-xl bg-gradient-to-l from-[#135549] to-[#1f7667] text-[15px] font-extrabold text-white">
                اطلب باقتك الآن على واتساب
              </a>
            </>
          ) : (
            <p className="text-[17px] font-extrabold text-[#a3263f]">{state === "used" ? "هذا الكوبون مستخدم" : "انتهت صلاحية هذا الكوبون"}</p>
          )}
          <p className="mt-4 text-[12px] font-semibold text-[#6b7c78]">يُستخدم مرة واحدة ولصاحبه فقط.</p>
        </section>

        <footer className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t-2 border-[#135549] pt-3 text-[12.5px] font-bold text-[#135549]">
          <span>{TRAVELIUN_BRAND.nameAr}</span>
          <a href={`/discounts/scan?t=${coupon.code}`} className="text-[#6b7c78] underline">للموظف: افتح في النظام</a>
        </footer>
      </div>
    </main>
  );
}
