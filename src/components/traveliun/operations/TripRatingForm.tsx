"use client";

import { useState, useTransition } from "react";
import { submitTripRating } from "@/lib/data/trip-rating";

/** Five stars and a few words — sent once. The traveller is not a system user, so no shell. */
export function TripRatingForm({ token, rated }: { token: string; rated: number | null }) {
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState("");
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(rated ? "شكراً لكم — وصلنا تقييمكم." : null);
  const done = Boolean(message && !message.startsWith("تعذّر") && !message.startsWith("اختر") && !message.startsWith("الرابط"));

  if (done) return <p className="mt-6 rounded-[12px] bg-[#e9f7f0] px-4 py-3 text-[14px] font-bold text-[#0f7a52]">{message}</p>;

  return (
    <form
      className="mt-5 grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          try {
            const res = await submitTripRating(token, score, comment);
            setMessage(res.message);
          } catch {
            setMessage("تعذّر الإرسال. حاولوا مرة أخرى.");
          }
        });
      }}
    >
      <div role="radiogroup" aria-label="التقييم" className="flex justify-center gap-2" dir="ltr">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={score === n}
            aria-label={`${n} من 5`}
            onClick={() => setScore(n)}
            className={`text-[34px] leading-none transition-transform hover:scale-110 ${n <= score ? "text-[#f0ad22]" : "text-[#d8e4df]"}`}
          >
            ★
          </button>
        ))}
      </div>
      <label className="grid gap-1.5 text-[12.5px] font-bold text-[#185045]">
        ملاحظاتكم (اختياري)
        <textarea
          id="trip-rating-comment"
          rows={4}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="w-full rounded-[10px] border border-[#dbe6e1] p-3 text-[14px] text-[#185045] outline-none focus:border-[#2aa87a]"
        />
      </label>
      {message ? <p className="text-[12.5px] font-bold text-[#c22850]">{message}</p> : null}
      <button
        type="submit"
        disabled={pending || score === 0}
        className="inline-flex h-11 items-center justify-center rounded-[10px] bg-[#185045] px-6 text-[14px] font-bold text-white disabled:opacity-50"
      >
        إرسال التقييم
      </button>
    </form>
  );
}
