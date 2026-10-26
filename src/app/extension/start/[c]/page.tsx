import { redirect } from "next/navigation";
import { ExtensionStart } from "@/components/traveliun/extension/ExtensionStart";
import { currentCan } from "@/lib/roles/current";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * «عرض جديد لهذا العميل» from the extension's panel: the client of a Teletel
 * conversation, and one press that opens their file — the one the conversation
 * already started, else a new one with their name and number (leads.ts
 * startProgramme). A page of the signed-in system, so the press is the
 * employee's own; the extension only opens it.
 */
// the conversation in the path, not the query: a sign-in on the way keeps the path and drops the query
export default async function ExtensionStartPage({ params }: { params: Promise<{ c: string }> }) {
  if (!(await currentCan("offers.write"))) redirect("/dashboard");
  const c = Number((await params).c);
  const supabase = await createSupabaseServerClient();
  const { data } =
    Number.isSafeInteger(c) && c > 0
      ? await supabase.from("client_leads").select("id, name, phone, destination, draft_id").eq("teletel_conversation_id", c).maybeSingle()
      : { data: null };
  const lead = data as { id: string; name: string | null; phone: string | null; destination: string | null; draft_id: string | null } | null;
  return <ExtensionStart lead={lead ? { id: lead.id, name: lead.name ?? "", phone: lead.phone ?? "", destination: lead.destination ?? "", hasFile: Boolean(lead.draft_id) } : null} />;
}
