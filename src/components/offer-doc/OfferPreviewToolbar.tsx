"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowUpRight, CheckCircle2, FileText, Link2, Loader2, Send } from "lucide-react";
import { DirText } from "@/components/DirText";
import { publishOffer } from "@/lib/data/offers";

/** Staff toolbar over the live offer preview: publish (freeze snapshot + send),
 *  switch client/internal variant, and open the PDF / public link. */
export function OfferPreviewToolbar({
  serial,
  variant,
  canInternal,
  publishedVersion,
}: {
  serial: string;
  variant: "client" | "internal";
  canInternal: boolean;
  publishedVersion: number | null;
}) {
  const router = useRouter();
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onPublish() {
    if (publishing) return;
    setPublishing(true);
    setMessage(null);
    const result = await publishOffer(serial);
    setPublishing(false);
    if (result.ok) {
      setMessage(`تم نشر النسخة ${result.version} ✓`);
      router.refresh();
    } else {
      setMessage("تعذّر النشر، حاول مجددًا.");
    }
  }

  const tab = (value: "client" | "internal", label: string) => (
    <Link
      href={`/offer/${serial}/preview?variant=${value}`}
      className={`inline-flex h-9 items-center rounded-[9px] px-4 text-[12.5px] font-bold transition-colors ${
        variant === value ? "bg-[#185045] text-white" : "border border-[#dbe6e1] bg-white text-[#557d78] hover:bg-[#f4f8f6]"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div className="mx-auto mb-4 flex max-w-[820px] flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2">
        {tab("client", "نسخة العميل")}
        {canInternal ? tab("internal", "النسخة الداخلية") : null}
        {publishedVersion != null ? (
          <span className="rounded-full bg-[#e9f7f0] px-3 py-1.5 text-[11.5px] font-bold text-[#0f7a52]">
            منشور · نسخة <DirText dir="ltr" className="tv-tnum">{String(publishedVersion)}</DirText>
          </span>
        ) : (
          <span className="rounded-full bg-[#fff8e8] px-3 py-1.5 text-[11.5px] font-bold text-[#a86a10]">غير منشور</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {message ? <span className="text-[12px] font-bold text-[#0f7a52]">{message}</span> : null}
        <button
          type="button"
          onClick={() => void onPublish()}
          disabled={publishing}
          className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-[#185045] px-4 text-[13px] font-bold text-white transition-colors hover:bg-[#0f4439] disabled:opacity-60"
        >
          {publishing ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          {publishedVersion != null ? "إعادة النشر" : "نشر وإرسال"}
        </button>
        <a
          href={`/offer/${serial}/pdf${variant === "internal" ? "?variant=internal" : ""}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[#d8e3de] px-4 text-[13px] font-bold text-[#185045] hover:bg-[#f4f8f6]"
        >
          <FileText className="size-4" />
          فتح PDF
        </a>
        {publishedVersion != null ? (
          <Link
            href={`/client-offer/${serial}`}
            target="_blank"
            className="inline-flex h-10 items-center gap-2 rounded-[10px] border border-[#d8e3de] px-4 text-[13px] font-bold text-[#185045] hover:bg-[#f4f8f6]"
          >
            <Link2 className="size-4" />
            رابط العميل
            <ArrowUpRight className="size-3.5" />
          </Link>
        ) : null}
      </div>

      {publishedVersion != null && message == null ? (
        <p className="flex w-full items-center gap-1.5 text-[11.5px] font-semibold text-[#93aaa3]">
          <CheckCircle2 className="size-3.5 text-[#0f7a52]" />
          رابط العميل وملف الـ PDF يعرضان النسخة المنشورة — لا يتغيّران عند تعديل العرض لاحقًا حتى تعيد النشر.
        </p>
      ) : null}
    </div>
  );
}
