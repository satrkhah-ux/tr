import { CircleCheck, CircleAlert } from "lucide-react";
import { DirText } from "@/components/DirText";

/**
 * Where Tamara sends the client back (success / failure / cancel URLs of the session pay-now.ts makes). It only
 * SAYS what happened: nothing is read or written here — a redirect can be typed by anyone, so the payment is
 * recorded by the 10-minute job only once Tamara itself reports it authorised (payment-links-poll.ts).
 */
export const dynamic = "force-dynamic";

const FONT = `
@font-face{font-family:Tajawal;font-style:normal;font-weight:400;src:url('/fonts/Tajawal-Regular.ttf') format('truetype');}
@font-face{font-family:Tajawal;font-style:normal;font-weight:700;src:url('/fonts/Tajawal-Bold.ttf') format('truetype');}`;

export default async function PayDonePage({ params, searchParams }: { params: Promise<{ serial: string }>; searchParams: Promise<{ s?: string }> }) {
  const { serial } = await params;
  const { s } = await searchParams;
  const ok = s === "ok";

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#eef3f1] px-4 py-8" dir="rtl">
      <style dangerouslySetInnerHTML={{ __html: FONT }} />
      <section className="w-full max-w-[440px] rounded-2xl bg-white p-7 text-center shadow-[0_10px_30px_rgba(0,60,58,0.12)]">
        <div className={`mx-auto mb-4 flex size-[68px] items-center justify-center rounded-[18px] ${ok ? "bg-[#e7f3ee] text-[#185045]" : "bg-[#fdeef2] text-[#c43d3d]"}`}>
          {ok ? <CircleCheck className="size-8" /> : <CircleAlert className="size-8" />}
        </div>
        <p className="text-[13px] font-bold text-[#557d78]">
          ملف رقم <DirText dir="ltr" className="tv-tnum">{serial}</DirText>
        </p>
        <h1 className="mt-2 text-[20px] font-extrabold text-[#103f37]">{ok ? "تم استلام طلبك" : "لم يكتمل الدفع"}</h1>
        <p className="mt-2 text-[14px] font-semibold leading-relaxed text-[#557d78]">
          {ok ? "سيؤكد الموظف السداد ويتواصل معك قريباً. شكراً لك." : "لم يُخصم منك شيء. يمكنك المحاولة مرة أخرى، أو التواصل مع موظف المبيعات."}
        </p>
        {ok ? null : (
          <a
            href={`/pay/${encodeURIComponent(serial)}?m=tamara`}
            className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-[12px] bg-black text-[15px] font-extrabold text-white hover:bg-[#222]"
          >
            حاول مرة أخرى
          </a>
        )}
      </section>
    </main>
  );
}
