"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { FilePlus2, FileText, Loader2, LogOut } from "lucide-react";
import { DirText } from "@/components/DirText";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { createPartnerFile, type PartnerFile } from "@/lib/partners/drafts";

/**
 * The partner's own desk: start a file, or open one they started.
 *
 * Deliberately NOT the staff shell. A reseller has one job here and should see
 * one screen for it — the staff sidebar would offer them thirty destinations,
 * every one of which the database would refuse to fill.
 *
 * The files themselves are built in the SAME generator our own agents use.
 * Two generators would be two sets of rules about what a valid package is, and
 * the second one would fall behind within a month.
 */
export function PartnerPortal({
  partnerName,
  terms,
  files,
}: {
  partnerName: string;
  terms: string;
  files: PartnerFile[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <main className="min-h-dvh bg-[#f4f8f6] px-4 py-8" dir="rtl">
      <div className="mx-auto max-w-4xl">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[12px] font-bold text-[#93aaa3]">بوابة الشركات</p>
            <h1 className="text-2xl font-extrabold text-[#003c3a]">{partnerName}</h1>
            <p className="mt-1 text-[12.5px] font-semibold text-[#557d78]">شروط التعامل: {terms}</p>
          </div>
          <button
            type="button"
            onClick={async () => {
              await createSupabaseBrowserClient().auth.signOut();
              router.replace("/b2b");
              router.refresh();
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-[#dbe6e1] bg-white px-3 text-[12px] font-bold text-[#557d78] hover:bg-[#f4f8f6]"
          >
            <LogOut className="size-3.5" />
            خروج
          </button>
        </header>

        <section className="mb-4 rounded-2xl border border-[#d6eadf] bg-white p-5">
          <h2 className="text-base font-extrabold text-[#0f3d38]">ابدأ بكجاً جديداً</h2>
          <p className="mt-1 text-[12.5px] font-semibold text-[#557d78]">
            العميل، الرحلة، المدن، الفنادق، الطيران، ثم التسعير — ويخرج الملف باسم شركتكم وشعارها.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const res = await createPartnerFile();
                if (res.ok) router.push(`/package-generator/${res.id}/customer`);
                else setError("تعذّر إنشاء الملف. حاول مرة أخرى.");
              })
            }
            className="mt-4 inline-flex h-11 items-center gap-2 rounded-[10px] bg-[#185045] px-5 text-[13px] font-bold text-white hover:bg-[#0f4439] disabled:opacity-60"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <FilePlus2 className="size-4" />}
            إصدار بكج جديد
          </button>
          {error ? <p className="mt-2 text-[12.5px] font-bold text-[#c22850]">{error}</p> : null}
        </section>

        <section className="rounded-2xl border border-[#e2ebe7] bg-white p-5">
          <h2 className="mb-3 text-base font-extrabold text-[#0f3d38]">ملفاتكم ({files.length})</h2>

          {files.length === 0 ? (
            <p className="rounded-[10px] border border-dashed border-[#cfe0d9] px-4 py-8 text-center text-[13px] font-semibold text-[#93aaa3]">
              لم تبدأوا أي ملف بعد. اضغط «إصدار بكج جديد» أعلاه.
            </p>
          ) : (
            <ul className="space-y-2">
              {files.map((f) => (
                <li
                  key={f.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-[11px] border border-[#e2ebe7] p-3"
                >
                  <FileText className="size-4 shrink-0 text-[#557d78]" />
                  <span className="text-[13px] font-extrabold text-[#003c3a]">{f.destination || "بلا وجهة بعد"}</span>

                  <span className="tv-tnum text-[11.5px] font-bold text-[#557d78]">
                    <DirText dir="ltr">{f.travelers}</DirText> مسافر ·{" "}
                    <DirText dir="ltr">{f.nights}</DirText> ليلة
                    {f.travel_date ? (
                      <>
                        {" · "}
                        <DirText dir="ltr">{f.travel_date}</DirText>
                      </>
                    ) : null}
                  </span>

                  {/* A serial means it was issued — the one fact that separates a
                      file still being written from one that went to a client. */}
                  {f.serial ? (
                    <span className="tv-tnum rounded-full bg-[#e9f7f0] px-2.5 py-1 text-[11px] font-extrabold text-[#0f7a52]">
                      صدر · <DirText dir="ltr">{f.serial}</DirText>
                    </span>
                  ) : (
                    <span className="rounded-full bg-[#fff8e8] px-2.5 py-1 text-[11px] font-extrabold text-[#a86a10]">
                      مسودة
                    </span>
                  )}

                  <span className="ms-auto flex items-center gap-1.5">
                    {f.serial ? (
                      <Link
                        href={`/offer/${f.serial}/preview`}
                        className="inline-flex h-8 items-center rounded-[8px] border border-[#b7d0c7] px-2.5 text-[11.5px] font-bold text-[#185045] hover:bg-[#f0f7f4]"
                      >
                        فتح العرض
                      </Link>
                    ) : null}
                    <Link
                      href={`/package-generator/${f.id}/customer`}
                      className="inline-flex h-8 items-center rounded-[8px] bg-[#185045] px-3 text-[11.5px] font-bold text-white hover:bg-[#0f4439]"
                    >
                      متابعة التحرير
                    </Link>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="mt-4 text-center text-[11px] font-semibold text-[#93aaa3]">
          الحجز الفعلي لدى الفنادق يتم من قسم العمليات في ترافليون — يصلكم إشعار بما تم حجزه.
        </p>
      </div>
    </main>
  );
}
