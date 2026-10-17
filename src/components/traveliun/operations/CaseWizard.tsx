"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import type { TranslationKey } from "@/lib/i18n";
import { seedBookingsFromOffer } from "@/lib/data/operation-seed";
import { seedTravelersFromOffer } from "@/lib/data/operation-travelers";
import { issueDocument, type OperationBooking, type OperationDocument } from "@/lib/data/operation-bookings";
import { ensureClientLink } from "@/lib/data/operation-hub";
import type { SupplierWork } from "@/lib/data/supplier-work";
import { currentStep, wizardSteps, type WizardStepKey } from "@/lib/operations/wizard";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { useSafeTransition } from "../useSafeTransition";

/**
 * «من التأكيد إلى السفر» (operations order 11, suggestion 1): six steps across
 * the top of a case, each read from what the case holds, and the one action
 * that moves it — pull, create the travellers, issue the documents and the
 * link in a click; assigning, sending and confirming jump to their panel.
 */

const STEPS: WizardStepKey[] = ["pull", "travelers", "assign", "requests", "confirm", "documents"];
const ANCHOR: Partial<Record<WizardStepKey, string>> = { assign: "bookings", requests: "suppliers", confirm: "bookings" };

export function CaseWizard({
  operationId,
  bookings,
  travelers,
  documents,
  clientToken,
  supplierWork,
  hasDays,
}: {
  operationId: string;
  bookings: OperationBooking[];
  travelers: number;
  documents: OperationDocument[];
  clientToken: string | null;
  supplierWork?: SupplierWork | null;
  hasDays: boolean;
}) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [pending, run] = useSafeTransition();
  const [error, setError] = useState<string | null>(null);

  const steps = wizardSteps({
    bookings: bookings.map((b) => ({ id: b.id, kind: b.kind, status: b.status, assignee_kind: b.assignee_kind, assigned_at: b.assigned_at })),
    travelers,
    documents,
    clientToken,
    requests: (supplierWork?.bookings ?? []).map((r) => ({ booking_id: r.booking_id, state: r.state })),
  });
  const now = currentStep(steps);

  /** the client's documents for what is confirmed, then the link that carries them */
  async function issueAll(): Promise<TranslationKey | null> {
    const confirmed = bookings.filter((b) => b.status === "confirmed");
    for (const h of confirmed.filter((b) => b.kind === "hotel")) {
      const res = await issueDocument({ operation_id: operationId, kind: "hotel_voucher", booking_id: h.id });
      if (!res.ok) return res.error;
    }
    if (confirmed.some((b) => b.kind === "flight")) {
      const res = await issueDocument({ operation_id: operationId, kind: "flight_ticket" });
      if (!res.ok) return res.error;
    }
    if (hasDays) {
      const res = await issueDocument({ operation_id: operationId, kind: "itinerary" });
      if (!res.ok) return res.error;
    }
    const link = await ensureClientLink(operationId);
    return link.ok ? null : link.error;
  }

  const act = (fn: () => Promise<TranslationKey | null>) =>
    run(async () => {
      setError(null);
      const failed = await fn();
      if (failed) setError(t(failed));
      else router.refresh();
    });

  if (!now) return null;
  return (
    <section className="rounded-2xl border border-[#cfe0d9] bg-[#f6fbf9] p-4">
      <ol className="flex flex-wrap items-center gap-1.5">
        {STEPS.map((key, i) => {
          const step = steps.find((s) => s.key === key)!;
          const here = now.key === key;
          return (
            <li key={key} className="flex items-center gap-1.5">
              <span
                className={`inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11.5px] font-bold ${
                  step.done ? "bg-[#e1f3e9] text-[#0f7a52]" : here ? "bg-[#185045] text-white" : "bg-white text-[#93aaa3]"
                }`}
              >
                {step.done ? <Check className="size-3.5" /> : <span className="tv-tnum">{i + 1}</span>}
                {t(`ops.wiz.${key}` as TranslationKey)}
              </span>
              {i < STEPS.length - 1 ? <span className="text-[#cfe0d9]">←</span> : null}
            </li>
          );
        })}
      </ol>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-[12.5px] font-bold text-[#0f3d38]">
          {t(`ops.wiz.hint.${now.key}` as TranslationKey, { n: String(now.left) })}
        </p>
        {now.key === "pull" ? (
          <ActionButton pending={pending} onClick={() => act(async () => { const r = await seedBookingsFromOffer(operationId); return r.ok ? null : r.error; })} label={t("ops.wiz.do.pull")} />
        ) : now.key === "travelers" ? (
          <ActionButton pending={pending} onClick={() => act(async () => { const r = await seedTravelersFromOffer(operationId); return r.ok ? null : r.error; })} label={t("ops.wiz.do.travelers")} />
        ) : now.key === "documents" ? (
          <ActionButton pending={pending} onClick={() => act(issueAll)} label={t("ops.wiz.do.documents")} />
        ) : ANCHOR[now.key] ? (
          <a href={`#${ANCHOR[now.key]}`} className="inline-flex h-9 items-center rounded-[9px] border border-[#185045] px-3 text-[12px] font-bold text-[#185045]">
            {t("ops.wiz.go")}
          </a>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-[12px] font-bold text-[#c22850]">{error}</p> : null}
    </section>
  );
}

function ActionButton({ pending, onClick, label }: { pending: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" disabled={pending} onClick={onClick} className="inline-flex h-9 items-center gap-1.5 rounded-[9px] bg-[#185045] px-3 text-[12px] font-bold text-white disabled:opacity-60">
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
    </button>
  );
}
