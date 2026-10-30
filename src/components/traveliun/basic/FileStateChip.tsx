"use client";

import type { FileState } from "@/lib/offer/file-state";
import { useBasicLabels } from "./labels";

/** Each state's colour: waiting on us (amber), with the client (blue), done steps (green), stopped (red). */
const TONE: Record<FileState, string> = {
  draft: "bg-[#f2f4f3] text-tv-text-faint",
  issued: "bg-[#fff8e8] text-[#a86a10]",
  published: "bg-[#f0f5f3] text-[#557d78]",
  sent: "bg-[#e8f3fb] text-[#1d5f8a]",
  expired: "bg-[#fdf0e6] text-[#b4540a]",
  confirmed: "bg-[#e9f7f0] text-[#0f7a52]",
  paid_partial: "bg-[#e9f7f0] text-[#0f7a52]",
  paid_full: "bg-[#dff3e8] text-[#0b6140]",
  ready: "bg-[#e0f4f4] text-[#0b6d6d]",
  travelled: "bg-[#eef1f6] text-[#41506b]",
  cancelled: "bg-[#fdeef2] text-[#c22850]",
};

/** «أُرسل للعميل · نسخة 2» — the file's state, its version (the one sent, on a sent file), and a newer version the client has not had. */
export function FileStateChip({
  state,
  version,
  sentVersion,
  stale,
  className = "",
}: {
  state: FileState;
  version?: number | null;
  sentVersion?: number | null;
  stale?: boolean;
  className?: string;
}) {
  const tx = useBasicLabels();
  const shown = state === "sent" && sentVersion ? sentVersion : version;
  return (
    <span className={`inline-flex w-fit flex-wrap items-center gap-1 ${className}`}>
      <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${TONE[state]}`}>
        {tx(`st_${state}`)}
        {shown && state !== "draft" ? ` · ${tx("versionN", { n: shown })}` : ""}
      </span>
      {stale ? <span className="rounded-full bg-[#fff8e8] px-2 py-0.5 text-[10px] font-bold text-[#a86a10]">{tx("staleSend", { n: version ?? "" })}</span> : null}
    </span>
  );
}
