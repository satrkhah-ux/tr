import { redirect } from "next/navigation";
import { movedTo } from "@/lib/nav/consolidated";

/** The old currencies screen (a static page — the rates are live in rates-actions.ts) went with the menu consolidation (the owner, 2026-10-19). */
export default function SettingsPage() {
  redirect(movedTo("/settings") ?? "/settings/pricing");
}
