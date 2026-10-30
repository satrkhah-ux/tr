"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileText, Loader2, Plane, Trash2, UserRound, Wand2 } from "lucide-react";
import { DirText } from "@/components/DirText";
import { EmptyState } from "@/components/ui/EmptyState";
import { createRepackage, deleteRepackage, type RepackageSummary } from "@/lib/data/repackage";
import { hasCustomer, stageHref, type RepackageCustomer } from "@/lib/repackage/repackage-types";
import { TraveliunShell } from "../TraveliunShell";
import { useTraveliunUI } from "../TraveliunUIProvider";
import { RepackageClientFields } from "./RepackageClientFields";

/** /repackage — imported supplier programs; resumes exactly where it left off. */
export function RepackageList({ imports }: { imports: RepackageSummary[] }) {
  const router = useRouter();
  const { t } = useTraveliunUI();
  const [creating, setCreating] = useState(false);
  // «ابدأ» first asks who the file is for — the same fields Basic asks with
  const [asking, setAsking] = useState(false);
  const [customer, setCustomer] = useState<RepackageCustomer>({ customer_name: "", customer_phone: "" });
  const [deleting, setDeleting] = useState<string | null>(null);
  const [rows, setRows] = useState(imports);
  const [error, setError] = useState<string | null>(null);

  async function onCreate() {
    if (creating) return;
    setCreating(true);
    setError(null);
    const result = await createRepackage(customer);
    if (!result.ok) {
      setError(t(result.error));
      setCreating(false);
      return;
    }
    router.push(stageHref(result.id, "import"));
  }

  async function onDelete(id: string) {
    setDeleting(id);
    const result = await deleteRepackage(id);
    setDeleting(null);
    if (result.ok) setRows((current) => current.filter((row) => row.id !== id));
    else if (result.error) setError(t(result.error));
  }

  return (
    <TraveliunShell title="nav.repackage">
      <div className="tv-fade-up space-y-4">
        <section className="tv-card flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-5 py-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
          <div>
            <h1 className="text-lg font-extrabold text-[#003c3a]">{t("rp.title")}</h1>
            <p className="mt-1 text-[12.5px] font-semibold text-tv-text-faint">{t("rp.subtitle")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* a ticket the client already holds, re-set in our identity — no supplier, no price */}
            <Link
              href="/repackage/flight-card"
              className="inline-flex h-11 items-center gap-2 rounded-[11px] border border-[#185045] px-5 text-sm font-bold text-[#185045] transition-colors hover:bg-[#f0f7f4]"
            >
              <Plane className="size-4" />
              {t("fc.open")}
            </Link>
            <button
              type="button"
              onClick={() => setAsking((v) => !v)}
              aria-expanded={asking}
              disabled={creating}
              className="inline-flex h-11 items-center gap-2 rounded-[11px] bg-[#185045] px-5 text-sm font-bold text-white transition-colors hover:bg-[#0f4439] disabled:opacity-70"
            >
              <Wand2 className="size-4" />
              {t("rp.new")}
            </button>
          </div>
        </section>

        {asking ? (
          <section className="rounded-2xl border border-[#cfe3db] bg-[#f6faf8] px-5 py-4">
            <h2 className="text-[14px] font-extrabold text-[#003c3a]">{t("rp.start.title")}</h2>
            <p className="mb-3 mt-0.5 text-[12px] font-semibold text-[#557d78]">{t("rp.start.hint")}</p>
            <RepackageClientFields customer={customer} onChange={setCustomer} />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void onCreate()}
                disabled={creating}
                className="tv-btn-primary inline-flex h-10 items-center gap-2 rounded-[10px] px-5 text-[13px] font-bold transition-colors disabled:opacity-70"
              >
                {creating ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                {creating ? t("pg.creating") : hasCustomer(customer) ? t("rp.start.go") : t("rp.start.goNoClient")}
              </button>
              {!hasCustomer(customer) ? <span className="text-[11.5px] font-semibold text-[#a86a10]">{t("rp.start.laterNote")}</span> : null}
            </div>
          </section>
        ) : null}

        {error ? (
          <p role="alert" className="rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] px-4 py-3 text-[13px] font-semibold text-[#c22850]">{error}</p>
        ) : null}

        {rows.length === 0 ? (
          <section className="tv-card rounded-2xl border shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
            <EmptyState icon={FileText} title={t("rp.empty")} description={t("rp.subtitle")} />
          </section>
        ) : (
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((row) => (
              <article key={row.id} className="tv-card flex flex-col justify-between rounded-[14px] border p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[0_8px_22px_rgba(0,60,58,0.09)]">
                <div>
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <h2 className="min-w-0 truncate text-[15px] font-extrabold text-[#185045]">{row.title || t("rp.untitled")}</h2>
                    {row.produced_serial ? (
                      <span className="shrink-0 rounded-full bg-[#e4f6ef] px-2.5 py-0.5 text-[10.5px] font-bold text-[#10966b]">{t("rp.produced")}</span>
                    ) : null}
                  </div>
                  {/* whose it is — the client it is filed under, or a plain «بلا عميل» that the issue will ask for */}
                  <p className={`flex items-center gap-1.5 text-[12.5px] font-bold ${row.customer_name ? "text-[#185045]" : "text-[#a86a10]"}`}>
                    <UserRound className="size-3.5 shrink-0" />
                    <span className="min-w-0 truncate">{row.customer_name ?? t("rp.noClient")}</span>
                  </p>
                  {row.destination ? <p className="text-[12.5px] font-semibold text-[#557d78]">{row.destination}</p> : null}
                  {row.supplier_name ? <p className="text-[11.5px] font-semibold text-tv-text-faint">{t("rp.supplier")}: {row.supplier_name}</p> : null}
                  <p className="tv-tnum mt-1.5 text-[11px] text-tv-text-faint">{t("pg.lastUpdated")}: <DirText dir="ltr">{row.updated_at.slice(0, 16).replace("T", " ")}</DirText></p>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <Link href={stageHref(row.id, "import")} className="inline-flex h-10 flex-1 items-center justify-center rounded-[10px] bg-[#185045] px-4 text-[13px] font-bold text-white transition-colors hover:bg-[#0f4439]">{t("rp.continue")}</Link>
                  <button type="button" onClick={() => void onDelete(row.id)} disabled={deleting === row.id} aria-label={t("rp.delete")} className="inline-flex size-10 items-center justify-center rounded-[10px] border border-[#f2c7c7] text-[#c43d3d] transition-colors hover:bg-[#fff1f1] disabled:opacity-60">
                    {deleting === row.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  </button>
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
    </TraveliunShell>
  );
}
