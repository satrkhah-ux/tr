"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import PolaroidLineCarousel from "@/components/ui/polaroid-line-carousel";

const REFRESH_MS = 5 * 60_000;
/** the office screens' bulletin is on one screen for 36 s (office-screens/core.ts countryBulletinElapsed) */
const BULLETIN_MS = 34_000;

/**
 * «الأكثر طلباً اليوم»: Traveliun's green with the world map behind, the logo,
 * and today's countries pegged to a line — the most asked first, ranked, never
 * a count (the user, 2026-10-23: «لاداعي لعدد المحادثات»). Re-reads every 5 min.
 *
 * `screen`: inside an office screen's bulletin (office-screens/page.ts) — no
 * arrows, the prints shared over the bulletin's 36 s, and back to #1 each time
 * the screen says the bulletin has come up («tt-start»).
 */
export function TopToday({ countries, screen = false }: { countries: { country: string; src: string }[]; screen?: boolean }) {
  const router = useRouter();
  const [run, setRun] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => router.refresh(), REFRESH_MS);
    const onMessage = (e: MessageEvent) => {
      if (e.origin === window.location.origin && e.data === "tt-start") setRun((r) => r + 1);
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.clearInterval(t);
      window.removeEventListener("message", onMessage);
    };
  }, [router]);

  const today = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Riyadh" }).format(new Date());
  const perPrint = screen ? Math.max(3500, Math.min(7000, Math.floor(BULLETIN_MS / Math.max(1, countries.length)))) : 5000;

  return (
    <main dir="rtl" className="relative flex h-svh flex-col overflow-hidden bg-[radial-gradient(ellipse_at_top,#1f7667_0%,#135549_45%,#0b3a32_100%)] text-white">
      {/* the world map, faint, behind everything */}
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[url('/traveliun/world-map.png')] bg-cover bg-center opacity-[0.12] mix-blend-screen" />
      <header className="relative z-10 flex items-center justify-between gap-4 px-[clamp(16px,4vw,56px)] pt-[clamp(16px,3vh,36px)]">
        <div>
          <p className="text-[clamp(13px,1.2vw,22px)] font-bold text-[#f0ad22]">{today}</p>
          <h1 className="mt-1 text-[clamp(26px,3.4vw,64px)] font-extrabold leading-tight">الأكثر طلباً اليوم</h1>
          <p className="mt-1 text-[clamp(13px,1.2vw,22px)] font-medium text-white/70">الوجهات التي سأل عنها عملاؤنا اليوم، الأكثر أولاً</p>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand asset */}
        <img src="/traveliun/logo-en.svg" alt="Traveliun" className="h-[clamp(36px,5vw,90px)] w-auto brightness-0 invert" />
      </header>

      {countries.length === 0 ? (
        <div className="relative z-10 flex flex-1 items-center justify-center px-6 text-center text-[clamp(18px,2vw,32px)] font-bold text-white/80">
          لم تصل محادثات بوجهة محددة اليوم بعد
        </div>
      ) : (
        <PolaroidLineCarousel
          key={run}
          className="relative z-10 flex-1"
          height="auto"
          cardWidth={screen ? 440 : 320}
          sag={40}
          autoplay={perPrint}
          controls={!screen}
          string="#f0ad22"
          background="transparent"
          ink="#ffffff"
          ariaLabel="الأكثر طلباً اليوم"
          slides={countries.map((t, i) => ({ image: t.src, title: t.country, badge: `#${i + 1}`, alt: t.country }))}
        />
      )}

      <footer className="relative z-10 flex items-center justify-between px-[clamp(16px,4vw,56px)] pb-3 text-[clamp(12px,1vw,18px)] font-semibold text-white/55">
        <span>ترافليون للسفر والسياحة</span>
        <span>traveliun.com.sa</span>
      </footer>
    </main>
  );
}
