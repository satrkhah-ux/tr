"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clock, ExternalLink, Loader2, PhoneCall } from "lucide-react";
import { DirText } from "@/components/DirText";
import type { TranslationKey } from "@/lib/i18n";
import { issueDocument } from "@/lib/data/operation-bookings";
import { ensureClientLink } from "@/lib/data/operation-hub";
import { documentPlan, dueDocuments } from "@/lib/operations/wizard/documents";
import type { StepProps, WizardCase } from "@/lib/operations/wizard/types";
import { CLIENT_DOCUMENT_KINDS } from "@/lib/operations/voucher-dto";
import { ClientLinkBlock } from "../DocumentsPanel";
import { ClientSend } from "../ClientSend";
import { useTraveliunUI } from "../../TraveliunUIProvider";

/**
 * Step 6 — «المستندات والإرسال»: no button per document. Each line says it is
 * out (open it), on its way, or what it still waits for; AutoIssue — mounted by
 * the shell on every step — issues the ones whose data just became final.
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
 * Issues what is due, once per page load each — a refused one (a hotel without
 * its English name …) is said here and tried again on the next visit, never in
 * a loop — then mints the client's link once a client document is out. Mounted
 * by the shell, so confirming a hotel in step 3 puts its voucher out at once.
 *
 * ponytail: two people opening the case in the same second can each issue a
 * due voucher (v1 and v2) — harmless, the link shows the latest; a lock if it bites.
 */
export function AutoIssue({ data }: { data: WizardCase }) {
  const { t } = useTraveliunUI();
  const router = useRouter();
  const tried = useRef(new Set<string>());
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const keyOf = (l: { kind: string; booking_id: string | null }) => `${l.kind}:${l.booking_id ?? ""}`;
  const hasClientDoc = data.documents.some((d) => !d.revoked_at && CLIENT_DOCUMENT_KINDS.includes(d.kind));
  // what is due now, by name — the effect runs when that changes (after each refresh)
  const work = [...dueDocuments(data).map(keyOf), ...(!data.clientToken && hasClientDoc ? ["link"] : [])].join("|");

  useEffect(() => {
    // claimed before the first await: a second run of this effect (React's dev double-run, a quick refresh) finds nothing left
    const due = dueDocuments(data).filter((l) => !tried.current.has(keyOf(l)));
    const link = !data.clientToken && hasClientDoc && !tried.current.has("link");
    if (due.length === 0 && !link) return;
    due.forEach((l) => tried.current.add(keyOf(l)));
    if (link) tried.current.add("link");
    void (async () => {
      setBusy(true);
      const failed: string[] = [];
      let clientDocOut = false;
      for (const l of due) {
        const res = await issueDocument({ operation_id: data.operation.id, kind: l.kind, booking_id: l.booking_id }).catch(() => null);
        if (res?.ok && CLIENT_DOCUMENT_KINDS.includes(l.kind)) clientDocOut = true;
        if (res && !res.ok) failed.push(`${t(`ops.doc.${l.kind}` as TranslationKey)}${l.title ? ` (${l.title})` : ""}: ${t(res.error, res.params)}`);
      }
      // the client's link carries every document; minted with the first one out (or already out)
      if (link || (!data.clientToken && clientDocOut)) {
        tried.current.add("link");
        await ensureClientLink(data.operation.id).catch(() => null);
      }
      setErrors((e) => [...e, ...failed]);
      setBusy(false);
      router.refresh();
    })();
    // `work` names exactly what is due; the lists it came from are re-read on the refresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work]);

  if (!busy && errors.length === 0) return null;
  return (
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
  );
}
