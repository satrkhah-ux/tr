import { redirect } from "next/navigation";
import { movedTo } from "@/lib/nav/consolidated";

/** «خدمة العملاء» went with the menu consolidation (the owner, 2026-10-19); care_tickets is kept, unlisted. */
export default function CustomersCarePage() {
  redirect(movedTo("/customers-care") ?? "/clients");
}
