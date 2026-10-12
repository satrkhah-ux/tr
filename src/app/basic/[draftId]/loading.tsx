import { Loader2 } from "lucide-react";
import { TraveliunShell } from "@/components/traveliun/TraveliunShell";

/** The file opens at once; the reference lists (every hotel, room, airport) arrive a moment later. */
export default function Loading() {
  return (
    <TraveliunShell title="nav.basic">
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-[#557d78]" />
      </div>
    </TraveliunShell>
  );
}
