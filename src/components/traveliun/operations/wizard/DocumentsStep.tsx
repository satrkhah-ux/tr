"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, ExternalLink, Loader2, PhoneCall } from "lucide-react";
import { DirText } from "@/components/DirText";
import type { TranslationKey } from "@/lib/i18n";
import { issueDocument } from "@/lib/data/operation-bookings";
import { documentPlan, dueDocuments } from "@/lib/operations/wizard/documents";
import type { StepProps, WizardCase } from "@/lib/operations/wizard/types";
import { ClientLinkBlock } from "../DocumentsPanel";
import { ClientSend } from "../ClientSend";
import { useTraveliunUI } from "../../TraveliunUIProvider";

/**
 * Step 6 — «المستندات والإرسال»: no button per document. Each line says it is
 * out (open it), on its way, or what it still waits for. The server issues
 * each one the moment its data is final (wizard-sync.ts, after every
 * confirmation); AutoIssue — mounted by the shell — is the fallback for what
 * is still due when the case opens, and says why a refused one was refused.
 * Then the client's one link, the message to the client, and the destination's
 * emergency numbers that link shows.
 */
export function DocumentsStep({ data }: StepProps) {
  const { t } = useTraveliunUI();
  const plan = documentPlan(data);
  const g = data.guide;
  const contacts = g
    ? ([
        ["wz.doc.guide.agent", [g.local_agent_name, g.local_agent_phone].filter(Boolean).join(" — ")],
        ["wz.doc.guide.embassy", g.embassy_phone],
        ["wz.doc.guide.ambulance", g.ambulance],
        ["wz.doc.guide.police", g.police],
      ] as [TranslationKey, string | null][]).filter(([, v]) => v)
    : [];

  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {plan.map((l) => (
          <li key={`${l.kind}:${l.booking_id ?? ""}`} className="flex flex-wrap items-center gap-2 rounded-[11px] border border-[#e2ebe7] px-3 py-2.5">
            {l.state === "issued" ? (
              <CheckCircle2 className="size-4 shrink-0 text-[#0f7a52]" />
            ) : l.state === "due" ? (
              <Loader2 className="size-4 shrink-0 animate-spin text-[#185045]" />
            ) : (
              <Clock className="size-4 shrink-0 text-[#a86a10]" />
            )}
            <span className="min-w-0 flex-1 text-[12.5px] font-extrabold text-[#0f3d38]">
              {t(`ops.doc.${l.kind}` as TranslationKey)}
              {l.title ? <span className="ms-1.5 font-bold text-[#557d78]">{l.title}</span> : null}
              <span className={`ms-2 text-[11.5px] font-bold ${l.state === "waiting" ? "text-[#a86a10]" : "text-[#93aaa3]"}`}>
                {l.state === "waiting" ? t(`wz.doc.why.${l.why}` as TranslationKey) : t(`wz.doc.${l.state}` as TranslationKey)}
              </span>
            </span>
            {l.token ? (
              <a href={`/voucher/${l.token}/pdf`} target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-1.5 rounded-[8px] bg-[#185045] px-3 text-[11.5px] font-bold text-white hover:bg-[#0f4439]">
                <ExternalLink className="size-3.5" />
                {t("ops.doc.open")}
              </a>
            ) : null}
          </li>
        ))}
      </ul>

      <ClientLinkBlock operationId={data.operation.id} token={data.clientToken} />

      {/* a partner's client hears from the partner, never from us */}
      {data.operation.partner_name ? null : <ClientSend operationId={data.operation.id} />}

      <div className="rounded-[12px] border border-[#e2ebe7] bg-[#f8fbf9] p-3">
        <p className="flex items-center gap-1.5 text-[12.5px] font-extrabold text-[#185045]">
          <PhoneCall className="size-4" />
          {t("wz.doc.guide.title", { country: g?.country ?? data.operation.destination ?? "—" })}
        </p>
        {contacts.length ? (
          <ul className="mt-1.5 grid gap-1 text-[12px] font-bold text-[#0f3d38] sm:grid-cols-2">
            {contacts.map(([key, value]) => (
              <li key={key}>
                <span className="text-[#93aaa3]">{t(key)}: </span>
                <DirText>{value}</DirText>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[11.5px] font-semibold text-[#a86a10]">{t("wz.doc.guide.none")}</p>
        )}
      </div>
    </div>
  );
}

/**
 * The fallback: what is STILL due when the case opens — normally nothing, the
 * server issued it with the confirmation — once per page load each. A refused
 * one (a hotel without its English name …) is said here and tried again on
 * the next visit, never in a loop. Issuing is idempotent (document-issue.ts):
 * this racing the server, or a colleague, never puts out a second identical
 * version. The client's link is the server's to mint, with the first client
 * document (wizard-sync.ts) — never here: a link someone stopped stays stopped.
 */
export function AutoIssue({ data }: { data: WizardCase }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const tried = useRef(new Set<string>());
  const [errors, setErrors] = useState<string[]>([]);
  const [waits, setWaits] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const keyOf = (l: { kind: string; booking_id: string | null }) => `${l.kind}:${l.booking_id ?? ""}`;
  // what is due now, by name — the effect runs when that changes (after each refresh)
  const work = dueDocuments(data).map(keyOf).join("|");

  useEffect(() => {
    // claimed before the first await: a second run of this effect (React's dev double-run, a quick refresh) finds nothing left
    const due = dueDocuments(data).filter((l) => !tried.current.has(keyOf(l)));
    if (due.length === 0) return;
    due.forEach((l) => tried.current.add(keyOf(l)));
    void (async () => {
      setBusy(true);
      const failed: string[] = [];
      const held: string[] = [];
      for (const l of due) {
        const res = await issueDocument({ operation_id: data.operation.id, kind: l.kind, booking_id: l.booking_id }).catch(() => null);
        // a hotel's data is the data team's — said as news, not as the agent's error (the owner, 2026-10-23)
        if (res && !res.ok) (res.waiting ? held : failed).push(`${t(`ops.doc.${l.kind}` as TranslationKey)}${l.title ? ` (${l.title})` : ""}: ${t(res.error, res.params)}`);
      }
      setErrors((e) => [...e, ...failed]);
      setWaits((w) => [...w, ...held]);
      setBusy(false);
      router.refresh();
    })();
    // `work` names exactly what is due; the lists it came from are re-read on the refresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work]);

  if (!busy && errors.length === 0 && waits.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {busy || errors.length ? (
        <div className={`rounded-[11px] px-3 py-2 text-[12px] font-bold ${errors.length ? "bg-[#fdecef] text-[#c22850]" : "bg-[#eef4f1] text-[#185045]"}`}>
          {busy ? (
            <p className="flex items-center gap-1.5">
              <Loader2 className="size-3.5 animate-spin" />
              {t("wz.doc.issuing")}
            </p>
          ) : null}
          {errors.map((e, i) => (
            <p key={i}>{e}</p>
          ))}
        </div>
      ) : null}
      {waits.length ? (
        <div className="rounded-[11px] bg-[#eef4f1] px-3 py-2 text-[12px] font-semibold text-[#557d78]">
          {waits.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
