import { PartnerWelcome } from "@/components/traveliun/partners/PartnerWelcome";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "تفعيل حساب الموظف — ترافليون",
};

/**
 * Where a STAFF invitation lands («إصدار حساب», or an approved self-registration).
 * Public under /sign-in: the visitor has no session yet — the page turns the
 * token in the link into one, then asks for a password. Same component as the
 * partner landing; only where it goes afterwards differs.
 */
export default function StaffWelcomePage() {
  return (
    <main className="min-h-dvh bg-[#f4f8f6] px-4 py-12" dir="rtl">
      <div className="mx-auto max-w-md">
        <header className="mb-5 text-center">
          <h1 className="text-2xl font-extrabold text-[#003c3a]">أهلاً بك في ترافليون</h1>
          <p className="mt-2 text-[13px] font-semibold text-[#557d78]">
            خطوة أخيرة: اختر كلمة مرور حسابك، ثم تدخل النظام.
          </p>
        </header>
        <PartnerWelcome home="/dashboard" homeLabel="العودة إلى تسجيل الدخول" />
      </div>
    </main>
  );
}
