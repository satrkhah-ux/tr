"use client";

import { errorReportFrom, sendErrorToMurad } from "@/components/traveliun/secretary/send-error";

/**
 * Any page that breaks while loading (the owner, 2026-10-29): a plain Arabic
 * page with «أعد المحاولة» and «أرسل الخطأ لمُراد». Only the message travels —
 * never the stack or the digest (send-error.ts / error-core.ts clean it).
 */
export default function AppError({ error, unstable_retry }: { error: Error & { digest?: string }; unstable_retry: () => void }) {
  return <main dir="rtl" className="flex min-h-[60vh] items-center justify-center p-6">
    <div data-murad-own role="alert" className="tv-card w-full max-w-md rounded-2xl border p-6 text-center shadow-sm">
      <h1 className="text-lg font-extrabold text-[#185045]">تعذّر فتح هذه الصفحة</h1>
      <p className="mt-2 text-sm leading-7 text-[#557d78]">حدث خطأ غير متوقع. ما حفظته سابقاً باقٍ. أعد المحاولة، أو أرسل الخطأ لمُراد ليشرح لك السبب.</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={() => unstable_retry()} className="rounded-xl bg-[var(--tv-brand)] px-4 py-2 text-sm font-bold text-white">أعد المحاولة</button>
        <button type="button" onClick={() => sendErrorToMurad(errorReportFrom(error.message || "خطأ غير متوقع في تحميل الصفحة"))}
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-800">أرسل الخطأ لمُراد</button>
      </div>
    </div>
  </main>;
}
