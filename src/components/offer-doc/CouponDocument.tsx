import type { OfferDocAssets } from "./assets";
import { TRAVELIUN_BRAND } from "./brand";
import { OFFER_DOC_CSS } from "./styles";

/**
 * «كوبون الخصم» in our identity (the owner, 2026-10-31: «استخدم الهوية الخاصة بترافليون», «بالعرض»):
 * the offer document's white sheet with the world map, its greens and gold, Tajawal, the logo and the
 * company line — set as a landscape ticket, the QR on a boarding-pass stub. Rendered by the same
 * Chromium as the PDF (lib/offer-doc/pdf.ts documentToPng), so the Arabic is shaped by the browser.
 */

export type CouponDoc = {
  name: string | null;
  amount: string;
  unit: string | null;
  scope: string;
  code: string;
  expires: string;
  phone: string;
  qrSvg: string;
};

const CP_CSS = `
.od-page.cp-page{width:1200px;height:630px;min-height:0;padding:0;display:flex;overflow:hidden;break-after:auto;}
.od-page.cp-page::before{opacity:.55;}
.cp-page>*{position:relative;z-index:1;}
.cp-main{flex:1;display:flex;flex-direction:column;padding:44px 56px 0 40px;}
.cp-top{display:flex;align-items:center;justify-content:space-between;}
.cp-logo{height:96px;width:auto;display:block;}
.cp-tag{display:flex;align-items:center;gap:10px;color:var(--od-green);font-size:30px;font-weight:800;}
.cp-tag::before{content:"";width:8px;height:34px;border-radius:4px;background:var(--od-gold);}
.cp-to{margin-top:22px;color:var(--od-muted);font-size:22px;font-weight:500;}
.cp-name{margin-top:2px;color:var(--od-green);font-size:46px;font-weight:800;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:640px;}
.cp-gift{margin-top:22px;display:flex;align-items:center;gap:26px;background:linear-gradient(135deg,var(--od-green),var(--od-green-2));color:#fff;border-radius:22px;padding:18px 30px;box-shadow:0 12px 28px var(--od-shadow);}
.cp-amount{font-size:104px;font-weight:800;line-height:1;color:#fff;}
.cp-unit{font-size:30px;font-weight:700;color:var(--od-gold);margin-inline-start:8px;}
.cp-scope{border-inline-start:2px solid rgba(255,255,255,.35);padding-inline-start:24px;font-size:27px;font-weight:700;line-height:1.5;}
.cp-scope small{display:block;font-size:19px;font-weight:500;color:#cfe6df;}
.cp-foot{margin-top:auto;display:flex;justify-content:space-between;align-items:center;border-top:2px solid var(--od-green);padding:12px 0 16px;color:var(--od-green);font-size:19px;font-weight:700;}
.cp-foot bdi{direction:ltr;}
.cp-cut{width:0;position:relative;border-inline-start:3px dashed var(--od-line);margin:26px 0;}
.cp-cut::before,.cp-cut::after{content:"";position:absolute;right:-19px;width:36px;height:36px;border-radius:50%;background:var(--od-soft);border:1px solid var(--od-line-2);}
.cp-cut::before{top:-46px;}.cp-cut::after{bottom:-46px;}
.cp-stub{width:340px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:28px;background:var(--od-fill);}
.cp-qr{width:236px;height:236px;padding:14px;background:#fff;border:1px solid var(--od-line-2);border-radius:18px;box-shadow:0 8px 20px var(--od-shadow-2);}
.cp-qr svg{width:100%;height:100%;display:block;}
.cp-code{margin-top:16px;direction:ltr;font-size:34px;font-weight:800;letter-spacing:3px;color:var(--od-ink);}
.cp-facts{margin-top:14px;width:100%;display:grid;gap:8px;}
.cp-fact{display:flex;justify-content:space-between;gap:10px;background:#fff;border:1px solid var(--od-line-2);border-radius:12px;padding:8px 14px;font-size:17px;}
.cp-fact span{color:var(--od-muted);}
.cp-fact b{color:var(--od-ink);font-weight:800;}
`;

export function CouponDocument({ coupon, assets }: { coupon: CouponDoc; assets: OfferDocAssets }) {
  const brand = TRAVELIUN_BRAND;
  return (
    <div className="od-root" dir="rtl" style={{ ["--od-map" as string]: `url("${assets.mapUrl}")` }}>
      <style>{OFFER_DOC_CSS + CP_CSS}</style>
      <section className="od-page cp-page">
        <div className="cp-main">
          <div className="cp-top">
            <div className="cp-tag">كوبون خصم خاص</div>
            {/* eslint-disable-next-line @next/next/no-img-element -- printed by Chromium from a data URI */}
            <img className="cp-logo" src={assets.logoUrl} alt={brand.nameLatin} />
          </div>
          <div className="cp-to">مقدّم إلى</div>
          <div className="cp-name">{coupon.name?.trim() || "عميلنا العزيز"}</div>
          <div className="cp-gift">
            <div>
              <span className="cp-amount od-tnum">{coupon.amount}</span>
              {coupon.unit ? <span className="cp-unit">{coupon.unit}</span> : null}
            </div>
            <div className="cp-scope">
              خصم {coupon.scope}
              <small>يُستخدم مرة واحدة ولصاحبه فقط</small>
            </div>
          </div>
          <div className="cp-foot">
            <span>{brand.nameAr}</span>
            <span>
              <bdi>{brand.website}</bdi> · واتساب <bdi>{brand.whatsapp}</bdi>
            </span>
          </div>
        </div>
        <div className="cp-cut" />
        <div className="cp-stub">
          <div className="cp-qr" dangerouslySetInnerHTML={{ __html: coupon.qrSvg }} />
          <div className="cp-code">{coupon.code}</div>
          <div className="cp-facts">
            <div className="cp-fact"><span>صالح حتى</span><b>{coupon.expires}</b></div>
            <div className="cp-fact"><span>الجوال</span><b><bdi dir="ltr">{coupon.phone}</bdi></b></div>
          </div>
        </div>
      </section>
    </div>
  );
}
