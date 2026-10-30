"use client";

import { useEffect, useState } from "react";

/**
 * «ترافليون …» typed on the sign-in page (the owner, 2026-10-30): the name stays, the service after it is
 * deleted letter by letter and the next one typed. Reduced motion: the services change whole, no typing.
 */
export const SERVICES = ["وان", "1", "حجوزات", "مالية", "متابعة", "عمليات", "تأشيرات", "مُراد", "باقات", "عملاء"] as const;

const TYPE_MS = 95;
const DELETE_MS = 45;
const HOLD_MS = 1700;

export function useTypedService(): { text: string; index: number } {
  const [index, setIndex] = useState(0);
  const [text, setText] = useState<string>(SERVICES[0]);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const word = SERVICES[index];
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = window.setTimeout(() => {
        const next = (index + 1) % SERVICES.length;
        setIndex(next);
        setText(SERVICES[next]);
      }, HOLD_MS + 600);
      return () => window.clearTimeout(id);
    }
    let delay = deleting ? DELETE_MS : TYPE_MS;
    if (!deleting && text === word) delay = HOLD_MS;
    const id = window.setTimeout(() => {
      if (!deleting && text === word) setDeleting(true);
      else if (deleting && text === "") {
        setDeleting(false);
        setIndex((index + 1) % SERVICES.length);
      } else setText(deleting ? text.slice(0, -1) : word.slice(0, text.length + 1));
    }, delay);
    return () => window.clearTimeout(id);
  }, [text, deleting, index]);

  return { text, index };
}

/** «ترافليون» + the service being typed, with a blinking caret. */
export function TypedName({ text, className = "" }: { text: string; className?: string }) {
  return (
    <p className={`font-bold ${className}`} aria-label="ترافليون">
      <span>ترافليون </span>
      <span className="tv-typed">{text}</span>
      <span aria-hidden className="tv-caret">|</span>
    </p>
  );
}

/** The image side: the typed name over the photo, and every service as a chip — the current one lit. */
export function SignInShowcase() {
  const { text, index } = useTypedService();
  return (
    <section className="relative hidden min-h-screen overflow-hidden bg-[url('/traveliun/auth-background.webp')] bg-cover bg-center lg:block">
      <div className="absolute inset-0 bg-gradient-to-t from-[#002a28]/90 via-[#003c3a]/45 to-transparent" />
      <div className="tv-float absolute inset-x-0 bottom-0 p-12 text-white" dir="rtl">
        <TypedName text={text} className="text-[52px] leading-tight drop-shadow-[0_2px_12px_rgba(0,0,0,0.35)]" />
        <p className="mt-3 max-w-md text-[15px] font-medium text-white/80">نظام واحد لكل أعمال الشركة: من أول رسالة للعميل حتى عودته من الرحلة.</p>
        <ul className="mt-7 flex max-w-xl flex-wrap gap-2">
          {SERVICES.map((s, i) => (
            <li
              key={s}
              className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold backdrop-blur-sm transition-all duration-500 ${
                i === index ? "scale-105 border-white bg-white text-[#003c3a]" : "border-white/30 bg-white/10 text-white/85"
              }`}
            >
              ترافليون {s}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Under the logo on a phone, where the photo is hidden. */
export function SignInTypedMobile() {
  const { text } = useTypedService();
  return <TypedName text={text} className="mb-6 text-center text-[22px] text-[#185045] lg:hidden" />;
}
