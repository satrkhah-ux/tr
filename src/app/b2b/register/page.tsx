import { PartnerRegisterForm } from "@/components/traveliun/partners/PartnerRegisterForm";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "انضم كشركة متعاونة — ترافليون",
  description: "سجّل شركتك للعمل مع ترافليون: بكجات بهويتك وأسعار خاصة.",
};

/**
 * The public door for travel companies.
 *
 * Reachable with no session — it is in the proxy's public list beside the client
 * link. Submitting produces one thing: a `pending` company row. No account, no
 * colours in use, no price terms; all of that waits for an employee.
 */
export default function PartnerRegisterPage() {
  return (
    <main className="min-h-dvh bg-[#f4f8f6] px-4 py-10" dir="rtl">
      <div className="mx-auto max-w-2xl">
        <header className="mb-6 text-center">
          <h1 className="text-2xl font-extrabold text-[#003c3a]">انضم إلى شبكة ترافليون</h1>
          <p className="mt-2 text-[13px] font-semibold text-[#557d78]">
            سجّل شركتك، وبعد اعتماد الطلب يصلك حساب تبني به بكجاتك بهوية شركتك — اسمك وشعارك وألوانك —
            وتتابع حجوزاتك أولاً بأول.
          </p>
        </header>
        <PartnerRegisterForm />
        <p className="mt-6 text-center text-[11.5px] font-semibold text-[#93aaa3]">
          لن يُنشأ حساب قبل مراجعة الطلب واعتماده من إدارة ترافليون.
        </p>
      </div>
    </main>
  );
}
