import { PartnerWelcome } from "@/components/traveliun/partners/PartnerWelcome";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "تفعيل حساب الشركة — ترافليون",
};

/**
 * Where the invitation link lands.
 *
 * Public by necessity: the visitor has no session yet — the whole point of the
 * page is to turn the token in the URL into one. It is inside `/b2b`, which the
 * proxy already treats as public.
 */
export default function PartnerWelcomePage() {
  return (
    <main className="min-h-dvh bg-[#f4f8f6] px-4 py-12" dir="rtl">
      <div className="mx-auto max-w-md">
        <header className="mb-5 text-center">
          <h1 className="text-2xl font-extrabold text-[#003c3a]">أهلاً بك في شبكة ترافليون</h1>
          <p className="mt-2 text-[13px] font-semibold text-[#557d78]">
            خطوة أخيرة: اختر كلمة مرور حسابك، ثم تدخل بوابة الشركات.
          </p>
        </header>
        <PartnerWelcome />
      </div>
    </main>
  );
}
