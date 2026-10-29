"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { setPdfCover } from "@/lib/data/file-status";
import type { CoverStyle } from "@/components/offer-doc/cover-image";
import { useBasicLabels } from "./basic/labels";

/**
 * «غلاف الملف: أساسي / فني» — the first page of the client's PDF and link. Kept on the offer when picked, so the
 * link, the PDF, the WhatsApp send and a re-issue all carry it. The two words are for the employee only: the
 * client's PDF and page never print them. `preview` adds the first page, drawn live, beside the choice.
 */
export function CoverChoice({
  draftId,
  serial,
  value,
  onChange,
  preview = false,
}: {
  draftId: string;
  serial: string;
  value: CoverStyle;
  onChange: (cover: CoverStyle) => void;
  preview?: boolean;
}) {
  const tx = useBasicLabels();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState<string | null>(null);
  const src = `/offer/${serial}/cover?c=${value === "designed" ? "d" : "b"}`;

  async function pick(next: CoverStyle) {
    if (next === value || busy) return;
    setBusy(true);
    setError(false);
    try {
      const r = await setPdfCover(draftId, next);
      if (r.ok) onChange(r.cover);
      else setError(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-start gap-3">
      <div role="radiogroup" aria-label={tx("coverChoice")} className="flex flex-wrap items-center gap-2 text-[12px] font-bold text-[#185045]">
        <span>{tx("coverChoice")}:</span>
        {(["basic", "designed"] as const).map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={value === c}
            disabled={busy}
            onClick={() => void pick(c)}
            className={`h-8 rounded-full border px-3.5 text-[12px] font-bold disabled:opacity-60 ${value === c ? "border-[#185045] bg-[#185045] text-white" : "border-[#cfe0d9] bg-white text-[#557d78] hover:bg-[#f0f7f4]"}`}
          >
            {tx(c === "basic" ? "coverBasic" : "coverDesigned")}
          </button>
        ))}
        {busy ? <Loader2 className="size-4 animate-spin" /> : null}
        {error ? <span className="text-[11.5px] text-[#c43d3d]">{tx("fileErr_failed")}</span> : null}
      </div>
      {preview ? (
        <div className="relative h-[170px] w-[120px] shrink-0 overflow-hidden rounded-[6px] border border-[#cfe0d9] bg-[#f0f7f4]">
          {loaded !== src ? <Loader2 className="absolute inset-0 m-auto size-5 animate-spin text-[#7a948f]" /> : null}
          {/* eslint-disable-next-line @next/next/no-img-element -- a generated page picture, not an asset */}
          <img key={src} src={src} alt={tx("coverChoice")} onLoad={() => setLoaded(src)} className="size-full object-cover object-top" />
        </div>
      ) : null}
    </div>
  );
}
