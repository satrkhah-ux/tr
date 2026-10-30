"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { DirText } from "@/components/DirText";
import { myFollowups, type Followup } from "@/lib/data/sla";
import { useSlaLabels } from "./labels";
import { useWaitText, useWhen } from "./SlaBoard";

/**
 * «لوحتي»: the follow-ups a manager handed me (data/sla.ts). Loads itself, and
 * says nothing at all when there are none — most days, for most people.
 */
export function MyFollowups() {
  const { tx, kind } = useSlaLabels();
  const wait = useWaitText();
  const when = useWhen();
  const [list, setList] = useState<Followup[]>([]);

  useEffect(() => {
    let live = true;
    myFollowups()
      .then((rows) => live && setList(rows))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (list.length === 0) return null;
  return (
    <section className="rounded-[12px] border border-[#f2c9d4] bg-[#fdf6f8] p-4">
      <h2 className="flex items-center gap-2 text-[14px] font-extrabold text-[#8a1f3c]">
        <BellRing className="size-4" />
        {tx("mineTitle")}
        <span className="tv-tnum rounded-full bg-white px-2 text-[11px]">{list.length}</span>
      </h2>
      <p className="mt-1 text-[12px] font-semibold text-[#8a5566]">{tx("mineHint")}</p>
      <ul className="mt-3 grid gap-2">
        {list.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[10px] border border-[#f2c9d4] bg-white px-3 py-2">
            <span className="min-w-[9rem] flex-1">
              <span className="block truncate text-[13px] font-bold text-[#103f37]">{f.contact_name ?? `#${f.conversation_id}`}</span>
              {f.contact_phone ? <DirText className="block text-[11px] font-semibold text-tv-text-faint">{f.contact_phone}</DirText> : null}
            </span>
            <span className="text-[11.5px] font-bold text-[#a86a10]">
              {kind(f.kind)}
              {f.waited_minutes != null ? ` · ${tx("fuWaited", { w: wait(f.waited_minutes) })}` : ""}
            </span>
            {f.assigned_at ? <span className="tv-tnum text-[11px] font-semibold text-tv-text-faint">{when(f.assigned_at)}</span> : null}
            <Link href={`/followups/${f.id}`} className="ms-auto inline-flex h-8 items-center rounded-[8px] bg-[#185045] px-3 text-[12px] font-bold text-white hover:bg-[#0f4439]">
              {tx("fuOpenThread")}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
