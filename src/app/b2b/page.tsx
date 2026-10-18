import Link from "next/link";
import { PartnerSignIn } from "@/components/traveliun/partners/PartnerSignIn";
import { PartnerHome } from "@/components/traveliun/partners/PartnerHome";
import { getPartnerHome } from "@/lib/partners/home";
import { getMyStatement } from "@/lib/partners/ledger";
import { getPartnerSession, isStaffSession } from "@/lib/partners/session";
import { describeTerms } from "@/lib/partners/pricing";
import { currentCanOpen } from "@/lib/roles/current";
import { AlmatarPortal } from "@/components/traveliun/almatar/AlmatarPortal";
import { getAlmatarSession, listPartnerBookings, listServices } from "@/lib/almatar/server";

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
  // a transport-only partner («المطار», 0099) books its transport here and sees nothing else
  const transport = await getAlmatarSession();
  if (transport) {
    const [services, bookings] = await Promise.all([listServices(false), listPartnerBookings(transport.partner_id)]);
    return <AlmatarPortal session={transport} services={services} bookings={bookings} />;
  }

  const partner = await getPartnerSession();

  if (partner) {
    const [data, statement] = await Promise.all([getPartnerHome(), getMyStatement()]);
    return (
      <PartnerHome partnerName={partner.partner_name} terms={describeTerms(partner.terms)} data={data} statement={statement} tier={partner.tier} />
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
            {/* the administration's section (section-access.ts) — not a link that bounces the rest */}
            {(await currentCanOpen("/partner-companies")) ? (
            <Link
              href="/partner-companies"
              className="inline-flex h-10 items-center rounded-[10px] bg-[#185045] px-4 text-[12.5px] font-bold text-white hover:bg-[#0f4439]"
            >
              قسم الشركات المتعاونة
            </Link>
            ) : null}
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
