import { redirect } from "next/navigation";
import { ScreensAdmin } from "@/components/traveliun/settings/ScreensAdmin";
import { getScreensAdmin } from "@/lib/data/office-screens";
import { guardPath } from "@/lib/roles/current";

/** «الإدارة ← الشاشات» — the office screens, for settings.manage (the owner, 2026-10-19). */
export default async function ScreensPage() {
  await guardPath("/settings/screens");
  const cfg = await getScreensAdmin();
  if (!cfg) redirect("/dashboard");
  return <ScreensAdmin initial={cfg} />;
}
