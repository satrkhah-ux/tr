"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowUpRight, CheckCircle2, FileText, Link2, Loader2, Send } from "lucide-react";
import { DirText } from "@/components/DirText";
import { publishOffer } from "@/lib/data/offers";
import { setOfferPartner } from "@/lib/data/partner-companies";

/**
 * Staff toolbar over the live offer preview: publish (freeze snapshot + send),
 * switch client/internal variant, choose WHOSE document this is, decide whether
 * it carries a price, and open the PDF / public link.
 *
 * The brand and price choices live in the URL, not in component state: the PDF
 * link is a plain <a> to the same two parameters, so the file that downloads is
 * provably the document on screen. `setOfferPartner` then remembers the choice on
 * the offer, so re-opening it — or the client link — comes out the same way.
 */
export function OfferPreviewToolbar({
  serial,
  variant,
  canInternal,
  publishedVersion,
  resellers,
  brandId,
  showPrices,
}: {
  serial: string;
  variant: "client" | "internal";
  canInternal: boolean;
  publishedVersion: number | null;
  /** partner companies flagged as resellers — the only ones we can issue under. */
  resellers: { id: string; name: string }[];
  /** current selection: a partner id, "ours", or null (whatever the offer says). */
  brandId: string | null;
  showPrices: boolean;
}) {
  const router = useRouter();
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const query = (over: { brand?: string | null; prices?: boolean }) => {
    const p = new URLSearchParams();
    if (variant === "internal") p.set("variant", "internal");
    const brand = over.brand === undefined ? brandId : over.brand;
    if (brand) p.set("brand", brand);
    const prices = over.prices === undefined ? showPrices : over.prices;
    if (!prices) p.set("prices", "off");
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  /** Switching identity also records it on the offer, so the client link agrees. */
  async function pickBrand(next: string) {
    setPending(true);
    await setOfferPartner(serial, next === "ours" ? null : next);
    setPending(false);
    router.push(`/offer/${serial}/preview${query({ brand: next })}`);
    router.refresh();
  }

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
      href={`/offer/${serial}/preview${value === "internal" ? "?variant=internal" : query({})}`}
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
          href={`/offer/${serial}/pdf${variant === "internal" ? "?variant=internal" : query({})}`}
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

      {/* whose document, and with or without a price — the two decisions that
          turn one offer into a file a partner can resell */}
      <div className="flex w-full flex-wrap items-center gap-2 rounded-[12px] border border-[#e2ebe7] bg-white px-3 py-2.5">
        <span className="text-[11.5px] font-extrabold text-[#557d78]">الإصدار باسم</span>
        <select
          value={brandId ?? "ours"}
          disabled={pending}
          onChange={(e) => void pickBrand(e.target.value)}
          className="h-9 rounded-[9px] border border-[#dbe6e1] bg-white px-2 text-[12.5px] font-bold text-[#185045] outline-none focus:border-[#2aa87a] disabled:opacity-60"
        >
          <option value="ours">ترافليون</option>
          {resellers.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        {resellers.length === 0 ? (
          <Link href="/partner-companies" className="text-[11.5px] font-bold text-[#0e9bb5] underline">
            أضف شركة متعاونة
          </Link>
        ) : null}

        <span className="ms-2 text-[11.5px] font-extrabold text-[#557d78]">الأسعار</span>
        <div className="inline-flex rounded-[9px] border border-[#dbe6e1] p-0.5">
          <Link
            href={`/offer/${serial}/preview${query({ prices: true })}`}
            className={`inline-flex h-8 items-center rounded-[7px] px-3 text-[12px] font-bold ${showPrices ? "bg-[#185045] text-white" : "text-[#557d78]"}`}
          >
            مع الأسعار
          </Link>
          <Link
            href={`/offer/${serial}/preview${query({ prices: false })}`}
            className={`inline-flex h-8 items-center rounded-[7px] px-3 text-[12px] font-bold ${showPrices ? "text-[#557d78]" : "bg-[#185045] text-white"}`}
          >
            بدون أسعار
          </Link>
        </div>
        <span className="text-[11px] font-semibold text-[#93aaa3]">الغلاف والشعار والألوان تتبع الشركة المختارة.</span>
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
