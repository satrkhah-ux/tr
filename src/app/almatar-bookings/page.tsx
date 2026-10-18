import { AlmatarAdmin } from "@/components/traveliun/almatar/AlmatarAdmin";
import { getAlmatarCompany, getMarginPct, listAlmatarLogins, listAllBookings, listServices } from "@/lib/almatar/server";
import { currentCan, guardPath } from "@/lib/roles/current";

export const dynamic = "force-dynamic";

/**
 * «حجوزات المطار» — Almatar's transport bookings, confirmed by operations
 * (operations.write); the margin and the login are the administration's
 * (settings.manage). section-access.ts opens the page to either.
 */
export default async function AlmatarBookingsPage() {
  await guardPath("/almatar-bookings");
  const [ops, admin, company] = await Promise.all([currentCan("operations.write"), currentCan("settings.manage"), getAlmatarCompany()]);
  const [services, bookings, margin, logins] = await Promise.all([
    listServices(true),
    listAllBookings(),
    getMarginPct(),
    admin && company ? listAlmatarLogins(company.id) : Promise.resolve([]),
  ]);
  return <AlmatarAdmin services={services} bookings={bookings} margin={margin} logins={logins} canConfirm={ops} canAdmin={admin} hasCompany={Boolean(company)} />;
}
