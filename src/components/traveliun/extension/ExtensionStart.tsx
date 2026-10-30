"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FilePlus2, Loader2 } from "lucide-react";
import { startProgramme } from "@/lib/data/leads";
import { TraveliunShell } from "../TraveliunShell";

/** One press: the client's file — theirs already, or a new one with their name and number. */
export function ExtensionStart({ lead }: { lead: { id: string; name: string; phone: string; destination: string; hasFile: boolean } | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function start() {
    if (!lead) return;
    setBusy(true);
    setError(false);
    try {
      const r = await startProgramme(lead.id);
      if (r.ok && r.draftId) return router.push(`/basic/${r.draftId}`);
      setError(true);
    } catch {
      setError(true);
    }
    setBusy(false);
  }

  return (
    <TraveliunShell title="nav.extension">
      <div className="mx-auto max-w-xl p-4">
        <section className="tv-card rounded-[14px] border p-5">
          {lead ? (
            <>
              <p className="text-[12px] font-bold text-tv-text-faint">عميل المحادثة</p>
              <p className="mt-1 text-lg font-extrabold text-[#003c3a]">{lead.name || "عميل"}</p>
              <p className="tv-tnum text-[13px] font-semibold text-[#557d78]" dir="ltr">
                {lead.phone}
              </p>
              {lead.destination ? <p className="mt-1 text-[13px] font-semibold text-[#557d78]">الوجهة: {lead.destination}</p> : null}
              <button
                type="button"
                onClick={() => void start()}
                disabled={busy}
                className="tv-btn-primary mt-4 inline-flex h-11 items-center gap-2 rounded-[11px] px-5 text-[13.5px] font-extrabold disabled:opacity-60"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <FilePlus2 className="size-4" />}
                {lead.hasFile ? "افتح ملف العميل" : "ابدأ عرضاً جديداً لهذا العميل"}
              </button>
              {error ? <p className="mt-3 text-[13px] font-bold text-[#c43d3d]">تعذّر فتح الملف — حاول مرة أخرى.</p> : null}
            </>
          ) : (
            <>
              <p className="text-[14px] font-extrabold text-[#003c3a]">لا سجل لهذه المحادثة في «العملاء» بعد</p>
              <p className="mt-1 text-[12.5px] font-semibold text-tv-text-faint">تُسحب المحادثات الجديدة كل دقيقتين — أعد المحاولة بعد قليل، أو ابدأ ملفاً فارغاً.</p>
              <Link href="/basic?new=1" className="mt-4 inline-flex h-11 items-center gap-2 rounded-[11px] border border-[#185045] px-5 text-[13.5px] font-extrabold text-[#185045]">
                <FilePlus2 className="size-4" />
                ملف جديد
              </Link>
            </>
          )}
        </section>
      </div>
    </TraveliunShell>
  );
}
