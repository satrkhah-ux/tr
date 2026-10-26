import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { VisaNewFile } from "@/components/traveliun/visa-files/VisaNewFile";
import { getVisaBoard } from "@/lib/data/visa-files";
import { guardPath } from "@/lib/roles/current";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { settle } from "@/lib/visa-files/ui";

export const dynamic = "force-dynamic";

/**
 * /visa-files/new — «ملف تأشيرة جديد». The country list is the countries table's; the assignee list is the visa
 * department's people (what the board knows). Either may fail without closing the page: the country is then typed,
 * and the assignee left to the server's default.
 */
export default async function NewVisaFilePage() {
  await guardPath("/visa-files");
  const [countries, people] = await Promise.all([
    (async () => {
      try {
        const db = await createSupabaseServerClient();
        const { data } = await db.from("countries").select("id, arabic_name").eq("status", "Active").order("arabic_name");
        return ((data ?? []) as { id: string; arabic_name: string | null }[]).filter((c) => c.arabic_name).map((c) => ({ id: c.id, name: c.arabic_name as string }));
      } catch {
        return [];
      }
    })(),
    settle(() => getVisaBoard({ limit: 1 })).then((r) => (r.ok ? r.board.people.map((p) => ({ id: p.id, name: p.name })) : [])),
  ]);
  return (
    <TraveliunShell title="nav.visaNew">
      <VisaNewFile countries={countries} people={people} />
    </TraveliunShell>
  );
}
