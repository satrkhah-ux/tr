"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import type { OperationCard } from "@/lib/data/operations";
import type { UnlinkedEmail } from "@/lib/data/reservation-mail-actions";
import { dismissEmail, linkEmailToOperation } from "@/lib/data/reservation-mail-actions";
import type { TranslationKey } from "@/lib/i18n";
import { SuggestInput } from "../SuggestInput";
import { useTraveliunUI } from "../TraveliunUIProvider";

/**
 * «بريد بلا ملف» — the quiet card at the bottom of the operations board:
 * supplier emails the reader could not match. Each row says who wrote and
 * about what; the picker (UploadPicker's pattern) files it on its case, and
 * «تجاهل» drops a newsletter. Renders nothing when there is nothing.
 */
export function UnlinkedMail({ emails, operations }: { emails: UnlinkedEmail[]; operations: OperationCard[] }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const label = (op: OperationCard) => `${op.customer_name || "—"} · ${op.serial}`;
  const byLabel = useMemo(() => new Map(operations.map((op) => [label(op), op.id])), [operations]);
  if (emails.length === 0) return null;

  const act = (work: () => Promise<unknown>) => startTransition(async () => { await work(); router.refresh(); });

  return (
    <section className="rounded-2xl border border-[#e2ebe7] bg-white px-4 py-3 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
      <h2 className="flex items-center gap-2 text-[14px] font-extrabold text-[#003c3a]">
        <Mail className="size-4 text-[#557d78]" />
        {t("ops.mail.title", { n: emails.length })}
      </h2>
      <ul className="mt-2 divide-y divide-[#eef4f1]">
        {emails.map((mail) => (
          <MailRow key={mail.id} mail={mail} operations={operations} byLabel={byLabel} disabled={pending} onLink={(id) => act(() => linkEmailToOperation(mail.id, id))} onDismiss={() => act(() => dismissEmail(mail.id))} />
        ))}
      </ul>
    </section>
  );
}

function MailRow({
  mail,
  operations,
  byLabel,
  disabled,
  onLink,
  onDismiss,
}: {
  mail: UnlinkedEmail;
  operations: OperationCard[];
  byLabel: Map<string, string>;
  disabled: boolean;
  onLink: (operationId: string) => void;
  onDismiss: () => void;
}) {
  const { t } = useTraveliunUI();
  const [value, setValue] = useState("");
  const kindKey = `ops.mail.kind.${mail.kind ?? "other"}` as TranslationKey;
  return (
    <li className="flex flex-wrap items-center gap-2 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-bold text-[#185045]">{mail.subject || "—"}</p>
        <p className="truncate text-[11.5px] font-semibold text-tv-text-faint" dir="ltr">{mail.from_address || "—"}</p>
      </div>
      <span className="shrink-0 rounded-full border border-[#dbe6e1] bg-[#f6faf8] px-2 py-0.5 text-[10.5px] font-bold text-[#557d78]">{t(kindKey)}</span>
      <div className="w-64 max-w-full">
        <SuggestInput
          value={value}
          items={operations.map((op) => ({ value: `${op.customer_name || "—"} · ${op.serial}`, hint: op.destination ?? undefined, keywords: `${op.serial} ${op.customer_name ?? ""}` }))}
          onChange={(next, picked) => {
            setValue(next);
            const id = byLabel.get(next);
            if (picked && id && !disabled) onLink(id);
          }}
          placeholder={t("ops.mail.pickHint")}
          ariaLabel={t("ops.mail.pickHint")}
          className="h-9 w-full rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-[12.5px] text-[#185045] outline-none focus-visible:ring-2 focus-visible:ring-tv-action-focus focus:border-[#2aa87a]"
        />
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={onDismiss}
        className="h-9 shrink-0 rounded-[10px] border border-[#dbe6e1] bg-white px-3 text-[12px] font-bold text-[#8a6100] hover:bg-[#fdf8e6] disabled:opacity-50 max-sm:min-h-10"
      >
        {t("ops.mail.dismiss")}
      </button>
    </li>
  );
}
