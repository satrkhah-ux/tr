import { CreditCard, ShieldCheck } from "lucide-react";
import { DirText } from "@/components/DirText";
import { payPreview } from "@/lib/payments/pay-now";
import { REFUSAL_AR, type PayRefusal } from "@/lib/payments/pay-now-rules";
import { payNow } from "./actions";

/**
 * PUBLIC «ادفع الآن» (the owner, 2026-10-29) — where the button in the client's PDF and page lands. Opening it
 * makes nothing (a link preview must not create invoices); the press does (actions.ts → pay-now.ts). The page
 * says the amount only: never a fee, a share or the word «رسوم».
 */
export const dynamic = "force-dynamic";

const FONT = `
@font-face{font-family:Tajawal;font-style:normal;font-weight:400;src:url('/fonts/Tajawal-Regular.ttf') format('truetype');}
@font-face{font-family:Tajawal;font-style:normal;font-weight:700;src:url('/fonts/Tajawal-Bold.ttf') format('truetype');}`;

const AFTER_PRESS: Record<string, string> = {
  busy: "محاولات كثيرة في وقت قصير. انتظر دقائق ثم حاول مرة أخرى.",
  gateway: "تعذّر فتح صفحة الدفع الآن. حاول بعد قليل، أو تواصل مع موظف المبيعات.",
};

export default async function PayPage({ params, searchParams }: { params: Promise<{ serial: string }>; searchParams: Promise<{ a?: string; e?: string }> }) {
  const { serial } = await params;
  const { a, e } = await searchParams;
  const preview = await payPreview(serial, a);
  const pressed = e ? (AFTER_PRESS[e] ?? REFUSAL_AR[e as PayRefusal]) : undefined;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#eef3f1] px-4 py-8" dir="rtl">
      <style dangerouslySetInnerHTML={{ __html: FONT }} />
      <section className="w-full max-w-[440px] rounded-2xl bg-white p-7 text-center shadow-[0_10px_30px_rgba(0,60,58,0.12)]">
        <div className="mx-auto mb-4 flex size-[68px] items-center justify-center rounded-[18px] bg-[#e7f3ee] text-[#185045]">
          {preview.ok ? <CreditCard className="size-8" /> : <ShieldCheck className="size-8" />}
        </div>
        <p className="text-[13px] font-bold text-[#557d78]">
          ملف رقم <DirText dir="ltr" className="tv-tnum">{serial}</DirText>
        </p>
        {preview.ok ? (
          <>
            <h1 className="mt-2 text-[15px] font-bold text-[#103f37]">المبلغ المطلوب</h1>
            <p className="mt-1 text-[32px] font-extrabold text-[#185045]">
              <DirText dir="ltr" className="tv-tnum">{preview.amount.toLocaleString("en-US", { minimumFractionDigits: preview.amount % 1 ? 2 : 0, maximumFractionDigits: 2 })}</DirText>{" "}
              <span className="text-[16px] font-bold">{preview.currency === "SAR" ? "ريال" : preview.currency}</span>
            </p>
            {pressed ? <p className="mt-3 rounded-[10px] bg-[#fdeef2] px-3 py-2 text-[13px] font-bold text-[#c43d3d]">{pressed}</p> : null}
            <form action={payNow} className="mt-5">
              <input type="hidden" name="serial" value={serial} />
              {a ? <input type="hidden" name="a" value={a} /> : null}
              <button type="submit" className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-[12px] bg-[#185045] text-[16px] font-extrabold text-white hover:bg-[#0f4439]">
                <CreditCard className="size-5" />
                ادفع الآن
              </button>
            </form>
            <p className="mt-3 text-[12px] font-semibold text-[#8aa29b]">تنتقل إلى صفحة ماي فاتورة الآمنة للدفع بمدى أو البطاقة أو Apple Pay.</p>
          </>
        ) : (
          <p className="mt-3 text-[15px] font-bold leading-relaxed text-[#103f37]">{REFUSAL_AR[preview.why]}</p>
        )}
      </section>
    </main>
  );
}
