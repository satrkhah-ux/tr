import { redirect } from "next/navigation";

/**
 * The executive dashboard is now merged into the main /dashboard (executive
 * tab). Keep this route as a redirect so old links/bookmarks still work.
 */
export default function ExecutiveDashboardPage() {
  redirect("/dashboard");
}
