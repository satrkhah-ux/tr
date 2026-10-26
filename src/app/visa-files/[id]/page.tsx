import { TraveliunShell } from "@/components/traveliun/TraveliunShell";
import { VisaFilePage } from "@/components/traveliun/visa-files/VisaFilePage";
import { getVisaBoard, getVisaFile } from "@/lib/data/visa-files";
import { teletelConversationUrl } from "@/lib/providers/teletel";
import { guardPath } from "@/lib/roles/current";
import { settle } from "@/lib/visa-files/ui";

export const dynamic = "force-dynamic";

/**
 * /visa-files/[id] — one visa file. A failed read (no such file, no right to it, the data layer not ready) reaches the
 * screen as its own message with a retry, never as a crashed page; the colleagues list may fail without closing it.
 */
export default async function VisaFileRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await guardPath("/visa-files");
  const [initial, people] = await Promise.all([
    settle(() => getVisaFile(id)),
    settle(() => getVisaBoard({ limit: 1 })).then((r) => (r.ok ? r.board.people.map((p) => ({ id: p.id, name: p.name })) : [])),
  ]);
  let teletelUrl: string | null = null;
  if (initial.ok && initial.file.conversationId !== null) {
    try {
      teletelUrl = teletelConversationUrl(initial.file.conversationId);
    } catch {
      teletelUrl = null;
    }
  }
  return (
    <TraveliunShell title="nav.visaBoard">
      <VisaFilePage id={id} initial={initial} people={people} teletelUrl={teletelUrl} />
    </TraveliunShell>
  );
}
