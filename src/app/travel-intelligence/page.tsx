import { redirect } from "next/navigation";

/** «مركز التشغيل الذكي» merged into the home page (the owner, 2026-10-18) — an old link lands there. */
export default function TravelIntelligencePage() {
  redirect("/dashboard");
}
