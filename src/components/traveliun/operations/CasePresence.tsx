"use client";

import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * «فلان يعمل على هذه الحالة الآن» (operations order 11, suggestion 10): who else
 * has this case open, live, through a Supabase Realtime presence channel — no
 * table, nothing stored; leaving the page leaves the channel. Two agents who
 * see each other here stop confirming the same booking twice.
 *
 * ponytail: presence only, no edit lock — add a per-booking lease (db acquire)
 * if two agents still collide after seeing each other.
 */
export function CasePresence({ operationId }: { operationId: string }) {
  const [others, setOthers] = useState<string[]>([]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let closed = false;

    void supabase.auth.getUser().then(({ data }) => {
      const user = data.user;
      if (!user || closed) return;
      const name = (user.user_metadata?.["full_name"] as string | undefined) || user.email?.split("@")[0] || "زميل";
      channel = supabase.channel(`op-presence:${operationId}`, { config: { presence: { key: user.id } } });
      channel
        .on("presence", { event: "sync" }, () => {
          const state = channel?.presenceState<{ name: string }>() ?? {};
          setOthers(
            Object.entries(state)
              .filter(([key]) => key !== user.id)
              .map(([, metas]) => metas[0]?.name ?? "زميل"),
          );
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") void channel?.track({ name });
        });
    });

    return () => {
      closed = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [operationId]);

  if (others.length === 0) return null;
  return (
    <div role="status" className="flex items-center gap-2 rounded-[11px] border border-[#f2e2b4] bg-[#fff8e8] px-3 py-2 text-[12.5px] font-bold text-[#8a5a0c]">
      <Users className="size-4 shrink-0" />
      يعمل على هذه الحالة الآن: {others.join("، ")} — نسّقوا قبل تأكيد الحجوزات نفسها.
    </div>
  );
}
