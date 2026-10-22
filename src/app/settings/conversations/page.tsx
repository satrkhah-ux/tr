import { redirect } from "next/navigation";
import { ConversationsAdmin } from "@/components/traveliun/settings/ConversationsAdmin";
import { getConversationsAdmin } from "@/lib/data/conversation-settings";
import { guardPath } from "@/lib/roles/current";

export const dynamic = "force-dynamic";

/** «الإدارة ← إدارة المحادثات» — when Teletel conversations close, and who closed what (settings.manage). */
export default async function ConversationsPage() {
  await guardPath("/settings/conversations");
  const data = await getConversationsAdmin();
  if (!data) redirect("/dashboard");
  return <ConversationsAdmin initial={data} />;
}
