import Link from "next/link";
import { PartnerSignIn } from "@/components/traveliun/partners/PartnerSignIn";
import { PartnerPortal } from "@/components/traveliun/partners/PartnerPortal";
import { listPartnerFiles } from "@/lib/partners/drafts";
import { getPartnerSession, isStaffSession } from "@/lib/partners/session";
import { describeTerms } from "@/lib/partners/pricing";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "بوابة الشركات — ترافليون",
  description: "دخول الشركات المتعاونة، أو تقديم طلب شراكة.",
};

/**
 * `/b2b` — the front door, and the one page that decides who you are.
 *
 * Three answers, and each of them is an answer rather than a dead end:
 *   a partner   → their portal
 *   an employee → this is the partner door; here is yours
 *   anyone else → sign in, or apply
 *
 * It renders its own page rather than the staff shell. Before this existed the
 * URL fell through into the dashboard chrome and reported that the page did not
 * exist, which is the least useful thing to tell someone standing at a door.
 */
export default async function B2BPage() {
  const partner = await getPartnerSession();

  if (partner) {
    const files = await listPartnerFiles();
    return (
      <PartnerPortal
        partnerName={partner.partner_name}
        terms={describeTerms(partner.terms)}
        files={files}
      />
    );
  }

  if (await isStaffSession()) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#f4f8f6] px-4" dir="rtl">
        <div className="max-w-md rounded-2xl border border-[#e2ebe7] bg-white p-8 text-center">
          <h1 className="text-lg font-extrabold text-[#003c3a]">هذه بوابة الشركات المتعاونة</h1>
          <p className="mt-2 text-[13px] font-semibold text-[#557d78]">
            حسابك حساب موظف — الشركات تدخل من هنا بحساباتها الخاصة، وأنت تديرها من قسم الشركات
            المتعاونة.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link
              href="/partner-companies"
              className="inline-flex h-10 items-center rounded-[10px] bg-[#185045] px-4 text-[12.5px] font-bold text-white hover:bg-[#0f4439]"
            >
              قسم الشركات المتعاونة
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex h-10 items-center rounded-[10px] border border-[#dbe6e1] px-4 text-[12.5px] font-bold text-[#557d78] hover:bg-[#f4f8f6]"
            >
              لوحة التحكم
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[#f4f8f6] px-4 py-10" dir="rtl">
      <header className="mb-6 text-center">
        <h1 className="text-2xl font-extrabold text-[#003c3a]">بوابة الشركات — ترافليون</h1>
        <p className="mt-2 text-[13px] font-semibold text-[#557d78]">
          ابنِ بكجاتك بهوية شركتك، بأسعارنا وشروطك.
        </p>
      </header>
      <PartnerSignIn />
    </main>
  );
}
