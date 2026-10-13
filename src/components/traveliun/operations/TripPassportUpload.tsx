"use client";

import { useState, useTransition } from "react";
import { submitClientPassport } from "@/lib/data/client-passports";
import type { ClientPassportState } from "@/lib/operations/client-passport";

const CHIP: Record<ClientPassportState, { text: string; cls: string } | null> = {
  needed: null,
  received: { text: "تم الاستلام — قيد المراجعة", cls: "bg-[#e9f7f0] text-[#0f7a52]" },
  on_file: { text: "تم الاستلام ✓", cls: "bg-[#e9f7f0] text-[#0f7a52]" },
  retake: { text: "الصورة غير واضحة — ارفع صورة أخرى", cls: "bg-[#fff8e8] text-[#a86a10]" },
};

/** One traveller's passport photo, from the client's phone. The answer is only «تم الاستلام» — nothing read is sent back. */
export function TripPassportUpload({ token, travelerId, label, state: initial }: { token: string; travelerId: string; label: string; state: ClientPassportState }) {
  const [state, setState] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const chip = CHIP[state];

  function send(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    start(async () => {
      setError(null);
      try {
        const res = await submitClientPassport(token, travelerId, fd);
        if (res.ok) setState("received");
        else setError(res.message);
      } catch {
        setError("تعذّر الرفع. حاولوا مرة أخرى.");
      }
    });
  }

  return (
    <li className="rounded-[12px] border border-[#e2ebe7] p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 break-words text-[13.5px] font-extrabold">{label}</p>
        {chip ? <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ${chip.cls}`}>{chip.text}</span> : null}
      </div>
      {state !== "on_file" ? (
        <label
          className={`mt-2.5 flex h-11 w-full cursor-pointer items-center justify-center rounded-[11px] border-2 border-dashed border-[var(--trip)] text-[13px] font-extrabold text-[var(--trip)] ${pending ? "opacity-60" : ""}`}
        >
          {pending ? "جارٍ الرفع…" : state === "needed" ? "رفع صورة الجواز" : "رفع صورة أخرى"}
          <input
            type="file"
            accept="image/*,application/pdf"
            className="sr-only"
            disabled={pending}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) send(f);
            }}
          />
        </label>
      ) : null}
      {error ? <p className="mt-2 text-[12px] font-bold text-[#c22850]">{error}</p> : null}
    </li>
  );
}
