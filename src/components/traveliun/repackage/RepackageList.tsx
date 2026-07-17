"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FilePlus2, FileText, Loader2, Trash2 } from "lucide-react";
import { DirText } from "@/components/DirText";
import { EmptyState } from "@/components/ui/EmptyState";
import { createRepackage, deleteRepackage, type RepackageSummary } from "@/lib/data/repackage";
import { stageHref } from "@/lib/repackage/repackage-types";
import { TraveliunShell } from "../TraveliunShell";
import { useTraveliunUI } from "../TraveliunUIProvider";

/** /repackage — imported supplier programs; resumes exactly where it left off. */
export function RepackageList({ imports }: { imports: RepackageSummary[] }) {
  const router = useRouter();
  const { t } = useTraveliunUI();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [rows, setRows] = useState(imports);
  const [error, setError] = useState<string | null>(null);

  async function onCreate() {
    if (creating) return;
    setCreating(true);
    setError(null);
    const result = await createRepackage();
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
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#e2ebe7] bg-white px-5 py-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
          <div>
            <h1 className="text-lg font-extrabold text-[#003c3a]">{t("rp.title")}</h1>
            <p className="mt-1 text-[12.5px] font-semibold text-[#93aaa3]">{t("rp.subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={() => void onCreate()}
            disabled={creating}
            className="inline-flex h-11 items-center gap-2 rounded-[11px] bg-[#185045] px-5 text-sm font-bold text-white transition-colors hover:bg-[#0f4439] disabled:opacity-70"
          >
            {creating ? <Loader2 className="size-4 animate-spin" /> : <FilePlus2 className="size-4" />}
            {creating ? t("pg.creating") : t("rp.new")}
          </button>
        </section>

        {error ? (
          <p role="alert" className="rounded-[10px] border border-[#f4c9d4] bg-[#fdeef2] px-4 py-3 text-[13px] font-semibold text-[#c22850]">{error}</p>
        ) : null}

        {rows.length === 0 ? (
          <section className="rounded-2xl border border-[#e2ebe7] bg-white shadow-[0_1px_2px_rgba(0,60,58,0.04)]">
            <EmptyState icon={FileText} title={t("rp.empty")} description={t("rp.subtitle")} />
          </section>
        ) : (
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((row) => (
              <article key={row.id} className="flex flex-col justify-between rounded-[14px] border border-[#e2ebe7] bg-white p-4 shadow-[0_1px_2px_rgba(0,60,58,0.04)] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[0_8px_22px_rgba(0,60,58,0.09)]">
                <div>
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <h2 className="min-w-0 truncate text-[15px] font-extrabold text-[#185045]">{row.title || t("rp.untitled")}</h2>
                    {row.produced_serial ? (
                      <span className="shrink-0 rounded-full bg-[#e4f6ef] px-2.5 py-0.5 text-[10.5px] font-bold text-[#10966b]">{t("rp.produced")}</span>
                    ) : null}
                  </div>
                  {row.destination ? <p className="text-[12.5px] font-semibold text-[#557d78]">{row.destination}</p> : null}
                  {row.supplier_name ? <p className="text-[11.5px] font-semibold text-[#93aaa3]">{t("rp.supplier")}: {row.supplier_name}</p> : null}
                  <p className="tv-tnum mt-1.5 text-[11px] text-[#93aaa3]">{t("pg.lastUpdated")}: <DirText dir="ltr">{row.updated_at.slice(0, 16).replace("T", " ")}</DirText></p>
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
