import { TraveliunKanban } from "@/components/traveliun/TraveliunKanban";
import { guardPath } from "@/lib/roles/current";

export default async function KanbanBoardPage() {
  // a service the developer can switch off (features.ts) — a typed URL is refused too
  await guardPath("/kanban-board");
  return <TraveliunKanban />;
}
