import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { couponWith, db, site } from "@/lib/data/discounts";
import { arabicDate, couponState, maskPhone, scopeLabel } from "@/lib/discounts/rules";
import { TRAVELIUN_BRAND } from "@/components/offer-doc/brand";
import { waNumber } from "@/lib/operations/drivers";

export const dynamic = "force-dynamic";
export const metadata = { title: "كوبون خصم ترافليون", robots: { index: false, follow: false } };

/**
 * The client's coupon (the owner, 2026-10-31): a ticket in their name, the discount large, the QR the
 * employee scans in «قارئ الكوبونات», the code to read out, the end date. The number is masked — the
 * link gets forwarded. The first open is noted for the campaign's figures; nothing else is written.
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
  const qr = await QRCode.toString(`${site()}/coupon/${token}`, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#0b3d35", light: "#00000000" } });
  const amount = campaign.kind === "percent" ? `${campaign.value}%` : String(campaign.value);
  const wa = `https://wa.me/${waNumber(TRAVELIUN_BRAND.whatsapp || TRAVELIUN_BRAND.phone)}?text=${encodeURIComponent(`السلام عليكم، لدي كوبون خصم ${coupon.code} وأرغب في طلب باقة سياحية`)}`;

  return (
    <main dir="rtl" className="relative min-h-dvh overflow-hidden bg-[#06302a] px-4 py-8 text-[#0b3d35]">
      {/* the world map of the programme PDF, faint behind the ticket */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[url('/traveliun/world-map.png')] bg-contain bg-center bg-no-repeat opacity-[0.07]" />
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 size-[520px] -translate-x-1/2 rounded-full bg-[#f0ad22]/20 blur-3xl" />

      <article className="tv-rise relative mx-auto w-full max-w-[380px] drop-shadow-[0_24px_48px_rgba(0,0,0,0.45)]">
        {/* top: the gift */}
        <section className="relative overflow-hidden rounded-t-[28px] bg-gradient-to-br from-[#135549] via-[#0f4a40] to-[#0a3a32] px-6 pb-8 pt-6 text-white">
          <div aria-hidden className="absolute -left-10 -top-10 size-40 rounded-full border-[18px] border-[#f0ad22]/15" />
          <div aria-hidden className="absolute -bottom-16 -right-6 size-44 rounded-full border-[22px] border-white/5" />
          <div className="relative flex items-center justify-between">
            {/* eslint-disable-next-line @next/next/no-img-element -- a fixed brand mark, public page */}
            <img src="/traveliun/logo-en.svg" alt="Traveliun" className="h-7 w-auto brightness-0 invert" />
            <span className="rounded-full border border-[#f0ad22]/60 bg-[#f0ad22]/15 px-3 py-1 text-[11.5px] font-extrabold tracking-wide text-[#ffd27a]">هدية خاصة</span>
          </div>
          <p className="relative mt-7 text-[14px] font-bold text-white/75">كوبون خصم باسم</p>
          <h1 className="relative mt-1 text-[26px] font-extrabold leading-tight">{coupon.client_name?.trim() || "عميلنا العزيز"}</h1>
          <div className="relative mt-6 flex items-end gap-2">
            <span className="bg-gradient-to-b from-[#ffe2a0] to-[#f0ad22] bg-clip-text text-[84px] font-black leading-[0.85] text-transparent tabular-nums">{amount}</span>
            {campaign.kind === "amount" && <span className="mb-2 text-[22px] font-extrabold text-[#ffd27a]">ريال</span>}
          </div>
          <p className="relative mt-3 text-[15px] font-bold text-white/90">خصم {scopeLabel(campaign.applies_to)}</p>
        </section>

        {/* the tear line: two notches and a dashed rule */}
        <div aria-hidden className="relative h-6 bg-white">
          <span className="absolute -right-3 top-1/2 size-6 -translate-y-1/2 rounded-full bg-[#06302a]" />
          <span className="absolute -left-3 top-1/2 size-6 -translate-y-1/2 rounded-full bg-[#06302a]" />
          <span className="absolute inset-x-6 top-1/2 border-t-2 border-dashed border-[#0b3d35]/20" />
        </div>

        {/* bottom: the proof */}
        <section className="relative rounded-b-[28px] bg-white px-6 pb-6 pt-2">
          <div className="relative mx-auto w-fit">
            <div className={`rounded-2xl border border-[#0b3d35]/10 bg-[#f6faf8] p-4 ${state === "valid" ? "" : "opacity-25 grayscale"}`}>
              <div className="size-44 [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: qr }} />
            </div>
            {state !== "valid" && (
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-12 rounded-lg border-4 border-red-600 px-3 py-1 text-[22px] font-black text-red-600">
                {state === "used" ? "مستخدم" : "منتهي"}
              </span>
            )}
          </div>
          <p className="mt-3 text-center font-mono text-[22px] font-black tracking-[0.18em] text-[#0b3d35]" dir="ltr">{coupon.code}</p>
          <dl className="mt-4 grid grid-cols-2 gap-2 text-center">
            <div className="rounded-xl bg-[#f6faf8] px-2 py-2.5">
              <dt className="text-[11px] font-bold text-[#0b3d35]/55">صالح حتى</dt>
              <dd className="mt-0.5 text-[12.5px] font-extrabold">{arabicDate(coupon.expires_at)}</dd>
            </div>
            <div className="rounded-xl bg-[#f6faf8] px-2 py-2.5">
              <dt className="text-[11px] font-bold text-[#0b3d35]/55">مرتبط بالجوال</dt>
              <dd className="mt-0.5 text-[13px] font-extrabold tabular-nums" dir="ltr">{maskPhone(coupon.phone)}</dd>
            </div>
          </dl>
          <p className="mt-4 text-center text-[12.5px] font-semibold leading-6 text-[#0b3d35]/70">
            اعرض هذا الكوبون على موظفنا عند طلب باقتك. يُستخدم مرة واحدة ولصاحبه فقط.
          </p>
          {state === "valid" && (
            <a href={wa} className="mt-4 flex min-h-12 items-center justify-center rounded-2xl bg-gradient-to-l from-[#135549] to-[#1b6b5c] text-[15px] font-extrabold text-white shadow-lg shadow-[#135549]/30">
              اطلب باقتك الآن على واتساب
            </a>
          )}
        </section>
      </article>

      <p className="relative mt-6 text-center text-[11.5px] font-semibold text-white/45">
        {TRAVELIUN_BRAND.nameAr} · <a href={`/discounts/scan?t=${coupon.code}`} className="underline">للموظف: افتح في النظام</a>
      </p>
    </main>
  );
}
