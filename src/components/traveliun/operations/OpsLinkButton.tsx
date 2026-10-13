"use client";

import { useState } from "react";
import { Copy, ExternalLink, Link2, Loader2, XCircle } from "lucide-react";
import { ensureOpsLink, revokeOpsLink, type OpsLink } from "@/lib/data/ops-links";
import type { LinkKind } from "@/lib/operations/op-links";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { useSafeTransition } from "../useSafeTransition";

const chip =
  "inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#dbe6e1] bg-white px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f4f8f6] disabled:opacity-60";

const PATH: Record<LinkKind, string> = { supplier: "/supplier-link/", driver: "/driver-day/" };
const riyadh = (iso: string) => new Date(iso).toLocaleString("sv-SE", { timeZone: "Asia/Riyadh" }).slice(0, 16);

/**
 * «رابط المورد» / «رابط السائق» (operations order 11): mint — or fetch the one
 * already open — copy it, open it, stop it. The same open link comes back on
 * every press, so the one already sent keeps working.
 */
export function OpsLinkButton({ kind, bookingId }: { kind: LinkKind; bookingId: string }) {
  const { t } = useTraveliunUI();
  const [pending, run] = useSafeTransition();
  const [link, setLink] = useState<OpsLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const urlOf = (l: OpsLink) => `${window.location.origin}${PATH[kind]}${l.token}`;

  const copy = (url: string) =>
    navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      },
      () => undefined,
    );

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          link
            ? setLink(null)
            : run(async () => {
                setError(null);
                const res = await ensureOpsLink(kind, bookingId);
                if (!res.ok) return setError(t(res.error));
                setLink(res.link);
                void copy(urlOf(res.link));
              })
        }
        className={chip}
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
        {t(kind === "supplier" ? "ops.link.supplier" : "ops.link.driver")}
      </button>
      {error ? <p className="w-full text-[11.5px] font-bold text-[#c22850]">{error}</p> : null}
      {link ? (
        <div className="w-full rounded-[9px] border border-[#d6eadf] bg-[#f8fbf9] p-2.5">
          <p className="mb-1.5 text-[11px] font-semibold text-[#557d78]">
            {t(kind === "supplier" ? "ops.link.supplier.hint" : "ops.link.driver.hint")} · {t("ops.link.expires", { at: riyadh(link.expires_at) })}
          </p>
          <input
            readOnly
            dir="ltr"
            value={urlOf(link)}
            onFocus={(e) => e.currentTarget.select()}
            className="mb-2 h-9 w-full rounded-[8px] border border-[#dbe6e1] bg-white px-2.5 text-[12px] text-[#185045]"
          />
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => void copy(urlOf(link))} className={chip}>
              <Copy className="size-3.5" />
              {copied ? t("copied") : t("copy")}
            </button>
            <a href={urlOf(link)} target="_blank" rel="noopener" className={chip}>
              <ExternalLink className="size-3.5" />
              {t("ops.link.open")}
            </a>
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  setError(null);
                  const res = await revokeOpsLink(link.id);
                  if (!res.ok) setError(t(res.error));
                  else setLink(null);
                })
              }
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#f2c7c7] bg-white px-2.5 text-[11.5px] font-bold text-[#c43d3d] hover:bg-[#fff1f1] disabled:opacity-60"
            >
              <XCircle className="size-3.5" />
              {t("ops.link.revoke")}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
